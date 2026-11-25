-- =====================================================================
--  ALFRIAN INT'L ACADEMY - VERSION 5 ADDITIONS
--  * Fresh install: already appended to schema.sql, run schema.sql only.
--  * Existing install: run THIS file once (after upgrade-v4.sql). Safe to run twice.
--  Adds: staff attendance (with scan check-in), BECE / WASSCE results, past question library.
-- =====================================================================

-- A. STAFF ATTENDANCE --------------------------------------------------------------
create table if not exists public.staff_attendance (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid not null references public.teachers(id) on delete cascade,
  attendance_date date not null,
  status          text not null check (status in ('present','late','absent','leave')),
  checked_in_at   timestamptz,
  note            text check (char_length(note) <= 300),
  marked_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (teacher_id, attendance_date)
);
create index if not exists idx_staff_att_date on public.staff_attendance (attendance_date);
alter table public.staff_attendance enable row level security;
drop policy if exists staff_att_select on public.staff_attendance;
drop policy if exists staff_att_write  on public.staff_attendance;
create policy staff_att_select on public.staff_attendance for select to authenticated
  using (public.is_admin() or teacher_id = public.my_teacher_id());
create policy staff_att_write on public.staff_attendance for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- B. NATIONAL EXAMINATIONS (BECE / WASSCE) ------------------------------------------
create table if not exists public.national_exam_results (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete cascade,
  exam_type    text not null check (exam_type in ('BECE','WASSCE')),
  exam_year    int  not null check (exam_year between 2000 and 2100),
  index_number text check (char_length(index_number) <= 30),
  subject      text not null check (char_length(subject) between 2 and 80),
  grade        text not null check (char_length(grade) between 1 and 4),
  entered_by   uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now(),
  unique (student_id, exam_type, exam_year, subject)
);
create index if not exists idx_nat_exam on public.national_exam_results (exam_type, exam_year);
alter table public.national_exam_results enable row level security;
drop policy if exists nat_select on public.national_exam_results;
drop policy if exists nat_write  on public.national_exam_results;
create policy nat_select on public.national_exam_results for select to authenticated
  using (public.can_access_student(student_id));
create policy nat_write on public.national_exam_results for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop trigger if exists trg_nat_updated on public.national_exam_results;
create trigger trg_nat_updated before update on public.national_exam_results
  for each row execute function public.set_updated_at();

-- C. PAST QUESTIONS --------------------------------------------------------------------
create table if not exists public.past_questions (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 150),
  subject_id  uuid references public.subjects(id) on delete set null,
  level       text check (char_length(level) <= 40),
  kind        text not null default 'Other' check (kind in ('BECE','WASSCE','Mock','Term test','Other')),
  exam_year   int check (exam_year between 1980 and 2100),
  file_path   text not null check (char_length(file_path) <= 300),
  file_name   text not null check (char_length(file_name) <= 200),
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_pq_subject on public.past_questions (subject_id);
alter table public.past_questions enable row level security;
drop policy if exists pq_select on public.past_questions;
drop policy if exists pq_insert on public.past_questions;
drop policy if exists pq_delete on public.past_questions;
create policy pq_select on public.past_questions for select to authenticated using (true);
create policy pq_insert on public.past_questions for insert to authenticated
  with check (public.is_admin() or public.auth_role() = 'teacher');
create policy pq_delete on public.past_questions for delete to authenticated
  using (public.is_admin() or uploaded_by = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('past-questions', 'past-questions', false, 15728640,
   array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
drop policy if exists pqobj_read   on storage.objects;
drop policy if exists pqobj_insert on storage.objects;
drop policy if exists pqobj_delete on storage.objects;
create policy pqobj_read on storage.objects for select to authenticated using (bucket_id = 'past-questions');
create policy pqobj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'past-questions' and (public.is_admin() or public.auth_role() = 'teacher'));
create policy pqobj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'past-questions' and (public.is_admin() or owner = auth.uid()));

-- D. AUDIT --------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['staff_attendance','national_exam_results','past_questions'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
