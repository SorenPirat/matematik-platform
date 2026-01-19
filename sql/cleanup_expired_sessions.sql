-- Auto-delete expired sessions every 5 minutes.
-- Run this in Supabase SQL Editor once.

create extension if not exists pg_cron;

create or replace function public.delete_expired_sessions()
returns void
language sql
security definer
as $$
  delete from public.sessions
  where expires_at < now();
$$;

select
  cron.schedule(
    'delete-expired-sessions',
    '*/5 * * * *',
    $$select public.delete_expired_sessions();$$
  );
