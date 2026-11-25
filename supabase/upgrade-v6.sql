-- =====================================================================
--  ALFRIAN INT'L ACADEMY - VERSION 6 ADDITIONS
--  * Fresh install: already appended to schema.sql, run schema.sql only.
--  * Existing install: run THIS file once (after upgrade-v5.sql). Safe to run twice.
--  Adds: login activity log (successful and failed sign-ins with device, place and network).
-- =====================================================================
create table if not exists public.login_events (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users(id) on delete set null,
  display_name text,                       -- full name for successful sign-ins, the typed address for failed ones
  identifier   text,                       -- student or staff number, else the first 8 characters of the account id; the typed address when failed
  role         text not null default 'unauthenticated',
  success      boolean not null,
  device       text,
  city         text,
  region       text,
  country      text,
  ip           text,                       -- read from the request by the database, not sent by the browser
  isp          text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_login_events_time on public.login_events (created_at desc);
create index if not exists idx_login_events_ip   on public.login_events (ip, created_at desc);
alter table public.login_events enable row level security;
drop policy if exists login_events_select on public.login_events;
create policy login_events_select on public.login_events for select to authenticated using (public.has_perm('audit'));
-- no insert, update or delete policy: rows are only written by log_login() and cannot be edited

create or replace function public.log_login(
  p_identifier text, p_success boolean, p_device text default null,
  p_city text default null, p_region text default null, p_country text default null, p_isp text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  hdr json; v_ip text; prof public.profiles; v_name text; v_ident text; v_role text; v_uid uuid := auth.uid();
  clean text[];
begin
  begin hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then hdr := null; end;
  v_ip := left(trim(split_part(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-forwarded-for', hdr ->> 'x-real-ip', ''), ',', 1)), 64);
  if v_ip = '' then v_ip := null; end if;

  if p_success then
    if v_uid is null then return; end if;                   -- a success can only be recorded by the signed-in person
    select * into prof from public.profiles where id = v_uid;
    if not found then return; end if;
    v_name := prof.full_name; v_role := prof.role;
    select coalesce(
      (select student_no from public.students where profile_id = v_uid limit 1),
      (select staff_no   from public.teachers where profile_id = v_uid limit 1),
      left(v_uid::text, 8)) into v_ident;
  else
    -- throttle so the form cannot be used to flood the table
    if (select count(*) from public.login_events where not success and created_at > now() - interval '1 minute'
          and (v_ip is null or ip = v_ip)) >= 20
       or (select count(*) from public.login_events where not success and created_at > now() - interval '1 minute') >= 300 then
      return;
    end if;
    v_uid := null; v_role := 'unauthenticated';
    v_name := left(regexp_replace(coalesce(p_identifier, ''), '[[:cntrl:]]', '', 'g'), 100);
    v_ident := v_name;
    if v_name = '' then v_name := '(empty)'; v_ident := '(empty)'; end if;
  end if;

  insert into public.login_events (user_id, display_name, identifier, role, success, device, city, region, country, ip, isp)
  values (v_uid, v_name, v_ident, v_role, p_success,
          left(regexp_replace(coalesce(p_device, ''), '[[:cntrl:]]', '', 'g'), 120),
          left(regexp_replace(coalesce(p_city, ''), '[[:cntrl:]]', '', 'g'), 80),
          left(regexp_replace(coalesce(p_region, ''), '[[:cntrl:]]', '', 'g'), 80),
          left(regexp_replace(coalesce(p_country, ''), '[[:cntrl:]]', '', 'g'), 80),
          v_ip,
          left(regexp_replace(coalesce(p_isp, ''), '[[:cntrl:]]', '', 'g'), 120));
end $$;
revoke execute on function public.log_login(text, boolean, text, text, text, text, text) from public;
grant  execute on function public.log_login(text, boolean, text, text, text, text, text) to anon, authenticated;
