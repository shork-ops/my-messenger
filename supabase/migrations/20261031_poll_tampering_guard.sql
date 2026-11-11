-- Prevent clients from tampering with poll JSON through ordinary messages UPDATE.
-- The vote RPC temporarily enables this transaction-local flag only for its own write.

create or replace function public.guard_poll_json_updates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.poll is distinct from new.poll
     and coalesce(current_setting('app.allow_poll_write', true), '') <> 'on' then
    raise exception 'Poll data can only be changed through vote_on_poll';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_poll_write_guard on public.messages;
create trigger messages_poll_write_guard
before update of poll on public.messages
for each row execute function public.guard_poll_json_updates();

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
  if option_id_input is null or char_length(option_id_input) > 128 then
    raise exception 'Invalid poll option';
  end if;

  select m.poll into current_poll
  from public.messages m
  where m.id = message_id_input
    and m.poll is not null
    and public.is_chat_member(m.chat_id)
  for update;

  if current_poll is null then raise exception 'Poll not found or access denied'; end if;

  for option_item in select value from jsonb_array_elements(current_poll->'options')
  loop
    if exists (
      select 1
      from jsonb_array_elements_text(coalesce(option_item->'votes', '[]'::jsonb)) as vote(value)
      where vote.value = actor::text
    ) then
      already_voted := true;
    end if;
  end loop;

  if not exists (
    select 1 from jsonb_array_elements(current_poll->'options') item
    where item->>'id' = option_id_input
  ) then
    raise exception 'Poll option not found';
  end if;

  select jsonb_agg(
    case
      when item->>'id' = option_id_input then
        jsonb_set(item, '{votes}',
          case
            when already_voted and exists (
              select 1
              from jsonb_array_elements_text(coalesce(item->'votes', '[]'::jsonb)) as vote(value)
              where vote.value = actor::text
            ) then coalesce((
              select jsonb_agg(vote.value)
              from jsonb_array_elements(coalesce(item->'votes', '[]'::jsonb)) as vote(value)
              where vote.value #>> '{}' <> actor::text
            ), '[]'::jsonb)
            else coalesce(item->'votes', '[]'::jsonb) || to_jsonb(actor::text)
          end)
      when already_voted then
        jsonb_set(item, '{votes}', coalesce((
          select jsonb_agg(v)
          from jsonb_array_elements(coalesce(item->'votes', '[]'::jsonb)) v
          where v #>> '{}' <> actor::text
        ), '[]'::jsonb))
      else item
    end order by ord
  ) into next_options
  from jsonb_array_elements(current_poll->'options') with ordinality as opts(item, ord);

  perform set_config('app.allow_poll_write', 'on', true);
  update public.messages
  set poll = jsonb_set(current_poll, '{options}', coalesce(next_options, '[]'::jsonb))
  where id = message_id_input;
  perform set_config('app.allow_poll_write', 'off', true);

  return (select m.poll from public.messages m where m.id = message_id_input);
end;
$$;

revoke all on function public.vote_on_poll(uuid, text) from public, anon;
grant execute on function public.vote_on_poll(uuid, text) to authenticated;
revoke all on function public.guard_poll_json_updates() from public, anon, authenticated;
