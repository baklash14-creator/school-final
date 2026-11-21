-- =====================================================================
--  BAKARR SCHOOL  -  Supabase / PostgreSQL schema
--  Run this whole file once in:  Supabase Dashboard > SQL Editor > New query
--  Safe to read top to bottom. Sections:
--    1. Extensions & sequences        6. Triggers (audit, guards, notices)
--    2. Tables                        7. Views & RPC functions
--    3. Indexes                       8. Row Level Security policies
--    4. Helper (security) functions   9. Storage buckets & policies
--    5. Grade function               10. Seed data (one academic year only)
-- =====================================================================

-- 1. EXTENSIONS & SEQUENCES ------------------------------------------
create extension if not exists pgcrypto;

create sequence if not exists public.student_no_seq start 1;
create sequence if not exists public.teacher_no_seq start 1;
create sequence if not exists public.receipt_no_seq start 1;

-- 2. TABLES -----------------------------------------------------------
create table public.academic_years (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(name) between 3 and 30),
  start_date  date not null,
  end_date    date not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  check (end_date > start_date)
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  role        text not null default 'student'
              check (role in ('super_admin','school_admin','teacher','student','parent')),
  is_active   boolean not null default false,
  avatar_url  text,
  permissions jsonb not null default '{}'::jsonb,   -- e.g. {"fees":false} limits a school admin
  last_login  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.parents (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid unique references public.profiles(id) on delete set null,
  full_name   text not null check (char_length(full_name) between 2 and 120),
  phone       text,
  email       text,
  address     text,
  occupation  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.teachers (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid unique references public.profiles(id) on delete set null,
  staff_no        text not null unique
                  default ('TCH-' || lpad(nextval('public.teacher_no_seq')::text, 4, '0')),
  full_name       text not null check (char_length(full_name) between 2 and 120),
  gender          text check (gender in ('male','female')),
  phone           text,
  email           text,
  job_title       text,
  qualification   text,
  bio             text check (char_length(bio) <= 1000),
  hire_date       date,
  status          text not null default 'active' check (status in ('active','on_leave','resigned')),
  show_on_website boolean not null default true,
  photo_url       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.classes (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 1 and 60),
  level             text,
  capacity          int  not null default 40 check (capacity between 1 and 500),
  class_teacher_id  uuid references public.teachers(id) on delete set null,
  academic_year_id  uuid references public.academic_years(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (name, academic_year_id)
);

create table public.subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  code        text not null unique check (char_length(code) between 2 and 12),
  description text,
  created_at  timestamptz not null default now()
);

create table public.students (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid unique references public.profiles(id) on delete set null,
  student_no       text not null unique default
                   ('BKR-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.student_no_seq')::text, 4, '0')),
  full_name        text not null check (char_length(full_name) between 2 and 120),
  gender           text check (gender in ('male','female')),
  date_of_birth    date,
  address          text,
  phone            text,
  email            text,
  status           text not null default 'active'
                   check (status in ('active','suspended','graduated','withdrawn','transferred')),
  class_id         uuid references public.classes(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  parent_id        uuid references public.parents(id) on delete set null,
  admitted_on      date not null default current_date,
  photo_url        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.student_enrollments (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students(id) on delete cascade,
  class_id         uuid not null references public.classes(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  enrolled_on      date not null default current_date,
  status           text not null default 'enrolled' check (status in ('enrolled','promoted','repeated','graduated','left')),
  unique (student_id, academic_year_id)
);

-- One row = one subject taught in one class (teacher optional until assigned)
create table public.teacher_assignments (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid not null references public.classes(id) on delete cascade,
  subject_id       uuid not null references public.subjects(id) on delete cascade,
  teacher_id       uuid references public.teachers(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (class_id, subject_id)
);

create table public.attendance (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students(id) on delete cascade,
  class_id        uuid not null references public.classes(id) on delete cascade,
  attendance_date date not null,
  status          text not null check (status in ('present','absent','late')),
  note            text,
  marked_by       uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (student_id, attendance_date)
);

create table public.examinations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 120),
  term             text not null default 'Term 1',
  academic_year_id uuid references public.academic_years(id) on delete set null,
  class_id         uuid not null references public.classes(id) on delete cascade,
  start_date       date,
  end_date         date,
  max_score        numeric(6,2) not null default 100 check (max_score > 0),
  is_published     boolean not null default false,
  published_at     timestamptz,
  created_at       timestamptz not null default now()
);

create table public.exam_results (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.examinations(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  score       numeric(6,2) not null check (score >= 0),
  grade       text,
  remarks     text,
  entered_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (exam_id, student_id, subject_id)
);

create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  subject_id  uuid references public.subjects(id) on delete set null,
  teacher_id  uuid references public.teachers(id) on delete set null,
  title       text not null check (char_length(title) between 3 and 150),
  description text,
  due_date    date,
  created_at  timestamptz not null default now()
);

create table public.assignment_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  content       text check (char_length(content) <= 5000),
  file_path     text,
  submitted_at  timestamptz not null default now(),
  score         numeric(6,2),
  feedback      text,
  unique (assignment_id, student_id)
);

create table public.school_fees (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid not null references public.classes(id) on delete cascade,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  term             text not null default 'Term 1',
  name             text not null check (char_length(name) between 2 and 100),
  amount           numeric(12,2) not null check (amount >= 0),
  due_date         date,
  created_at       timestamptz not null default now()
);

create table public.fee_payments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  fee_id      uuid references public.school_fees(id) on delete set null,
  amount      numeric(12,2) not null check (amount > 0),
  method      text not null default 'cash' check (method in ('cash','bank_transfer','mobile_money','card','cheque')),
  reference   text,
  receipt_no  text not null unique default ('RCP-' || lpad(nextval('public.receipt_no_seq')::text, 6, '0')),
  paid_on     date not null default current_date,
  note        text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 150),
  body        text not null check (char_length(body) between 3 and 5000),
  kind        text not null default 'news' check (kind in ('news','event','notice')),
  audience    text[] not null default '{all}',      -- all | student | parent | teacher
  is_public   boolean not null default false,       -- visible on the public website
  published   boolean not null default true,
  event_date  date,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.admission_applications (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique check (reference ~ '^APP-[A-Z0-9]{8}$'),
  applicant_name  text not null check (char_length(applicant_name) between 2 and 120),
  date_of_birth   date,
  gender          text check (gender in ('male','female')),
  grade_applying  text not null check (char_length(grade_applying) <= 60),
  previous_school text check (char_length(previous_school) <= 150),
  parent_name     text not null check (char_length(parent_name) between 2 and 120),
  parent_phone    text not null check (char_length(parent_phone) between 5 and 30),
  parent_email    text check (char_length(parent_email) <= 150),
  address         text check (char_length(address) <= 300),
  message         text check (char_length(message) <= 1500),
  status          text not null default 'pending'
                  check (status in ('pending','reviewing','accepted','rejected','enrolled')),
  admin_note      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text,
  type        text not null default 'general',
  link        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  user_name   text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create table public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 100),
  email       text not null check (char_length(email) between 5 and 150),
  subject     text check (char_length(subject) <= 150),
  message     text not null check (char_length(message) between 5 and 2000),
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.gallery_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 2 and 120),
  image_path  text not null,
  created_at  timestamptz not null default now()
);

-- 3. INDEXES ------------------------------------------------------------
create unique index one_current_year on public.academic_years (is_current) where is_current;
create index idx_profiles_role          on public.profiles (role);
create index idx_students_class         on public.students (class_id);
create index idx_students_parent        on public.students (parent_id);
create index idx_students_status        on public.students (status);
create index idx_students_name          on public.students (lower(full_name));
create index idx_teachers_status        on public.teachers (status);
create index idx_classes_teacher        on public.classes (class_teacher_id);
create index idx_enroll_student         on public.student_enrollments (student_id);
create index idx_ta_teacher             on public.teacher_assignments (teacher_id);
create index idx_ta_class               on public.teacher_assignments (class_id);
create index idx_att_class_date         on public.attendance (class_id, attendance_date);
create index idx_att_student            on public.attendance (student_id);
create index idx_exam_class             on public.examinations (class_id);
create index idx_results_exam           on public.exam_results (exam_id);
create index idx_results_student        on public.exam_results (student_id);
create index idx_assign_class           on public.assignments (class_id);
create index idx_sub_assignment         on public.assignment_submissions (assignment_id);
create index idx_sub_student            on public.assignment_submissions (student_id);
create index idx_fees_class             on public.school_fees (class_id);
create index idx_pay_student            on public.fee_payments (student_id);
create index idx_pay_date               on public.fee_payments (paid_on);
create index idx_ann_created            on public.announcements (created_at desc);
create index idx_adm_status             on public.admission_applications (status);
create index idx_notif_user             on public.notifications (user_id, is_read, created_at desc);
create index idx_audit_created          on public.audit_logs (created_at desc);
create index idx_audit_entity           on public.audit_logs (entity);

-- 4. HELPER FUNCTIONS (used by RLS policies) ----------------------------
-- All are SECURITY DEFINER so policies can look up roles without recursion.
create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() in ('super_admin','school_admin'), false)
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = 'super_admin', false)
$$;

create or replace function public.is_family() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() in ('student','parent'), false)
$$;

-- Admin permission check. Super admin: always true. School admin: true unless switched off.
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and (
    public.auth_role() = 'super_admin'
    or coalesce((select permissions ->> p from public.profiles where id = auth.uid()), 'true') <> 'false'
  )
$$;

create or replace function public.my_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.students where profile_id = auth.uid() limit 1
$$;

create or replace function public.my_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.teachers where profile_id = auth.uid() limit 1
$$;

create or replace function public.my_parent_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.parents where profile_id = auth.uid() limit 1
$$;

create or replace function public.teaches_class(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.auth_role() = 'teacher' and (
    exists (select 1 from public.teacher_assignments ta
            where ta.class_id = cid and ta.teacher_id = public.my_teacher_id())
    or exists (select 1 from public.classes c
            where c.id = cid and c.class_teacher_id = public.my_teacher_id())
  )
$$;

-- The single gate for private academic records:
-- admin, the student themself, their parent, or a teacher of their class.
create or replace function public.can_access_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.students s
    where s.id = sid and (
      (s.profile_id = auth.uid() and public.auth_role() = 'student')
      or (s.parent_id is not null and s.parent_id = public.my_parent_id() and public.auth_role() = 'parent')
      or public.teaches_class(s.class_id)
    )
  )
$$;

-- 5. GRADE FUNCTION ------------------------------------------------------
-- Keep this scale in sync with js/config.js (GRADES).
create or replace function public.grade_for(score numeric, max_score numeric) returns text
language sql immutable as $$
  select case
    when max_score <= 0 then 'F'
    when score / max_score * 100 >= 80 then 'A'
    when score / max_score * 100 >= 70 then 'B'
    when score / max_score * 100 >= 60 then 'C'
    when score / max_score * 100 >= 50 then 'D'
    when score / max_score * 100 >= 40 then 'E'
    else 'F' end
$$;

-- 6. TRIGGERS -------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create trigger trg_profiles_upd  before update on public.profiles  for each row execute function public.set_updated_at();
create trigger trg_parents_upd   before update on public.parents   for each row execute function public.set_updated_at();
create trigger trg_teachers_upd  before update on public.teachers  for each row execute function public.set_updated_at();
create trigger trg_students_upd  before update on public.students  for each row execute function public.set_updated_at();
create trigger trg_ann_upd       before update on public.announcements for each row execute function public.set_updated_at();
create trigger trg_adm_upd       before update on public.admission_applications for each row execute function public.set_updated_at();

-- Only one current academic year
create or replace function public.single_current_year() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_current then
    update public.academic_years set is_current = false where id <> new.id and is_current;
  end if;
  return new;
end $$;
create trigger trg_single_year before insert or update on public.academic_years
  for each row execute function public.single_current_year();

-- Create a profile whenever an auth user is created.
-- Role is read from app_metadata (settable only with the service role), never from user input.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := new.raw_app_meta_data ->> 'role';
begin
  insert into public.profiles (id, full_name, email, role, is_active)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email,
          coalesce(r, 'student'), r is not null)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may edit their own profile but never their role / status / permissions.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;            -- service role / SQL editor
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.permissions is distinct from old.permissions then
    if not public.is_admin() then raise exception 'You cannot change role, status or permissions'; end if;
    if not public.is_super_admin() and (old.role = 'super_admin' or new.role = 'super_admin') then
      raise exception 'Only a super administrator can manage super administrator accounts';
    end if;
    if old.id = auth.uid() and (new.role is distinct from old.role or new.is_active = false) then
      raise exception 'You cannot demote or deactivate your own account';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_profile before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Students may not grade their own submissions
create or replace function public.guard_submission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or public.my_teacher_id() is not null then return new; end if;
  if tg_op = 'INSERT' then new.score := null; new.feedback := null;
  else new.score := old.score; new.feedback := old.feedback; end if;
  return new;
end $$;
create trigger trg_guard_submission before insert or update on public.assignment_submissions
  for each row execute function public.guard_submission();

-- Results: server computes grade, stamps the author
create or replace function public.before_result_save() returns trigger
language plpgsql security definer set search_path = public as $$
declare mx numeric;
begin
  select max_score into mx from public.examinations where id = new.exam_id;
  if new.score > mx then raise exception 'Score % is above the exam maximum of %', new.score, mx; end if;
  new.grade := public.grade_for(new.score, mx);
  new.entered_by := coalesce(auth.uid(), new.entered_by);
  new.updated_at := now();
  return new;
end $$;
create trigger trg_result_save before insert or update on public.exam_results
  for each row execute function public.before_result_save();

-- Stamp publish time
create or replace function public.before_exam_save() returns trigger
language plpgsql as $$
begin
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then new.published_at := now(); end if;
  if not new.is_published then new.published_at := null; end if;
  return new;
end $$;
create trigger trg_exam_save before insert or update on public.examinations
  for each row execute function public.before_exam_save();

-- Audit log: written by the database, so it cannot be skipped or forged by the browser
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb; who text;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  select full_name into who from public.profiles where id = auth.uid();
  insert into public.audit_logs (user_id, user_name, action, entity, entity_id, details)
  values (auth.uid(), who, tg_op, tg_table_name, rec ->> 'id',
          case when tg_op = 'DELETE' then jsonb_build_object('old', rec) else jsonb_build_object('new', rec) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['students','teachers','parents','classes','subjects','profiles',
     'teacher_assignments','examinations','school_fees','fee_payments','announcements',
     'admission_applications','academic_years','student_enrollments'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- Tell admins when a public form is submitted
create or replace function public.notify_admins_new_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, title, body, type, link)
  select p.id, 'New admission application',
         new.applicant_name || ' applied for ' || new.grade_applying || ' (' || new.reference || ')',
         'admission', 'admin.html#/admissions'
  from public.profiles p where p.role in ('super_admin','school_admin') and p.is_active;
  return new;
end $$;
create trigger trg_new_application after insert on public.admission_applications
  for each row execute function public.notify_admins_new_application();

create or replace function public.notify_admins_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, title, body, type, link)
  select p.id, 'New website message', new.name || ': ' || coalesce(new.subject, 'No subject'),
         'message', 'admin.html#/messages'
  from public.profiles p where p.role in ('super_admin','school_admin') and p.is_active;
  return new;
end $$;
create trigger trg_new_message after insert on public.contact_messages
  for each row execute function public.notify_admins_new_message();

-- 7. VIEWS & RPC FUNCTIONS -------------------------------------------------
-- Balance per student. security_invoker => the caller's RLS applies.
create or replace view public.student_fee_balances with (security_invoker = true) as
select s.id as student_id, s.student_no, s.full_name, s.class_id, s.parent_id, s.status,
       fees.total as total_fees, paid.total as total_paid, fees.total - paid.total as balance
from public.students s
cross join lateral (select coalesce(sum(f.amount), 0) as total from public.school_fees f
                    where f.class_id = s.class_id
                      and (s.academic_year_id is null or f.academic_year_id = s.academic_year_id)) fees
cross join lateral (select coalesce(sum(p.amount), 0) as total from public.fee_payments p
                    where p.student_id = s.id) paid;

-- Public, limited views for the website (no private columns)
create or replace view public.public_staff as
select t.id, t.full_name, t.job_title, t.qualification, t.photo_url, t.bio
from public.teachers t where t.status = 'active' and t.show_on_website;

create or replace view public.public_stats as
select (select count(*) from public.students where status = 'active')::int as students,
       (select count(*) from public.teachers  where status = 'active')::int as teachers,
       (select count(*) from public.classes)::int  as classes,
       (select count(*) from public.subjects)::int as subjects;

grant select on public.public_staff, public.public_stats to anon, authenticated;

-- Applicants track their application with the reference code they were given
create or replace function public.application_status(p_ref text)
returns table (applicant_name text, grade_applying text, status text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.applicant_name, a.grade_applying, a.status, a.updated_at
  from public.admission_applications a where a.reference = upper(trim(p_ref)) limit 1
$$;
grant execute on function public.application_status(text) to anon, authenticated;

-- Notify parents/students of absences (teachers of the class and admins only)
create or replace function public.notify_absent(p_class uuid, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; msg text;
begin
  if not (public.is_admin() or public.teaches_class(p_class)) then
    raise exception 'Not allowed';
  end if;
  for r in
    select s.full_name, s.profile_id as sp, pr.profile_id as pp
    from public.attendance a
    join public.students s on s.id = a.student_id
    left join public.parents pr on pr.id = s.parent_id
    where a.class_id = p_class and a.attendance_date = p_date and a.status = 'absent'
  loop
    msg := r.full_name || ' was marked absent on ' || to_char(p_date, 'DD Mon YYYY') || '.';
    if r.pp is not null and not exists (select 1 from public.notifications where user_id = r.pp and type = 'attendance' and body = msg) then
      insert into public.notifications (user_id, title, body, type, link)
      values (r.pp, 'Absence alert: ' || r.full_name, msg, 'attendance', 'parent.html#/attendance'); n := n + 1;
    end if;
    if r.sp is not null and not exists (select 1 from public.notifications where user_id = r.sp and type = 'attendance' and body = msg) then
      insert into public.notifications (user_id, title, body, type, link)
      values (r.sp, 'You were marked absent', msg, 'attendance', 'student.html#/attendance');
    end if;
  end loop;
  return n;
end $$;
grant execute on function public.notify_absent(uuid, date) to authenticated;

-- Client-side events worth auditing (login, exports)
create or replace function public.log_event(p_action text, p_entity text, p_details jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if auth.uid() is null then return; end if;
  select full_name into who from public.profiles where id = auth.uid();
  insert into public.audit_logs (user_id, user_name, action, entity, details)
  values (auth.uid(), who, left(p_action, 40), left(p_entity, 40), p_details);
end $$;
grant execute on function public.log_event(text, text, jsonb) to authenticated;

-- 8. ROW LEVEL SECURITY -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['academic_years','profiles','parents','teachers','classes','subjects','students',
    'student_enrollments','teacher_assignments','attendance','examinations','exam_results','assignments',
    'assignment_submissions','school_fees','fee_payments','announcements','admission_applications',
    'notifications','audit_logs','contact_messages','gallery_items'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_perm('users')) with check (public.has_perm('users'));

-- reference data readable by any signed-in active user
create policy years_read   on public.academic_years for select to authenticated using (public.auth_role() is not null);
create policy years_write  on public.academic_years for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy classes_read on public.classes for select to authenticated using (public.auth_role() is not null);
create policy classes_write on public.classes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy subjects_read on public.subjects for select to authenticated using (public.auth_role() is not null);
create policy subjects_write on public.subjects for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ta_read  on public.teacher_assignments for select to authenticated using (public.auth_role() is not null);
create policy ta_write on public.teacher_assignments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy teachers_read  on public.teachers for select to authenticated using (public.auth_role() is not null);
create policy teachers_write on public.teachers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy teachers_self  on public.teachers for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- parents
create policy parents_select on public.parents for select to authenticated using (
  public.is_admin() or id = public.my_parent_id()
  or exists (select 1 from public.students s where s.parent_id = parents.id
             and (s.profile_id = auth.uid() or public.teaches_class(s.class_id))));
create policy parents_write  on public.parents for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy parents_self   on public.parents for update to authenticated
  using (id = public.my_parent_id()) with check (id = public.my_parent_id());

-- students and anything tied to one student
create policy students_select on public.students for select to authenticated using (public.can_access_student(id));
create policy students_write  on public.students for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy enroll_select on public.student_enrollments for select to authenticated using (public.can_access_student(student_id));
create policy enroll_write  on public.student_enrollments for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy att_select on public.attendance for select to authenticated using (public.can_access_student(student_id));
create policy att_insert on public.attendance for insert to authenticated
  with check (public.is_admin() or public.teaches_class(class_id));
create policy att_update on public.attendance for update to authenticated
  using (public.is_admin() or public.teaches_class(class_id))
  with check (public.is_admin() or public.teaches_class(class_id));
create policy att_delete on public.attendance for delete to authenticated using (public.is_admin());

-- examinations & results
create policy exams_select on public.examinations for select to authenticated using (
  public.is_admin() or public.teaches_class(class_id)
  or (is_published and exists (select 1 from public.students s
        where s.class_id = examinations.class_id and public.can_access_student(s.id))));
create policy exams_write on public.examinations for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy results_select on public.exam_results for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.examinations e where e.id = exam_results.exam_id and (
      (e.is_published and public.can_access_student(exam_results.student_id))
      or exists (select 1 from public.teacher_assignments ta
                 where ta.teacher_id = public.my_teacher_id() and ta.class_id = e.class_id
                   and ta.subject_id = exam_results.subject_id)
      or exists (select 1 from public.classes c
                 where c.id = e.class_id and c.class_teacher_id = public.my_teacher_id()))));
create policy results_insert on public.exam_results for insert to authenticated with check (
  public.is_admin() or exists (
    select 1 from public.examinations e
    join public.teacher_assignments ta on ta.class_id = e.class_id
    where e.id = exam_results.exam_id and not e.is_published
      and ta.teacher_id = public.my_teacher_id() and ta.subject_id = exam_results.subject_id));
create policy results_update on public.exam_results for update to authenticated
  using (public.is_admin() or exists (
    select 1 from public.examinations e
    join public.teacher_assignments ta on ta.class_id = e.class_id
    where e.id = exam_results.exam_id and not e.is_published
      and ta.teacher_id = public.my_teacher_id() and ta.subject_id = exam_results.subject_id))
  with check (public.is_admin() or exists (
    select 1 from public.examinations e
    join public.teacher_assignments ta on ta.class_id = e.class_id
    where e.id = exam_results.exam_id and not e.is_published
      and ta.teacher_id = public.my_teacher_id() and ta.subject_id = exam_results.subject_id));
create policy results_delete on public.exam_results for delete to authenticated using (public.is_admin());

-- assignments & submissions
create policy asg_select on public.assignments for select to authenticated using (
  public.is_admin() or teacher_id = public.my_teacher_id() or public.teaches_class(class_id)
  or exists (select 1 from public.students s where s.class_id = assignments.class_id and public.can_access_student(s.id)));
create policy asg_write on public.assignments for all to authenticated
  using (public.is_admin() or (teacher_id = public.my_teacher_id() and public.teaches_class(class_id)))
  with check (public.is_admin() or (teacher_id = public.my_teacher_id() and public.teaches_class(class_id)));

create policy sub_select on public.assignment_submissions for select to authenticated using (public.can_access_student(student_id));
create policy sub_insert on public.assignment_submissions for insert to authenticated
  with check (student_id = public.my_student_id() and public.auth_role() = 'student');
create policy sub_update on public.assignment_submissions for update to authenticated
  using (student_id = public.my_student_id() or public.is_admin() or exists (
    select 1 from public.assignments a where a.id = assignment_id and a.teacher_id = public.my_teacher_id()))
  with check (student_id = public.my_student_id() or public.is_admin() or exists (
    select 1 from public.assignments a where a.id = assignment_id and a.teacher_id = public.my_teacher_id()));

-- fees (finance permission, families see only their own)
create policy fees_select on public.school_fees for select to authenticated using (
  public.has_perm('fees')
  or (public.is_family() and exists (select 1 from public.students s
        where s.class_id = school_fees.class_id and public.can_access_student(s.id))));
create policy fees_write on public.school_fees for all to authenticated using (public.has_perm('fees')) with check (public.has_perm('fees'));
create policy pay_select on public.fee_payments for select to authenticated using (
  public.has_perm('fees') or (public.is_family() and public.can_access_student(student_id)));
create policy pay_insert on public.fee_payments for insert to authenticated with check (public.has_perm('fees'));
create policy pay_update on public.fee_payments for update to authenticated using (public.has_perm('fees')) with check (public.has_perm('fees'));
create policy pay_delete on public.fee_payments for delete to authenticated using (public.is_super_admin());

-- announcements
create policy ann_public on public.announcements for select to anon using (published and is_public);
create policy ann_select on public.announcements for select to authenticated using (
  public.is_admin()
  or (published and public.auth_role() is not null
      and (is_public or 'all' = any (audience) or public.auth_role() = any (audience))));
create policy ann_write on public.announcements for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- admissions & contact: anyone may submit, only admins read
create policy adm_insert on public.admission_applications for insert to anon, authenticated
  with check (status = 'pending' and admin_note is null);
create policy adm_select on public.admission_applications for select to authenticated using (public.has_perm('admissions'));
create policy adm_update on public.admission_applications for update to authenticated using (public.has_perm('admissions')) with check (public.has_perm('admissions'));
create policy adm_delete on public.admission_applications for delete to authenticated using (public.has_perm('admissions'));

create policy msg_insert on public.contact_messages for insert to anon, authenticated with check (is_read = false);
create policy msg_select on public.contact_messages for select to authenticated using (public.is_admin());
create policy msg_update on public.contact_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy msg_delete on public.contact_messages for delete to authenticated using (public.is_admin());

-- notifications: own only; admins may send
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
create policy notif_insert on public.notifications for insert to authenticated with check (public.is_admin());

-- audit log: read-only for admins; rows are written by triggers
create policy audit_select on public.audit_logs for select to authenticated using (public.has_perm('audit'));

-- gallery
create policy gallery_read  on public.gallery_items for select to anon, authenticated using (true);
create policy gallery_write on public.gallery_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Realtime for the notification bell
alter publication supabase_realtime add table public.notifications;

-- 9. STORAGE -------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('gallery', 'gallery', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('submissions', 'submissions', false, 10485760,
   array['application/pdf','image/jpeg','image/png','text/plain',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy gallery_obj_read   on storage.objects for select using (bucket_id = 'gallery');
create policy gallery_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and public.is_admin());
create policy gallery_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'gallery' and public.is_admin());
create policy gallery_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and public.is_admin());

-- submissions are stored under  <student auth uid>/<file>
create policy subm_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and public.auth_role() = 'student'
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy subm_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or exists (select 1 from public.students s
               where s.profile_id::text = (storage.foldername(name))[1] and public.teaches_class(s.class_id))));
create policy subm_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);

-- 10. SEED -----------------------------------------------------------------------
-- One academic year so the dashboard has somewhere to start. No fake people or records.
insert into public.academic_years (name, start_date, end_date, is_current)
values ('2026/2027', '2026-09-01', '2027-07-31', true)
on conflict (name) do nothing;

-- ===== VERSION 2 ADDITIONS =====
-- A. GUARDIANS (a student can have more than one parent / guardian) ------
create table if not exists public.student_guardians (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete cascade,
  parent_id    uuid not null references public.parents(id) on delete cascade,
  relationship text check (char_length(relationship) <= 40),
  created_at   timestamptz not null default now(),
  unique (student_id, parent_id)
);
create index if not exists idx_guard_student on public.student_guardians (student_id);
create index if not exists idx_guard_parent  on public.student_guardians (parent_id);
alter table public.student_guardians enable row level security;

-- Is the signed-in parent a guardian (primary or additional) of this student?
create or replace function public.is_guardian_of(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.auth_role() = 'parent' and exists (
    select 1 from public.students s
    where s.id = sid and public.my_parent_id() is not null and (
      s.parent_id = public.my_parent_id()
      or exists (select 1 from public.student_guardians g where g.student_id = s.id and g.parent_id = public.my_parent_id())))
$$;

create or replace function public.can_access_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.students s
    where s.id = sid and (
      (s.profile_id = auth.uid() and public.auth_role() = 'student')
      or public.is_guardian_of(s.id)
      or public.teaches_class(s.class_id)
    )
  )
$$;

drop policy if exists guard_select on public.student_guardians;
drop policy if exists guard_write  on public.student_guardians;
create policy guard_select on public.student_guardians for select to authenticated using (public.can_access_student(student_id));
create policy guard_write  on public.student_guardians for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists parents_select on public.parents;
create policy parents_select on public.parents for select to authenticated using (
  public.is_admin() or id = public.my_parent_id()
  or exists (select 1 from public.students s
             where (s.parent_id = parents.id
                    or exists (select 1 from public.student_guardians g where g.student_id = s.id and g.parent_id = parents.id))
               and (s.profile_id = auth.uid() or public.teaches_class(s.class_id))));

-- Absence alerts now reach every guardian and return the user ids that were notified
drop function if exists public.notify_absent(uuid, date);
create or replace function public.notify_absent(p_class uuid, p_date date) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare ids uuid[] := '{}'; r record; u uuid; msg text;
begin
  if not (public.is_admin() or public.teaches_class(p_class)) then raise exception 'Not allowed'; end if;
  for r in
    select s.id, s.full_name, s.profile_id as sp, s.parent_id
    from public.attendance a join public.students s on s.id = a.student_id
    where a.class_id = p_class and a.attendance_date = p_date and a.status = 'absent'
  loop
    msg := r.full_name || ' was marked absent on ' || to_char(p_date, 'DD Mon YYYY') || '.';
    for u in
      select pr.profile_id from public.parents pr
      where pr.profile_id is not null and (pr.id = r.parent_id
            or exists (select 1 from public.student_guardians g where g.student_id = r.id and g.parent_id = pr.id))
    loop
      if not exists (select 1 from public.notifications where user_id = u and type = 'attendance' and body = msg) then
        insert into public.notifications (user_id, title, body, type, link)
        values (u, 'Absence alert: ' || r.full_name, msg, 'attendance', 'parent.html#/attendance');
        ids := ids || u;
      end if;
    end loop;
    if r.sp is not null and not exists (select 1 from public.notifications where user_id = r.sp and type = 'attendance' and body = msg) then
      insert into public.notifications (user_id, title, body, type, link)
      values (r.sp, 'You were marked absent', msg, 'attendance', 'student.html#/attendance');
    end if;
  end loop;
  return ids;
end $$;
grant execute on function public.notify_absent(uuid, date) to authenticated;

-- B. TIMETABLE ----------------------------------------------------------------
create table if not exists public.timetable_slots (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  subject_id  uuid references public.subjects(id) on delete set null,
  teacher_id  uuid references public.teachers(id) on delete set null,
  day_of_week smallint not null check (day_of_week between 1 and 7),   -- 1 = Monday
  start_time  time not null,
  end_time    time not null,
  room        text check (char_length(room) <= 40),
  label       text check (char_length(label) <= 60),                   -- e.g. Assembly, Break
  created_at  timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists idx_tt_class   on public.timetable_slots (class_id, day_of_week, start_time);
create index if not exists idx_tt_teacher on public.timetable_slots (teacher_id, day_of_week, start_time);
alter table public.timetable_slots enable row level security;

create or replace function public.check_timetable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.timetable_slots t
             where t.id is distinct from new.id and t.class_id = new.class_id and t.day_of_week = new.day_of_week
               and t.start_time < new.end_time and new.start_time < t.end_time) then
    raise exception 'This class already has something scheduled at that time';
  end if;
  if new.teacher_id is not null and exists (select 1 from public.timetable_slots t
             where t.id is distinct from new.id and t.teacher_id = new.teacher_id and t.day_of_week = new.day_of_week
               and t.start_time < new.end_time and new.start_time < t.end_time) then
    raise exception 'This teacher is already teaching another class at that time';
  end if;
  return new;
end $$;
drop trigger if exists trg_check_timetable on public.timetable_slots;
create trigger trg_check_timetable before insert or update on public.timetable_slots
  for each row execute function public.check_timetable();

drop policy if exists tt_read  on public.timetable_slots;
drop policy if exists tt_write on public.timetable_slots;
create policy tt_read  on public.timetable_slots for select to authenticated using (public.auth_role() is not null);
create policy tt_write on public.timetable_slots for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- C. MESSAGES -------------------------------------------------------------------
create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  sender_id      uuid not null references public.profiles(id) on delete cascade,
  recipient_id   uuid not null references public.profiles(id) on delete cascade,
  sender_name    text, sender_role text, recipient_name text, recipient_role text,
  subject        text check (char_length(subject) <= 150),
  body           text not null check (char_length(body) between 1 and 3000),
  is_read        boolean not null default false,
  created_at     timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists idx_msg_recipient on public.messages (recipient_id, is_read, created_at desc);
create index if not exists idx_msg_sender    on public.messages (sender_id, created_at desc);
alter table public.messages enable row level security;

create or replace function public.teacher_serves_class(tprofile uuid, cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teachers t where t.profile_id = tprofile and (
    exists (select 1 from public.teacher_assignments ta where ta.teacher_id = t.id and ta.class_id = cid)
    or exists (select 1 from public.classes c where c.id = cid and c.class_teacher_id = t.id)))
$$;

-- Who may write to whom:
--  admins <-> everyone, teachers <-> teachers,
--  teachers <-> parents/students of classes they teach.
create or replace function public.can_message_user(target uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me text := public.auth_role(); tr text;
begin
  if me is null or target = auth.uid() then return false; end if;
  select role into tr from public.profiles where id = target and is_active;
  if tr is null then return false; end if;
  if me in ('super_admin','school_admin') or tr in ('super_admin','school_admin') then return true; end if;
  if me = 'teacher' then
    if tr = 'teacher' then return true; end if;
    return exists (select 1 from public.students s where public.teaches_class(s.class_id) and (
        s.profile_id = target
        or s.parent_id in (select id from public.parents where profile_id = target)
        or exists (select 1 from public.student_guardians g join public.parents p on p.id = g.parent_id
                   where g.student_id = s.id and p.profile_id = target)));
  end if;
  if tr = 'teacher' then
    return exists (select 1 from public.students s where public.teacher_serves_class(target, s.class_id) and (
        (me = 'student' and s.profile_id = auth.uid())
        or (me = 'parent' and public.is_guardian_of(s.id))));
  end if;
  return false;
end $$;

create or replace function public.message_contacts() returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role from public.profiles p
  where p.is_active and p.id <> auth.uid() and public.can_message_user(p.id)
  order by p.role, p.full_name limit 500
$$;
grant execute on function public.message_contacts() to authenticated;

create or replace function public.before_message_save() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.can_message_user(new.recipient_id) then raise exception 'You cannot message that person'; end if;
    select full_name, role into new.sender_name, new.sender_role from public.profiles where id = new.sender_id;
    select full_name, role into new.recipient_name, new.recipient_role from public.profiles where id = new.recipient_id;
    new.is_read := false;
  else   -- only the read flag may change
    new.sender_id := old.sender_id; new.recipient_id := old.recipient_id; new.subject := old.subject;
    new.body := old.body; new.created_at := old.created_at; new.sender_name := old.sender_name;
    new.sender_role := old.sender_role; new.recipient_name := old.recipient_name; new.recipient_role := old.recipient_role;
  end if;
  return new;
end $$;
drop trigger if exists trg_message_save on public.messages;
create trigger trg_message_save before insert or update on public.messages
  for each row execute function public.before_message_save();

create or replace function public.after_message_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, title, body, type, link)
  values (new.recipient_id, 'New message from ' || coalesce(new.sender_name, 'someone'),
          left(coalesce(nullif(new.subject, ''), new.body), 120), 'message',
          case when new.recipient_role in ('super_admin','school_admin') then 'admin.html#/inbox'
               else new.recipient_role || '.html#/messages' end);
  return new;
end $$;
drop trigger if exists trg_message_after on public.messages;
create trigger trg_message_after after insert on public.messages
  for each row execute function public.after_message_insert();

drop policy if exists msg2_select on public.messages;
drop policy if exists msg2_insert on public.messages;
drop policy if exists msg2_update on public.messages;
create policy msg2_select on public.messages for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy msg2_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.auth_role() is not null and public.can_message_user(recipient_id));
create policy msg2_update on public.messages for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- D. PAYMENT CLAIMS (parent reports a mobile-money / bank payment, office verifies) ---
create table if not exists public.payment_claims (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students(id) on delete cascade,
  fee_id        uuid references public.school_fees(id) on delete set null,
  amount        numeric(12,2) not null check (amount > 0),
  method        text not null default 'mobile_money' check (method in ('cash','bank_transfer','mobile_money','card','cheque')),
  reference     text not null check (char_length(reference) between 3 and 80),
  paid_on       date not null default current_date,
  note          text check (char_length(note) <= 500),
  proof_path    text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_by  uuid references public.profiles(id) on delete set null,
  reviewed_by   uuid references auth.users(id) on delete set null,
  review_note   text,
  payment_id    uuid references public.fee_payments(id) on delete set null,
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);
create index if not exists idx_claims_status  on public.payment_claims (status, created_at desc);
create index if not exists idx_claims_student on public.payment_claims (student_id);
alter table public.payment_claims enable row level security;

drop policy if exists claims_select on public.payment_claims;
drop policy if exists claims_insert on public.payment_claims;
drop policy if exists claims_update on public.payment_claims;
create policy claims_select on public.payment_claims for select to authenticated using (
  public.has_perm('fees') or submitted_by = auth.uid() or (public.is_family() and public.can_access_student(student_id)));
create policy claims_insert on public.payment_claims for insert to authenticated with check (
  public.is_family() and public.can_access_student(student_id) and submitted_by = auth.uid() and status = 'pending');
create policy claims_update on public.payment_claims for update to authenticated
  using (public.has_perm('fees')) with check (public.has_perm('fees'));

create or replace function public.notify_admins_new_claim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, title, body, type, link)
  select p.id, 'Payment to verify', 'Reference ' || new.reference || ' for ' || new.amount::text,
         'fees', 'admin.html#/fees'
  from public.profiles p where p.role in ('super_admin','school_admin') and p.is_active
    and (p.role = 'super_admin' or coalesce(p.permissions ->> 'fees', 'true') <> 'false');
  return new;
end $$;
drop trigger if exists trg_new_claim on public.payment_claims;
create trigger trg_new_claim after insert on public.payment_claims
  for each row execute function public.notify_admins_new_claim();

-- E. PHOTOS --------------------------------------------------------------------------
-- staff-photos: public (teachers shown on the website). student-photos: private, signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('staff-photos', 'staff-photos', true, 2097152, array['image/jpeg','image/png','image/webp']),
  ('student-photos', 'student-photos', false, 2097152, array['image/jpeg','image/png','image/webp']),
  ('payment-proofs', 'payment-proofs', false, 5242880, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists staffph_read   on storage.objects;
drop policy if exists staffph_write  on storage.objects;
drop policy if exists staffph_update on storage.objects;
drop policy if exists staffph_delete on storage.objects;
create policy staffph_read   on storage.objects for select using (bucket_id = 'staff-photos');
create policy staffph_write  on storage.objects for insert to authenticated with check (bucket_id = 'staff-photos' and public.is_admin());
create policy staffph_update on storage.objects for update to authenticated using (bucket_id = 'staff-photos' and public.is_admin());
create policy staffph_delete on storage.objects for delete to authenticated using (bucket_id = 'staff-photos' and public.is_admin());

-- student photos live at  <student id>/photo.<ext>
drop policy if exists stuph_read   on storage.objects;
drop policy if exists stuph_write  on storage.objects;
drop policy if exists stuph_update on storage.objects;
drop policy if exists stuph_delete on storage.objects;
create policy stuph_read on storage.objects for select to authenticated
  using (bucket_id = 'student-photos' and public.can_access_student(((storage.foldername(name))[1])::uuid));
create policy stuph_write  on storage.objects for insert to authenticated with check (bucket_id = 'student-photos' and public.is_admin());
create policy stuph_update on storage.objects for update to authenticated using (bucket_id = 'student-photos' and public.is_admin());
create policy stuph_delete on storage.objects for delete to authenticated using (bucket_id = 'student-photos' and public.is_admin());

-- payment proofs live at  <user id>/<file>
drop policy if exists proof_insert on storage.objects;
drop policy if exists proof_read   on storage.objects;
create policy proof_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and public.is_family() and (storage.foldername(name))[1] = auth.uid()::text);
create policy proof_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('fees')));

-- F. AUDIT the new tables ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['timetable_slots','payment_claims','student_guardians'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
