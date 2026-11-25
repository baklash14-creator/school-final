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

-- ===== VERSION 3 ADDITIONS =====

-- 0. SHARED HELPERS ----------------------------------------------------------------

-- Is the signed-in student (or the parent of a student) in this class?
create or replace function public.in_class_family(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    where s.class_id = cid and s.status = 'active' and (
      (s.profile_id = auth.uid() and public.auth_role() = 'student')
      or public.is_guardian_of(s.id)))
$$;

-- Does the signed-in teacher teach the class this student is in?
create or replace function public.teaches_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s where s.id = sid and public.teaches_class(s.class_id))
$$;

-- Profile ids of every parent / guardian of a student (used by notices; not callable from the browser)
create or replace function public.guardian_profile_ids(sid uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select pr.profile_id from public.parents pr
  where pr.profile_id is not null and (
    pr.id = (select parent_id from public.students where id = sid)
    or exists (select 1 from public.student_guardians g where g.student_id = sid and g.parent_id = pr.id))
$$;

-- Insert one in-app notification; with p_dedupe it skips an identical one sent today
create or replace function public.add_notification(p_user uuid, p_title text, p_body text, p_type text, p_link text, p_dedupe boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return false; end if;
  if p_dedupe and exists (select 1 from public.notifications
      where user_id = p_user and type = p_type and title = p_title and body = p_body and created_at::date = current_date) then
    return false;
  end if;
  insert into public.notifications (user_id, title, body, type, link) values (p_user, p_title, p_body, p_type, p_link);
  return true;
end $$;

revoke execute on function public.guardian_profile_ids(uuid) from public, anon, authenticated;
revoke execute on function public.add_notification(uuid, text, text, text, text, boolean) from public, anon, authenticated;

-- A. ONLINE QUIZZES ------------------------------------------------------------------
-- Answer keys live in their own table and are never readable by students. Marking is done
-- by submit_quiz(), so the score cannot be tampered with from the browser.
create table if not exists public.quizzes (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid not null references public.classes(id) on delete cascade,
  subject_id       uuid references public.subjects(id) on delete set null,
  teacher_id       uuid references public.teachers(id) on delete set null,
  title            text not null check (char_length(title) between 3 and 150),
  instructions     text check (char_length(instructions) <= 2000),
  duration_minutes int check (duration_minutes between 1 and 300),
  opens_at         timestamptz,
  closes_at        timestamptz,
  show_answers     boolean not null default true,
  is_published     boolean not null default false,
  created_at       timestamptz not null default now(),
  check (closes_at is null or opens_at is null or closes_at > opens_at)
);
create index if not exists idx_quizzes_class   on public.quizzes (class_id, created_at desc);
create index if not exists idx_quizzes_teacher on public.quizzes (teacher_id);

create table if not exists public.quiz_questions (
  id         uuid primary key default gen_random_uuid(),
  quiz_id    uuid not null references public.quizzes(id) on delete cascade,
  position   int not null default 1,
  question   text not null check (char_length(question) between 3 and 1000),
  options    jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  marks      numeric(5,2) not null default 1 check (marks > 0 and marks <= 100),
  created_at timestamptz not null default now()
);
create index if not exists idx_quiz_q_quiz on public.quiz_questions (quiz_id, position);

create table if not exists public.quiz_answer_keys (
  question_id   uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_index smallint not null check (correct_index between 0 and 5)
);

create table if not exists public.quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  answers      jsonb not null default '{}'::jsonb,
  score        numeric(7,2),
  total        numeric(7,2),
  overtime     boolean not null default false,
  unique (quiz_id, student_id)
);
create index if not exists idx_quiz_att_student on public.quiz_attempts (student_id);

alter table public.quizzes          enable row level security;
alter table public.quiz_questions   enable row level security;
alter table public.quiz_answer_keys enable row level security;
alter table public.quiz_attempts    enable row level security;

-- Admin, or the teacher who owns the quiz
create or replace function public.owns_quiz(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.quizzes q where q.id = qid and q.teacher_id is not null and q.teacher_id = public.my_teacher_id())
$$;

drop policy if exists quizzes_select on public.quizzes;
drop policy if exists quizzes_insert on public.quizzes;
drop policy if exists quizzes_update on public.quizzes;
drop policy if exists quizzes_delete on public.quizzes;
create policy quizzes_select on public.quizzes for select to authenticated
  using (public.owns_quiz(id) or (is_published and public.in_class_family(class_id)));
create policy quizzes_insert on public.quizzes for insert to authenticated
  with check (public.is_admin() or (teacher_id = public.my_teacher_id() and public.teaches_class(class_id)));
create policy quizzes_update on public.quizzes for update to authenticated
  using (public.owns_quiz(id))
  with check (public.is_admin() or (teacher_id = public.my_teacher_id() and public.teaches_class(class_id)));
create policy quizzes_delete on public.quizzes for delete to authenticated using (public.owns_quiz(id));

-- Students can read the questions only once they have started the quiz. No write policies:
-- questions are saved through save_quiz_questions() below.
drop policy if exists quizq_select on public.quiz_questions;
create policy quizq_select on public.quiz_questions for select to authenticated using (
  public.owns_quiz(quiz_id)
  or exists (select 1 from public.quiz_attempts a where a.quiz_id = quiz_questions.quiz_id and a.student_id = public.my_student_id()));

drop policy if exists quizk_select on public.quiz_answer_keys;
create policy quizk_select on public.quiz_answer_keys for select to authenticated
  using (public.owns_quiz((select q.quiz_id from public.quiz_questions q where q.id = question_id)));

drop policy if exists quiza_select on public.quiz_attempts;
create policy quiza_select on public.quiz_attempts for select to authenticated
  using (public.owns_quiz(quiz_id) or (public.is_family() and public.can_access_student(student_id)));

-- Replace all questions of a quiz in one step. p_questions: [{question, options:[..], correct, marks}]
create or replace function public.save_quiz_questions(p_quiz uuid, p_questions jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare item jsonb; qid uuid; pos int := 0; opts jsonb; ci int;
begin
  if not public.owns_quiz(p_quiz) then raise exception 'You cannot change this quiz'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then raise exception 'Questions must be a list'; end if;
  if jsonb_array_length(p_questions) > 100 then raise exception 'A quiz can have at most 100 questions'; end if;
  if exists (select 1 from public.quiz_attempts where quiz_id = p_quiz) then
    raise exception 'Students have already started this quiz, so its questions can no longer be changed. Create a new quiz instead.';
  end if;
  delete from public.quiz_questions where quiz_id = p_quiz;
  for item in select * from jsonb_array_elements(p_questions) loop
    pos := pos + 1;
    opts := item -> 'options';
    if opts is null or jsonb_typeof(opts) <> 'array' or jsonb_array_length(opts) not between 2 and 6 then
      raise exception 'Question % needs between 2 and 6 answer options', pos;
    end if;
    if exists (select 1 from jsonb_array_elements(opts) o where jsonb_typeof(o) <> 'string' or btrim(o #>> '{}') = '') then
      raise exception 'Question % has an empty answer option', pos;
    end if;
    if (item ->> 'correct') !~ '^[0-9]+$' then raise exception 'Question % needs a correct answer', pos; end if;
    ci := (item ->> 'correct')::int;
    if ci >= jsonb_array_length(opts) then raise exception 'Question % needs a correct answer', pos; end if;
    insert into public.quiz_questions (quiz_id, position, question, options, marks)
    values (p_quiz, pos, left(btrim(coalesce(item ->> 'question', '')), 1000), opts,
            coalesce(nullif(item ->> 'marks', '')::numeric, 1))
    returning id into qid;
    insert into public.quiz_answer_keys (question_id, correct_index) values (qid, ci);
  end loop;
  return pos;
end $$;

-- A student starts a quiz: this opens their one attempt and starts the clock.
-- Returns {started_at, server_now} so the countdown does not depend on the device clock.
create or replace function public.start_quiz(p_quiz uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid := public.my_student_id(); q public.quizzes; started timestamptz;
begin
  if public.auth_role() <> 'student' or sid is null then raise exception 'Only students can take quizzes'; end if;
  select * into q from public.quizzes where id = p_quiz and is_published;
  if not found then raise exception 'This quiz is not available'; end if;
  if not exists (select 1 from public.students where id = sid and class_id = q.class_id and status = 'active') then
    raise exception 'This quiz is not for your class';
  end if;
  if not exists (select 1 from public.quiz_attempts where quiz_id = p_quiz and student_id = sid) then
    if q.opens_at is not null and now() < q.opens_at then raise exception 'This quiz has not opened yet'; end if;
    if q.closes_at is not null and now() > q.closes_at then raise exception 'This quiz has closed'; end if;
    if not exists (select 1 from public.quiz_questions where quiz_id = p_quiz) then raise exception 'This quiz has no questions yet'; end if;
    insert into public.quiz_attempts (quiz_id, student_id) values (p_quiz, sid);
  end if;
  select started_at into started from public.quiz_attempts where quiz_id = p_quiz and student_id = sid;
  return jsonb_build_object('started_at', started, 'server_now', now());
end $$;

-- A student hands in answers: {"<question id>": <chosen option index>}. Returns {score,total}.
create or replace function public.submit_quiz(p_quiz uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid := public.my_student_id(); a public.quiz_attempts; q public.quizzes;
        sc numeric := 0; tot numeric := 0; r record; pick text; clean jsonb := '{}'::jsonb;
begin
  if public.auth_role() <> 'student' or sid is null then raise exception 'Only students can take quizzes'; end if;
  select * into a from public.quiz_attempts where quiz_id = p_quiz and student_id = sid for update;
  if not found then raise exception 'Start the quiz first'; end if;
  if a.submitted_at is not null then raise exception 'You have already handed in this quiz'; end if;
  select * into q from public.quizzes where id = p_quiz;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then p_answers := '{}'::jsonb; end if;
  for r in
    select qq.id, qq.marks, k.correct_index
    from public.quiz_questions qq join public.quiz_answer_keys k on k.question_id = qq.id
    where qq.quiz_id = p_quiz
  loop
    tot := tot + r.marks;
    pick := p_answers ->> r.id::text;
    if pick ~ '^[0-9]+$' then
      clean := clean || jsonb_build_object(r.id::text, pick::int);
      if pick::int = r.correct_index then sc := sc + r.marks; end if;
    end if;
  end loop;
  update public.quiz_attempts set
    answers = clean, score = sc, total = tot, submitted_at = now(),
    overtime = (q.duration_minutes is not null and now() > a.started_at + (q.duration_minutes + 2) * interval '1 minute')
  where id = a.id;
  return jsonb_build_object('score', sc, 'total', tot);
end $$;

-- Questions with the right answers and one student's choices, for review after handing in
create or replace function public.quiz_review(p_quiz uuid, p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q public.quizzes; a public.quiz_attempts; res jsonb;
begin
  select * into q from public.quizzes where id = p_quiz;
  if not found then raise exception 'Quiz not found'; end if;
  select * into a from public.quiz_attempts where quiz_id = p_quiz and student_id = p_student;
  if not found or a.submitted_at is null then raise exception 'There is no handed-in attempt to review'; end if;
  if not (public.owns_quiz(p_quiz) or (q.show_answers and public.is_family() and public.can_access_student(p_student))) then
    raise exception 'You cannot review this attempt';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', qq.id, 'question', qq.question, 'options', qq.options, 'marks', qq.marks,
           'correct', k.correct_index, 'answer', a.answers -> (qq.id::text)) order by qq.position), '[]'::jsonb)
    into res
    from public.quiz_questions qq join public.quiz_answer_keys k on k.question_id = qq.id
    where qq.quiz_id = p_quiz;
  return res;
end $$;

-- B. LIBRARY ----------------------------------------------------------------------------
create table if not exists public.library_books (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 200),
  author     text check (char_length(author) <= 150),
  isbn       text check (char_length(isbn) <= 20),
  category   text check (char_length(category) <= 60),
  shelf      text check (char_length(shelf) <= 40),
  copies     int not null default 1 check (copies between 0 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists idx_lib_books_title on public.library_books (lower(title));

create table if not exists public.library_loans (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.library_books(id) on delete cascade,
  student_id  uuid references public.students(id) on delete cascade,
  teacher_id  uuid references public.teachers(id) on delete cascade,
  borrowed_on date not null default current_date,
  due_on      date not null,
  returned_on date,
  fine_amount numeric(10,2) not null default 0 check (fine_amount >= 0),
  note        text check (char_length(note) <= 300),
  issued_by   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((student_id is not null)::int + (teacher_id is not null)::int = 1),
  check (due_on >= borrowed_on),
  check (returned_on is null or returned_on >= borrowed_on)
);
create unique index if not exists uq_loan_open_student on public.library_loans (book_id, student_id) where returned_on is null and student_id is not null;
create unique index if not exists uq_loan_open_teacher on public.library_loans (book_id, teacher_id) where returned_on is null and teacher_id is not null;
create index if not exists idx_loans_book    on public.library_loans (book_id);
create index if not exists idx_loans_student on public.library_loans (student_id);
create index if not exists idx_loans_teacher on public.library_loans (teacher_id);
create index if not exists idx_loans_open    on public.library_loans (due_on) where returned_on is null;

alter table public.library_books enable row level security;
alter table public.library_loans enable row level security;

-- Copies on the shelf = copies owned minus open loans. A view owned by the database lets
-- every signed-in user see availability without seeing other people's loans.
create or replace view public.library_catalog as
  select b.id, b.title, b.author, b.isbn, b.category, b.shelf, b.copies, b.created_at,
         greatest(b.copies - coalesce(l.out_now, 0), 0)::int as available
  from public.library_books b
  left join (select book_id, count(*)::int as out_now from public.library_loans where returned_on is null group by book_id) l
    on l.book_id = b.id
  where public.auth_role() is not null;
revoke all on public.library_catalog from anon;
grant select on public.library_catalog to authenticated;

create or replace function public.check_loan() returns trigger
language plpgsql security definer set search_path = public as $$
declare c int; out_now int;
begin
  if new.returned_on is null and (tg_op = 'INSERT' or old.returned_on is not null) then
    select copies into c from public.library_books where id = new.book_id for update;
    select count(*) into out_now from public.library_loans
      where book_id = new.book_id and returned_on is null and id is distinct from new.id;
    if out_now >= coalesce(c, 0) then raise exception 'No copies of this book are available right now'; end if;
  end if;
  if tg_op = 'INSERT' then new.issued_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists trg_check_loan on public.library_loans;
create trigger trg_check_loan before insert or update on public.library_loans
  for each row execute function public.check_loan();

drop policy if exists lbook_read  on public.library_books;
drop policy if exists lbook_write on public.library_books;
create policy lbook_read  on public.library_books for select to authenticated using (public.auth_role() is not null);
create policy lbook_write on public.library_books for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists lloan_read  on public.library_loans;
drop policy if exists lloan_write on public.library_loans;
create policy lloan_read on public.library_loans for select to authenticated using (
  public.is_admin()
  or (student_id is not null and student_id = public.my_student_id())
  or (teacher_id is not null and teacher_id = public.my_teacher_id())
  or (student_id is not null and public.is_guardian_of(student_id)));
create policy lloan_write on public.library_loans for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Remind everybody who has an overdue book (students, their parents, teachers). Returns how many notices were sent.
create or replace function public.notify_overdue_loans() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; u uuid; msg text;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  for r in
    select l.id, l.due_on, b.title, l.student_id, s.full_name as sname, s.profile_id as sp, t.profile_id as tp
    from public.library_loans l
    join public.library_books b on b.id = l.book_id
    left join public.students s on s.id = l.student_id
    left join public.teachers t on t.id = l.teacher_id
    where l.returned_on is null and l.due_on < current_date
  loop
    msg := '"' || r.title || '" was due on ' || to_char(r.due_on, 'DD Mon YYYY') || '. Please return it to the library.';
    if r.student_id is not null then
      if public.add_notification(r.sp, 'Overdue library book', msg, 'library', 'student.html#/library', true) then n := n + 1; end if;
      for u in select public.guardian_profile_ids(r.student_id) loop
        if public.add_notification(u, 'Overdue library book: ' || r.sname, msg, 'library', 'parent.html#/library', true) then n := n + 1; end if;
      end loop;
    else
      if public.add_notification(r.tp, 'Overdue library book', msg, 'library', 'teacher.html#/library', true) then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

-- D. DISCIPLINE, HEALTH AND SICK BAY --------------------------------------------------------
create table if not exists public.discipline_records (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students(id) on delete cascade,
  kind              text not null default 'incident' check (kind in ('incident','commendation')),
  category          text not null check (char_length(category) between 2 and 40),
  severity          text check (severity in ('minor','moderate','serious')),
  incident_date     date not null default current_date,
  description       text not null check (char_length(description) between 3 and 2000),
  action_taken      text check (char_length(action_taken) <= 1000),
  share_with_family boolean not null default true,
  reported_by       uuid references auth.users(id) on delete set null,
  reporter_name     text,
  created_at        timestamptz not null default now(),
  check (kind = 'commendation' or severity is not null)
);
create index if not exists idx_disc_student on public.discipline_records (student_id, incident_date desc);
alter table public.discipline_records enable row level security;

create or replace function public.before_discipline_save() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.reported_by := auth.uid();
    select full_name into new.reporter_name from public.profiles where id = auth.uid();
  else
    new.student_id := old.student_id; new.reported_by := old.reported_by; new.reporter_name := old.reporter_name;
  end if;
  if new.kind = 'commendation' then new.severity := null; end if;
  return new;
end $$;
drop trigger if exists trg_discipline_save on public.discipline_records;
create trigger trg_discipline_save before insert or update on public.discipline_records
  for each row execute function public.before_discipline_save();

-- Parents hear about it straight away (a commendation also goes to the student)
create or replace function public.after_discipline_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record; u uuid; ttl text;
begin
  if not new.share_with_family then return null; end if;
  select full_name, profile_id into s from public.students where id = new.student_id;
  ttl := case when new.kind = 'commendation' then 'Commendation: ' else 'Conduct note: ' end || coalesce(s.full_name, 'your child');
  for u in select public.guardian_profile_ids(new.student_id) loop
    perform public.add_notification(u, ttl, left(new.category || '. ' || new.description, 140), 'conduct', 'parent.html#/conduct');
  end loop;
  if new.kind = 'commendation' then
    perform public.add_notification(s.profile_id, 'You received a commendation', left(new.category || '. ' || new.description, 140), 'conduct', 'student.html#/conduct');
  end if;
  return null;
end $$;
drop trigger if exists trg_discipline_after on public.discipline_records;
create trigger trg_discipline_after after insert on public.discipline_records
  for each row execute function public.after_discipline_insert();

drop policy if exists disc_select on public.discipline_records;
drop policy if exists disc_insert on public.discipline_records;
drop policy if exists disc_update on public.discipline_records;
drop policy if exists disc_delete on public.discipline_records;
create policy disc_select on public.discipline_records for select to authenticated using (
  public.is_admin() or public.teaches_student(student_id)
  or (share_with_family and public.is_family() and public.can_access_student(student_id)));
create policy disc_insert on public.discipline_records for insert to authenticated
  with check (public.is_admin() or public.teaches_student(student_id));
create policy disc_update on public.discipline_records for update to authenticated
  using (public.is_admin() or reported_by = auth.uid()) with check (public.is_admin() or reported_by = auth.uid());
create policy disc_delete on public.discipline_records for delete to authenticated
  using (public.is_admin() or reported_by = auth.uid());

-- Health profile: one row per student. Parents keep it up to date; teachers of the class can read it.
create table if not exists public.student_health_profiles (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null unique references public.students(id) on delete cascade,
  blood_group     text check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  allergies       text check (char_length(allergies) <= 500),
  conditions      text check (char_length(conditions) <= 500),
  medications     text check (char_length(medications) <= 500),
  emergency_name  text check (char_length(emergency_name) <= 120),
  emergency_phone text check (char_length(emergency_phone) <= 30),
  doctor_name     text check (char_length(doctor_name) <= 120),
  doctor_phone    text check (char_length(doctor_phone) <= 30),
  notes           text check (char_length(notes) <= 1000),
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);
alter table public.student_health_profiles enable row level security;

create or replace function public.before_health_save() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists trg_health_save on public.student_health_profiles;
create trigger trg_health_save before insert or update on public.student_health_profiles
  for each row execute function public.before_health_save();

drop policy if exists health_select on public.student_health_profiles;
drop policy if exists health_insert on public.student_health_profiles;
drop policy if exists health_update on public.student_health_profiles;
drop policy if exists health_delete on public.student_health_profiles;
create policy health_select on public.student_health_profiles for select to authenticated using (public.can_access_student(student_id));
create policy health_insert on public.student_health_profiles for insert to authenticated with check (public.is_admin() or public.is_guardian_of(student_id));
create policy health_update on public.student_health_profiles for update to authenticated
  using (public.is_admin() or public.is_guardian_of(student_id)) with check (public.is_admin() or public.is_guardian_of(student_id));
create policy health_delete on public.student_health_profiles for delete to authenticated using (public.is_admin());

-- Sick bay register: written by the office / school nurse (administrators), readable by the family
create table if not exists public.sickbay_visits (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students(id) on delete cascade,
  visited_at    timestamptz not null default now(),
  complaint     text not null check (char_length(complaint) between 3 and 500),
  temperature   numeric(4,1) check (temperature between 30 and 45),
  treatment     text check (char_length(treatment) <= 1000),
  outcome       text not null default 'returned_to_class'
                check (outcome in ('returned_to_class','resting','sent_home','referred','emergency')),
  notify_family boolean not null default true,
  recorded_by   uuid references auth.users(id) on delete set null,
  recorder_name text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_sickbay_student on public.sickbay_visits (student_id, visited_at desc);
alter table public.sickbay_visits enable row level security;

create or replace function public.before_sickbay_save() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
    select full_name into new.recorder_name from public.profiles where id = auth.uid();
  else
    new.student_id := old.student_id; new.recorded_by := old.recorded_by; new.recorder_name := old.recorder_name;
  end if;
  return new;
end $$;
drop trigger if exists trg_sickbay_save on public.sickbay_visits;
create trigger trg_sickbay_save before insert or update on public.sickbay_visits
  for each row execute function public.before_sickbay_save();

create or replace function public.after_sickbay_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text; u uuid;
begin
  if not new.notify_family then return null; end if;
  select full_name into nm from public.students where id = new.student_id;
  for u in select public.guardian_profile_ids(new.student_id) loop
    perform public.add_notification(u, 'Sick bay visit: ' || coalesce(nm, 'your child'),
      left(new.complaint, 100) || ' (' || replace(new.outcome, '_', ' ') || ')', 'health', 'parent.html#/health');
  end loop;
  return null;
end $$;
drop trigger if exists trg_sickbay_after on public.sickbay_visits;
create trigger trg_sickbay_after after insert on public.sickbay_visits
  for each row execute function public.after_sickbay_insert();

drop policy if exists sickbay_select on public.sickbay_visits;
drop policy if exists sickbay_write  on public.sickbay_visits;
create policy sickbay_select on public.sickbay_visits for select to authenticated
  using (public.is_admin() or (public.is_family() and public.can_access_student(student_id)));
create policy sickbay_write on public.sickbay_visits for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- E. RPC PERMISSIONS --------------------------------------------------------------------------
revoke execute on function public.save_quiz_questions(uuid, jsonb)  from public, anon;
revoke execute on function public.start_quiz(uuid)                  from public, anon;
revoke execute on function public.submit_quiz(uuid, jsonb)          from public, anon;
revoke execute on function public.quiz_review(uuid, uuid)           from public, anon;
revoke execute on function public.notify_overdue_loans()            from public, anon;
grant execute on function public.save_quiz_questions(uuid, jsonb)  to authenticated;
grant execute on function public.start_quiz(uuid)                  to authenticated;
grant execute on function public.submit_quiz(uuid, jsonb)          to authenticated;
grant execute on function public.quiz_review(uuid, uuid)           to authenticated;
grant execute on function public.notify_overdue_loans()            to authenticated;

-- F. AUDIT the new tables -----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['quizzes','library_books','library_loans',
                           'discipline_records','student_health_profiles','sickbay_visits'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ===== VERSION 4 ADDITIONS =====
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
