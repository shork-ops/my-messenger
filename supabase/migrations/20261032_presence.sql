-- Phase 1: last seen timestamps for presence.
-- Run in Supabase SQL Editor after 20261031_read_state.sql.

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- profiles_update_self already lets a user update their own row, so no new policy is required.
