-- =====================================================================
--  BAKARR SCHOOL - VERSION 3 ADDITIONS
--  * Fresh install: this is already appended to schema.sql, run schema.sql only.
--  * Existing install (you already ran schema.sql with version 2): run THIS file once.
--  Adds: online quizzes (auto-marked), library, staff payroll and leave,
--        student discipline records, health profiles and sick bay visits.
--  Safe to run twice. Requires the version 2 additions (is_guardian_of etc.).
-- =====================================================================

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

-- C. STAFF PAYROLL AND LEAVE ----------------------------------------------------------------
-- Payroll is sensitive, so unlike the other modules a school administrator does NOT get it
-- unless a super administrator switches it on (User accounts > shield icon).
create or replace function public.has_payroll_access() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and (
    public.auth_role() = 'super_admin'
    or coalesce((select permissions ->> 'payroll' from public.profiles where id = auth.uid()), 'false') = 'true')
$$;

-- Pay is only visible to administrators with the "payroll" module and to each teacher for
-- their own payslips once they are marked paid.
create table if not exists public.staff_pay_profiles (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null unique references public.teachers(id) on delete cascade,
  base_salary numeric(12,2) not null default 0 check (base_salary >= 0),
  allowances  numeric(12,2) not null default 0 check (allowances >= 0),
  deductions  numeric(12,2) not null default 0 check (deductions >= 0),
  updated_at  timestamptz not null default now()
);

create table if not exists public.payslips (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  period     date not null check (period = date_trunc('month', period)::date),   -- first day of the month
  basic      numeric(12,2) not null check (basic >= 0),
  allowances numeric(12,2) not null default 0 check (allowances >= 0),
  deductions numeric(12,2) not null default 0 check (deductions >= 0),
  net        numeric(12,2) generated always as (basic + allowances - deductions) stored,
  note       text check (char_length(note) <= 300),
  status     text not null default 'draft' check (status in ('draft','paid')),
  paid_on    date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (teacher_id, period),
  check (basic + allowances - deductions >= 0)
);
create index if not exists idx_payslips_period on public.payslips (period desc);

alter table public.staff_pay_profiles enable row level security;
alter table public.payslips           enable row level security;

drop trigger if exists trg_paypro_upd on public.staff_pay_profiles;
create trigger trg_paypro_upd before update on public.staff_pay_profiles
  for each row execute function public.set_updated_at();

create or replace function public.guard_payslip() returns trigger
language plpgsql security definer set search_path = public as $$
declare tp uuid;
begin
  if tg_op = 'UPDATE' and old.status = 'paid' then
    if new.status <> 'paid' or new.basic <> old.basic or new.allowances <> old.allowances or new.deductions <> old.deductions
       or new.teacher_id <> old.teacher_id or new.period <> old.period then
      raise exception 'A payslip that has been paid cannot be changed';
    end if;
  end if;
  if new.status = 'paid' and new.paid_on is null then new.paid_on := current_date; end if;
  if new.status = 'draft' then new.paid_on := null; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists trg_guard_payslip on public.payslips;
create trigger trg_guard_payslip before insert or update on public.payslips
  for each row execute function public.guard_payslip();

create or replace function public.after_payslip_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    perform public.add_notification((select profile_id from public.teachers where id = new.teacher_id),
      'Your payslip is ready', 'Payslip for ' || to_char(new.period, 'FMMonth YYYY') || ' has been issued.', 'payroll', 'teacher.html#/payslips');
  end if;
  return null;
end $$;
drop trigger if exists trg_payslip_paid on public.payslips;
create trigger trg_payslip_paid after insert or update on public.payslips
  for each row execute function public.after_payslip_paid();

drop policy if exists paypro_all     on public.staff_pay_profiles;
drop policy if exists payslip_select on public.payslips;
drop policy if exists payslip_insert on public.payslips;
drop policy if exists payslip_update on public.payslips;
drop policy if exists payslip_delete on public.payslips;
create policy paypro_all on public.staff_pay_profiles for all to authenticated
  using (public.has_payroll_access()) with check (public.has_payroll_access());
create policy payslip_select on public.payslips for select to authenticated
  using (public.has_payroll_access() or (status = 'paid' and teacher_id = public.my_teacher_id()));
create policy payslip_insert on public.payslips for insert to authenticated with check (public.has_payroll_access());
create policy payslip_update on public.payslips for update to authenticated using (public.has_payroll_access()) with check (public.has_payroll_access());
create policy payslip_delete on public.payslips for delete to authenticated using (public.has_payroll_access() and status = 'draft');

-- One draft payslip per active teacher that has a pay profile, for the month of p_period
create or replace function public.generate_payslips(p_period date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_payroll_access() then raise exception 'Not allowed'; end if;
  insert into public.payslips (teacher_id, period, basic, allowances, deductions)
  select p.teacher_id, date_trunc('month', p_period)::date, p.base_salary, p.allowances, p.deductions
  from public.staff_pay_profiles p join public.teachers t on t.id = p.teacher_id
  where t.status = 'active' and p.base_salary > 0
  on conflict (teacher_id, period) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Mark every draft payslip of a month as paid (each teacher is notified)
create or replace function public.mark_payslips_paid(p_period date, p_paid_on date default current_date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_payroll_access() then raise exception 'Not allowed'; end if;
  update public.payslips set status = 'paid', paid_on = coalesce(p_paid_on, current_date)
  where period = date_trunc('month', p_period)::date and status = 'draft';
  get diagnostics n = row_count;
  return n;
end $$;

-- Leave: Monday to Friday only count as leave days
create or replace function public.working_days(a date, b date) returns int
language sql immutable as $$
  select count(*)::int from generate_series(0, b - a) g where extract(isodow from (a + g)) < 6
$$;

create table if not exists public.leave_requests (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.teachers(id) on delete cascade,
  leave_type  text not null check (leave_type in ('annual','sick','maternity','paternity','compassionate','study','unpaid','other')),
  start_date  date not null,
  end_date    date not null,
  days        int generated always as (public.working_days(start_date, end_date)) stored,
  reason      text check (char_length(reason) <= 1000),
  status      text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (char_length(review_note) <= 500),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 365)
);
create index if not exists idx_leave_teacher on public.leave_requests (teacher_id, start_date desc);
create index if not exists idx_leave_status  on public.leave_requests (status, created_at desc);
alter table public.leave_requests enable row level security;

create or replace function public.guard_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.teacher_id is distinct from public.my_teacher_id() then raise exception 'You can only request leave for yourself'; end if;
      new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    else   -- a teacher may only cancel their own pending request
      if old.status <> 'pending' or new.status <> 'cancelled' then raise exception 'Only a pending request can be cancelled'; end if;
      new.teacher_id := old.teacher_id; new.leave_type := old.leave_type; new.start_date := old.start_date;
      new.end_date := old.end_date; new.reason := old.reason; new.review_note := old.review_note;
      new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    end if;
  else
    if tg_op = 'INSERT' and new.status in ('approved','rejected') then new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
    if tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved','rejected') then new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
  end if;
  if new.status in ('pending','approved') and exists (
      select 1 from public.leave_requests l
      where l.teacher_id = new.teacher_id and l.id is distinct from new.id and l.status in ('pending','approved')
        and l.start_date <= new.end_date and new.start_date <= l.end_date) then
    raise exception 'There is already a leave request covering some of these dates';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_leave on public.leave_requests;
create trigger trg_guard_leave before insert or update on public.leave_requests
  for each row execute function public.guard_leave();

create or replace function public.after_leave_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; r record;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select full_name into who from public.teachers where id = new.teacher_id;
    for r in select p.id from public.profiles p where p.role in ('super_admin','school_admin') and p.is_active loop
      perform public.add_notification(r.id, 'Leave request', coalesce(who, 'A teacher') || ' asked for ' || new.leave_type || ' leave ('
        || to_char(new.start_date, 'DD Mon') || ' to ' || to_char(new.end_date, 'DD Mon YYYY') || ').', 'leave', 'admin.html#/leave');
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved','rejected') then
    perform public.add_notification((select profile_id from public.teachers where id = new.teacher_id),
      'Leave request ' || new.status, 'Your ' || new.leave_type || ' leave from ' || to_char(new.start_date, 'DD Mon') || ' to '
        || to_char(new.end_date, 'DD Mon YYYY') || ' was ' || new.status || coalesce('. ' || new.review_note, '.'), 'leave', 'teacher.html#/leave');
  end if;
  return null;
end $$;
drop trigger if exists trg_leave_after on public.leave_requests;
create trigger trg_leave_after after insert or update on public.leave_requests
  for each row execute function public.after_leave_change();

drop policy if exists leave_select on public.leave_requests;
drop policy if exists leave_insert on public.leave_requests;
drop policy if exists leave_update on public.leave_requests;
drop policy if exists leave_delete on public.leave_requests;
create policy leave_select on public.leave_requests for select to authenticated
  using (public.is_admin() or teacher_id = public.my_teacher_id());
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (public.is_admin() or (teacher_id = public.my_teacher_id() and status = 'pending'));
create policy leave_update on public.leave_requests for update to authenticated
  using (public.is_admin() or (teacher_id = public.my_teacher_id() and status = 'pending'))
  with check (public.is_admin() or teacher_id = public.my_teacher_id());
create policy leave_delete on public.leave_requests for delete to authenticated using (public.is_admin());

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
revoke execute on function public.generate_payslips(date)           from public, anon;
revoke execute on function public.mark_payslips_paid(date, date)    from public, anon;
grant execute on function public.save_quiz_questions(uuid, jsonb)  to authenticated;
grant execute on function public.start_quiz(uuid)                  to authenticated;
grant execute on function public.submit_quiz(uuid, jsonb)          to authenticated;
grant execute on function public.quiz_review(uuid, uuid)           to authenticated;
grant execute on function public.notify_overdue_loans()            to authenticated;
grant execute on function public.generate_payslips(date)           to authenticated;
grant execute on function public.mark_payslips_paid(date, date)    to authenticated;

-- F. AUDIT the new tables -----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['quizzes','library_books','library_loans','staff_pay_profiles','payslips',
                           'leave_requests','discipline_records','student_health_profiles','sickbay_visits'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
