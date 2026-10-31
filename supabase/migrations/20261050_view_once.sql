-- Private single-view media. Apply after the existing application schema.
begin;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('view-once-media','view-once-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false;

-- There is deliberately no SELECT policy for authenticated clients in this bucket.
drop policy if exists view_once_upload on storage.objects;
create policy view_once_upload on storage.objects for insert to authenticated with check (
  bucket_id='view-once-media'
  and (storage.foldername(name))[2]=auth.uid()::text
  and exists(select 1 from public.chat_members m where m.chat_id::text=(storage.foldername(name))[1] and m.user_id=auth.uid())
);
drop policy if exists view_once_delete on storage.objects;
create policy view_once_delete on storage.objects for delete to authenticated using (
  bucket_id='view-once-media' and (storage.foldername(name))[2]=auth.uid()::text
);

create table if not exists public.view_once_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz not null default now(),
  primary key(message_id,user_id)
);
alter table public.view_once_receipts enable row level security;
revoke all on public.view_once_receipts from public,anon,authenticated;
grant select on public.view_once_receipts to authenticated;
drop policy if exists view_once_own_receipts on public.view_once_receipts;
create policy view_once_own_receipts on public.view_once_receipts for select to authenticated using(user_id=auth.uid());

create or replace function public.view_once_capabilities() returns boolean
language sql stable security definer set search_path='' as $$ select auth.uid() is not null; $$;
revoke all on function public.view_once_capabilities() from public,anon;
grant execute on function public.view_once_capabilities() to authenticated;

create or replace function public.claim_view_once_message(p_message uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.messages%rowtype; inserted integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into item from public.messages where id=p_message for update;
  if not found or item.sender_id=actor or item.deleted_at is not null
    or (item.send_at is not null and item.send_at>now())
    or not public.is_chat_member(item.chat_id)
    or item.attachment->>'viewOnce' is distinct from 'true'
    or item.attachment->>'bucket' is distinct from 'view-once-media'
    or split_part(item.attachment->>'path','/',1) is distinct from item.chat_id::text
    or split_part(item.attachment->>'path','/',2) is distinct from item.sender_id::text
  then raise exception 'Media unavailable' using errcode='42501'; end if;
  if public.is_blocked_between(actor,item.sender_id) then raise exception 'Media unavailable' using errcode='42501'; end if;
  insert into public.view_once_receipts(message_id,user_id) values(p_message,actor) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then raise exception 'Media already opened' using errcode='P0001'; end if;
  return jsonb_build_object('path',item.attachment->>'path');
end; $$;
revoke all on function public.claim_view_once_message(uuid) from public,anon;
grant execute on function public.claim_view_once_message(uuid) to authenticated;

create or replace function public.guard_view_once_attachment() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.attachment->>'bucket'='view-once-media' and new.attachment->>'viewOnce' is distinct from 'true' then
    raise exception 'Private single-view media must keep its single-view flag';
  end if;
  if tg_op='UPDATE' and old.attachment->>'viewOnce'='true' and new.attachment is distinct from old.attachment then
    -- Normal tombstoning/deletion may remove the attachment; it must not expose it as ordinary media.
    if new.attachment is not null then raise exception 'Single-view attachment is immutable'; end if;
  end if;
  if new.attachment->>'viewOnce'='true' then
    if new.attachment->>'bucket' is distinct from 'view-once-media'
      or split_part(new.attachment->>'path','/',1) is distinct from new.chat_id::text
      or split_part(new.attachment->>'path','/',2) is distinct from new.sender_id::text
    then raise exception 'Single-view media requires its private bucket'; end if;
    new.attachment:=new.attachment-'thumbnail'-'data'-'expiresAt';
  end if;
  return new;
end; $$;
revoke all on function public.guard_view_once_attachment() from public,anon,authenticated;
drop trigger if exists view_once_attachment_guard on public.messages;
create trigger view_once_attachment_guard before insert or update of attachment on public.messages for each row execute function public.guard_view_once_attachment();
commit;
