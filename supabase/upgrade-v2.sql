-- =====================================================================
--  BAKARR SCHOOL - VERSION 2 ADDITIONS
--  * Fresh install: this is already appended to schema.sql, run schema.sql only.
--  * Existing install (you already ran the first schema.sql): run THIS file once.
--  Adds: several guardians per student, timetable, in-app messages,
--        payment claims, student/staff photos. Safe to run twice.
-- =====================================================================

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
