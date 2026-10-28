-- Hardening: poll integrity, message ownership, profile display_name bounds.
-- Run in Supabase SQL Editor after 20261029_persistent_polls.sql.

-- 1. New messages may carry a poll, but votes always start empty.
--    Votes are written only by public.vote_on_poll().
create or replace function public.sanitize_message_poll()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  option_count integer;
  options_sanitized jsonb := '[]'::jsonb;
  option_item jsonb;
begin
  if new.poll is null then
    return new;
  end if;

  if jsonb_typeof(new.poll) is distinct from 'object'
     or jsonb_typeof(new.poll -> 'question') is distinct from 'string'
     or jsonb_typeof(new.poll -> 'options') is distinct from 'array' then
    raise exception 'Invalid poll payload' using errcode = '22023';
  end if;

  option_count := jsonb_array_length(new.poll -> 'options');
  if option_count < 2 or option_count > 6 then
    raise exception 'Poll must have between 2 and 6 options' using errcode = '22023';
  end if;

  if char_length(new.poll ->> 'question') not between 1 and 180 then
    raise exception 'Poll question must be between 1 and 180 characters' using errcode = '22023';
  end if;

  if (
    select count(distinct parsed.elem ->> 'id')
    from jsonb_array_elements(new.poll -> 'options') as parsed(elem)
  ) <> option_count then
    raise exception 'Poll options must have unique ids' using errcode = '22023';
  end if;

  for option_item in select value from jsonb_array_elements(new.poll -> 'options') loop
    if jsonb_typeof(option_item) <> 'object'
       or coalesce(option_item ->> 'id', '') = ''
       or char_length(coalesce(option_item ->> 'text', '')) not between 1 and 80 then
      raise exception 'Each poll option needs an id and text up to 80 characters' using errcode = '22023';
    end if;
    options_sanitized := options_sanitized || jsonb_build_array(jsonb_set(option_item, '{votes}', '[]'::jsonb));
  end loop;

  new.poll := jsonb_set(new.poll, '{options}', options_sanitized);
  return new;
end;
$$;

drop trigger if exists messages_sanitize_poll on public.messages;
create trigger messages_sanitize_poll
before insert on public.messages
for each row execute procedure public.sanitize_message_poll();

-- 2. Authors may edit body/attachment/effect/edited_at/deleted_at, but never
--    move a message to another chat, reassign its author, or rewrite poll votes.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.chat_id is distinct from old.chat_id then
    raise exception 'Messages cannot be moved between chats' using errcode = '42501';
  end if;

  if new.sender_id is distinct from old.sender_id then
    raise exception 'Message author cannot be changed' using errcode = '42501';
  end if;

  if new.poll is distinct from old.poll
     and coalesce(current_setting('nexus.allow_poll_update', true), '') <> 'on' then
    raise exception 'Poll votes are managed by vote_on_poll' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_guard_update on public.messages;
create trigger messages_guard_update
before update on public.messages
for each row execute procedure public.guard_message_update();

-- 3. vote_on_poll keeps working: it raises a transaction-local flag that the
--    guard above honours, so votes still change exactly one way.
create or replace function public.vote_on_poll(message_id_input uuid, option_id_input text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  current_poll jsonb;
  next_options jsonb;
  option_item jsonb;
  already_voted boolean := false;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if option_id_input is null or char_length(option_id_input) > 128 then raise exception 'Invalid poll option'; end if;

  select m.poll into current_poll
  from public.messages m
  where m.id = message_id_input and m.poll is not null
    and public.is_chat_member(m.chat_id)
  for update;

  if current_poll is null then raise exception 'Poll not found or access denied'; end if;
  for option_item in select value from jsonb_array_elements(current_poll->'options')
  loop
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(option_item->'votes', '[]'::jsonb)) as vote(value)
      where vote.value = actor::text
    ) then already_voted := true; end if;
  end loop;

  select jsonb_agg(
    case
      when item->>'id' = option_id_input then
        jsonb_set(item, '{votes}',
          case when already_voted and exists (
            select 1 from jsonb_array_elements_text(coalesce(item->'votes', '[]'::jsonb)) as vote(value) where vote.value = actor::text
          ) then coalesce((select jsonb_agg(vote.value) from jsonb_array_elements(coalesce(item->'votes','[]'::jsonb)) as vote(value) where vote.value #>> '{}' <> actor::text), '[]'::jsonb)
          else coalesce(item->'votes','[]'::jsonb) || to_jsonb(actor::text) end)
      when already_voted then jsonb_set(item, '{votes}',
        coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(item->'votes','[]'::jsonb)) v where v #>> '{}' <> actor::text), '[]'::jsonb))
      else item
    end order by ord
  ) into next_options
  from jsonb_array_elements(current_poll->'options') with ordinality as opts(item, ord);

  if not exists (select 1 from jsonb_array_elements(current_poll->'options') item where item->>'id' = option_id_input) then
    raise exception 'Poll option not found';
  end if;

  perform set_config('nexus.allow_poll_update', 'on', true);
  update public.messages set poll = jsonb_set(current_poll, '{options}', coalesce(next_options, '[]'::jsonb))
  where id = message_id_input;
  perform set_config('nexus.allow_poll_update', 'off', true);

  return (select poll from public.messages where id = message_id_input);
end;
$$;

revoke all on function public.vote_on_poll(uuid, text) from public;
grant execute on function public.vote_on_poll(uuid, text) to authenticated;

-- 4. Registration no longer fails when OAuth metadata carries a long name.
create or replace function public.handle_new_nexus_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Nexus user'), 60),
    upper(left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'N'), 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
