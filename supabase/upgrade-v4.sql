-- =====================================================================
--  ALFRIAN INT'L ACADEMY - VERSION 4 ADDITIONS
--  * Fresh install: this is already appended to schema.sql, run schema.sql only.
--  * Existing install (you already ran schema.sql with version 3): run THIS file once.
--  Adds: school calendar and events, parent-teacher meeting booking,
--        certificates with public QR verification.
--  Safe to run twice. Requires the version 3 additions (add_notification, teaches_student, etc.).
-- =====================================================================

-- A. SCHOOL CALENDAR ----------------------------------------------------------------
create table if not exists public.school_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 150),
  description text check (char_length(description) <= 1000),
  kind        text not null default 'event' check (kind in ('event','holiday','exam','meeting','deadline','term')),
  starts_on   date not null,
  ends_on     date not null,
  location    text check (char_length(location) <= 120),
  audience    text[] not null default array['all'] check (cardinality(audience) > 0 and audience <@ array['all','teacher','student','parent']),
  notify      boolean not null default false,        -- send an in-app notification when created
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 200)
);
create index if not exists idx_events_start on public.school_events (starts_on);
alter table public.school_events enable row level security;

drop policy if exists events_select on public.school_events;
drop policy if exists events_write  on public.school_events;
create policy events_select on public.school_events for select to authenticated
  using (public.is_admin() or 'all' = any(audience) or public.auth_role() = any(audience));
create policy events_write on public.school_events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.after_event_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not new.notify then return null; end if;
  for r in select p.id, p.role from public.profiles p
           where p.is_active and p.role in ('teacher','student','parent')
             and ('all' = any(new.audience) or p.role = any(new.audience)) loop
    perform public.add_notification(r.id, 'School calendar: ' || new.title,
      to_char(new.starts_on, 'DD Mon YYYY') || case when new.ends_on > new.starts_on then ' to ' || to_char(new.ends_on, 'DD Mon YYYY') else '' end
        || coalesce(' at ' || new.location, ''), 'event', r.role || '.html#/calendar');
  end loop;
  return null;
end $$;
drop trigger if exists trg_event_notify on public.school_events;
create trigger trg_event_notify after insert on public.school_events
  for each row execute function public.after_event_insert();

-- B. PARENT-TEACHER MEETINGS ---------------------------------------------------------
-- Does this teacher teach (or is class teacher of) a class that one of my children / I am in?
create or replace function public.teaches_my_child(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    where s.status = 'active'
      and (public.is_guardian_of(s.id) or (s.profile_id = auth.uid() and public.auth_role() = 'student'))
      and (exists (select 1 from public.teacher_assignments ta where ta.class_id = s.class_id and ta.teacher_id = tid)
           or exists (select 1 from public.classes c where c.id = s.class_id and c.class_teacher_id = tid)))
$$;

create table if not exists public.meeting_slots (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  location   text check (char_length(location) <= 120),
  status     text not null default 'open' check (status in ('open','booked','cancelled')),
  student_id uuid references public.students(id) on delete set null,
  booked_by  uuid references auth.users(id) on delete set null,
  note       text check (char_length(note) <= 500),
  booked_at  timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '3 hours'),
  unique (teacher_id, starts_at)
);
create index if not exists idx_slots_teacher on public.meeting_slots (teacher_id, starts_at);
create index if not exists idx_slots_student on public.meeting_slots (student_id);
alter table public.meeting_slots enable row level security;

drop policy if exists slots_select on public.meeting_slots;
drop policy if exists slots_insert on public.meeting_slots;
drop policy if exists slots_delete on public.meeting_slots;
drop policy if exists slots_admin  on public.meeting_slots;
create policy slots_select on public.meeting_slots for select to authenticated using (
  public.is_admin()
  or teacher_id = public.my_teacher_id()
  or (student_id is not null and public.can_access_student(student_id) and public.is_family())
  or (status = 'open' and starts_at > now() and public.teaches_my_child(teacher_id)));
create policy slots_insert on public.meeting_slots for insert to authenticated
  with check (teacher_id = public.my_teacher_id() and status = 'open' and student_id is null and booked_by is null and starts_at > now());
create policy slots_delete on public.meeting_slots for delete to authenticated
  using (public.is_admin() or (teacher_id = public.my_teacher_id() and status <> 'booked'));
create policy slots_admin on public.meeting_slots for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A parent books an open slot for one of their children
create or replace function public.book_meeting(p_slot uuid, p_student uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.meeting_slots; kid public.students; tprof uuid;
begin
  if not public.is_guardian_of(p_student) then raise exception 'You can only book for your own child'; end if;
  select * into s from public.meeting_slots where id = p_slot for update;
  if not found then raise exception 'That time slot does not exist'; end if;
  if s.status <> 'open' then raise exception 'That time slot has just been taken'; end if;
  if s.starts_at <= now() then raise exception 'That time slot has already passed'; end if;
  select * into kid from public.students where id = p_student;
  if not (exists (select 1 from public.teacher_assignments ta where ta.class_id = kid.class_id and ta.teacher_id = s.teacher_id)
       or exists (select 1 from public.classes c where c.id = kid.class_id and c.class_teacher_id = s.teacher_id)) then
    raise exception 'This teacher does not teach your child';
  end if;
  if exists (select 1 from public.meeting_slots m where m.teacher_id = s.teacher_id and m.student_id = p_student
             and m.status = 'booked' and m.starts_at > now()) then
    raise exception 'Your child already has a meeting booked with this teacher';
  end if;
  update public.meeting_slots set status = 'booked', student_id = p_student, booked_by = auth.uid(),
         note = nullif(left(trim(p_note), 500), ''), booked_at = now() where id = p_slot;
  select profile_id into tprof from public.teachers where id = s.teacher_id;
  perform public.add_notification(tprof, 'Meeting booked',
    'A parent of ' || kid.full_name || ' booked ' || to_char(s.starts_at, 'DD Mon YYYY HH24:MI') || '.', 'meeting', 'teacher.html#/meetings');
end $$;

-- Cancel a booking. A parent reopens the slot; the teacher (or an admin) cancels it and the parent is told.
create or replace function public.cancel_meeting(p_slot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.meeting_slots; tprof uuid; kid_name text; g uuid;
begin
  select * into s from public.meeting_slots where id = p_slot for update;
  if not found or s.status <> 'booked' then raise exception 'There is no booking to cancel'; end if;
  select profile_id into tprof from public.teachers where id = s.teacher_id;
  select full_name into kid_name from public.students where id = s.student_id;
  if public.is_guardian_of(s.student_id) then
    update public.meeting_slots set status = 'open', student_id = null, booked_by = null, note = null, booked_at = null where id = p_slot;
    perform public.add_notification(tprof, 'Meeting cancelled by parent',
      'The parent of ' || kid_name || ' cancelled ' || to_char(s.starts_at, 'DD Mon YYYY HH24:MI') || '. The slot is open again.', 'meeting', 'teacher.html#/meetings');
  elsif s.teacher_id = public.my_teacher_id() or public.is_admin() then
    update public.meeting_slots set status = 'cancelled' where id = p_slot;
    for g in select public.guardian_profile_ids(s.student_id) loop
      perform public.add_notification(g, 'Meeting cancelled by teacher',
        'The meeting for ' || kid_name || ' on ' || to_char(s.starts_at, 'DD Mon YYYY HH24:MI') || ' was cancelled. Please book another time.', 'meeting', 'parent.html#/meetings');
    end loop;
  else
    raise exception 'Not allowed';
  end if;
end $$;

-- C. CERTIFICATES ---------------------------------------------------------------------
create table if not exists public.certificates (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  kind       text not null default 'merit' check (kind in ('merit','completion','attendance','conduct','sports','custom')),
  title      text not null check (char_length(title) between 3 and 120),
  citation   text check (char_length(citation) <= 500),
  issued_on  date not null default current_date,
  code       text not null unique default upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12)),
  revoked_at timestamptz,
  issued_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_cert_student on public.certificates (student_id, issued_on desc);
alter table public.certificates enable row level security;

drop policy if exists cert_select on public.certificates;
drop policy if exists cert_write  on public.certificates;
create policy cert_select on public.certificates for select to authenticated
  using (public.is_admin() or (revoked_at is null and public.can_access_student(student_id)));
create policy cert_write on public.certificates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The code never changes once issued
create or replace function public.before_cert_save() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then new.code := old.code; new.student_id := old.student_id; end if;
  return new;
end $$;
drop trigger if exists trg_cert_save on public.certificates;
create trigger trg_cert_save before update on public.certificates for each row execute function public.before_cert_save();

create or replace function public.after_cert_issue() returns trigger
language plpgsql security definer set search_path = public as $$
declare g uuid; sp uuid;
begin
  select profile_id into sp from public.students where id = new.student_id;
  perform public.add_notification(sp, 'New certificate', new.title, 'certificate', 'student.html#/certificates');
  for g in select public.guardian_profile_ids(new.student_id) loop
    perform public.add_notification(g, 'New certificate', new.title, 'certificate', 'parent.html#/certificates');
  end loop;
  return null;
end $$;
drop trigger if exists trg_cert_issue on public.certificates;
create trigger trg_cert_issue after insert on public.certificates for each row execute function public.after_cert_issue();

-- Public check used by the verification page (works without signing in; reveals only what is printed on the certificate)
create or replace function public.verify_certificate(p_code text)
returns table (valid boolean, student_name text, title text, kind text, citation text, issued_on date)
language sql stable security definer set search_path = public as $$
  select (c.revoked_at is null), s.full_name, c.title, c.kind, c.citation, c.issued_on
  from public.certificates c join public.students s on s.id = c.student_id
  where c.code = upper(trim(p_code)) and char_length(trim(p_code)) between 6 and 20
$$;

-- D. RPC PERMISSIONS ---------------------------------------------------------------------
revoke execute on function public.book_meeting(uuid, uuid, text) from public, anon;
revoke execute on function public.cancel_meeting(uuid)           from public, anon;
revoke execute on function public.teaches_my_child(uuid)         from public, anon;
grant  execute on function public.book_meeting(uuid, uuid, text) to authenticated;
grant  execute on function public.cancel_meeting(uuid)           to authenticated;
grant  execute on function public.teaches_my_child(uuid)         to authenticated;
grant  execute on function public.verify_certificate(text)       to anon, authenticated;

-- E. AUDIT -------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['school_events','meeting_slots','certificates'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
