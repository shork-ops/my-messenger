-- Persist polls in cloud messages and serialize votes on the server.
alter table public.messages add column if not exists poll jsonb;

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
  found_option boolean := false;
  already_voted boolean := false;
  next_votes jsonb;
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
  update public.messages set poll = jsonb_set(current_poll, '{options}', coalesce(next_options, '[]'::jsonb))
  where id = message_id_input;
  return (select poll from public.messages where id = message_id_input);
end;
$$;

revoke all on function public.vote_on_poll(uuid, text) from public;
grant execute on function public.vote_on_poll(uuid, text) to authenticated;
