# Alfrian Int'l Academy & Sec. Sch.: school management website

Public website, animated sign-in, and four role-based portals (administrator, teacher, student, parent) on **Supabase** (PostgreSQL, Auth, Storage, Row Level Security) with a plain HTML, CSS and JavaScript front end. There is no build step.

## What is included

| Area | Files |
|---|---|
| Public website | `index.html`, `css/site.css`, `js/site.js` |
| Animated sign-in + password reset | `login.html`, `reset.html`, `css/auth.css`, `js/login.js` |
| Portals | `admin.html`, `teacher.html`, `student.html`, `parent.html`, `js/pages/*.js`, `css/app.css` |
| Database, security, storage | `supabase/schema.sql` (fresh install), `supabase/upgrade-v2.sql` (only if you already ran the first version), `supabase/upgrade-v3.sql`, `supabase/upgrade-v4.sql`, `supabase/upgrade-v5.sql`, `supabase/upgrade-v6.sql` (each only if you installed before that version) |
| Server functions | `supabase/functions/admin-users`, `notify-external` (email/SMS), `payment-webhook` (automatic online payments) |
| Settings | `js/config.js` |
| Hosting headers | `vercel.json` |

**Features:** student, teacher, parent, class and subject management; promotions; class capacity; attendance with absence alerts and monthly reports; examinations, score entry, automatic grades, report cards with class position, publish results; fee structure, payments, receipts, outstanding balances, reminders, financial report; announcements and events; admissions with public tracking code; user accounts, roles, per-module permissions, password reset, activate/deactivate; seven reports exported to Excel or PDF; in-app notifications (live) with optional email/SMS; audit log; photo gallery; assignments with file submission.

**Added in version 2:** bulk import of students, teachers and parents from CSV or Excel; student and teacher photos; printable student ID cards with a scannable barcode; several parents or guardians per student; weekly timetable with clash detection; in-app messaging between parents, students, teachers and the office; parents can report mobile-money or bank payments for the office to verify, plus an optional webhook for automatic online payments; an Email, SMS and payments page with a real test send.

## 1. Create the Supabase project

1. Go to supabase.com, create a project, and wait for it to finish starting.
2. Open **SQL Editor > New query**, paste the whole of `supabase/schema.sql` (already includes versions 2 to 6; if you ran an older copy earlier, run `supabase/upgrade-v2.sql`, then `upgrade-v3.sql`, then `upgrade-v4.sql`, then `upgrade-v5.sql`, then `upgrade-v6.sql` instead; each can be run again safely), and press **Run**. It creates every table, index, relationship, Row Level Security policy, trigger, storage bucket and one academic year (`2026/2027`). It adds no fake students or staff.
3. **Authentication > Sign In / Providers > Email**: turn **off** "Allow new users to sign up". Accounts are created by administrators only. Email confirmation can stay on or off; accounts made by the admin are pre-confirmed.
4. **Authentication > URL Configuration**: set **Site URL** to your live address (for example `https://your-school.vercel.app`) and add `https://YOUR-DOMAIN/reset.html` to **Redirect URLs**. Password-reset emails need this.

## 2. Create the first Super Administrator

1. **Authentication > Users > Add user > Create new user**. Enter your email and a strong password and tick **Auto Confirm User**.
2. In **SQL Editor** run (use your email):

```sql
update public.profiles
set role = 'super_admin', is_active = true, full_name = 'Your Name'
where email = 'you@example.com';
```

## 3. Deploy the Edge Functions

`admin-users` is required: it creates accounts, resets passwords and changes roles, which needs the secret service key that must never be in the browser.

With the Supabase CLI (https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy admin-users
supabase functions deploy notify-external   # optional, for email/SMS
supabase functions deploy payment-webhook --no-verify-jwt   # optional, for automatic online payments
```

Or in the dashboard: **Edge Functions > Deploy a new function**, name it `admin-users`, paste the contents of `supabase/functions/admin-users/index.ts`. Leave "Verify JWT" on.

**Optional email/SMS** (`notify-external`): set secrets `RESEND_API_KEY`, `EMAIL_FROM`, and for SMS `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, then set `EXTERNAL_NOTIFICATIONS: true` in `js/config.js`. Afterwards open **Email, SMS, payments** in the admin menu: it shows which channels are connected and sends you a real test.

**Optional online payments** (`payment-webhook`): `supabase secrets set PAYMENT_WEBHOOK_SECRET=<long random text>`. Give your payment provider the address shown on the admin **Email, SMS, payments** page, with the header `x-webhook-secret`. The expected JSON is described at the top of `supabase/functions/payment-webhook/index.ts`; most providers need a small adapter that maps their fields to it. Without a provider, parents can still report a payment and you approve it under **School fees > Payment claims**.

## 4. Connect the website

Open `js/config.js` and set:

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (**Project Settings > API**). Use the **anon/public** key only. Never put the `service_role` key in any front-end file.
- School name, motto, address, phone, email, hours, the list of levels, and `CURRENCY`.

Try it locally: `npx serve .` (or `python3 -m http.server 8000`) and open the address shown. The files use ES modules, so opening them by double-click will not work.

## 5. Publish the website

Supabase hosts the database and logins but does not serve websites well (Storage serves HTML as plain text). Host the static files on any free static host. Recommended: GitHub + Vercel.

1. Create a GitHub repository and upload everything in this folder.
2. In Vercel: **Add New > Project**, import the repository, **Framework Preset: Other**, leave build command and output directory empty, **Deploy**.
3. Add your Vercel address to Supabase **Site URL** and **Redirect URLs** (step 1.4).

Netlify, Cloudflare Pages and GitHub Pages also work with no changes.

## 6. First day setup (in this order)

Sign in at `/login.html` as the Super Administrator, then:

1. **Classes** (set capacity and level) and **Subjects**.
2. **Class subjects**: choose which subjects each class studies.
3. **Teachers**, then use the subject icon on a teacher to assign classes and subjects.
4. **Parents**, then **Students** (pick the parent and class; the student ID is generated, for example `BKR-2026-0001`).
5. **School fees > Fee structure**, one fee per class per term.
6. Give people logins: click the key icon on a student, teacher or parent row, or use **User accounts > Create account**. Share the temporary password.
7. Add a few **Announcements** with "Show on public website" ticked, and photos under **Photo gallery**.

**Added in version 3:**
- **Online quizzes** (`js/pages/quizzes.js`): teachers and admins build multiple-choice quizzes, set a time limit and an open window, and publish. Students take them in the portal with a countdown; marking is done by the database and the answer key is never sent to the browser while a quiz is open. Questions lock once anyone has attempted the quiz. Parents see quiz results.
- **Library** (`js/pages/library.js`): book catalogue, lending to students or teachers, returns with optional fines, copies-available tracking, and overdue reminders (students, parents and teachers are notified, once a day). Students and teachers can browse the shelf; parents see their child's loans.
- **Conduct, health and sickbay** (`js/pages/wellbeing.js`): teachers and admins record incidents and commendations (teachers only for students they teach; each can be hidden from parents). Parents keep their child's health profile up to date (allergies, conditions, emergency contacts); class teachers can read it. The office logs sickbay visits and the parents are notified.

**Added in version 4:**
- **School calendar** (`js/pages/calendar.js`): a month view in every portal showing terms, exams, holidays and events. Administrators add events under **School calendar > Manage events**, choose who sees each one (everyone, teachers, students or parents) and can send a notification when saving.
- **Parent-teacher meetings** (`js/pages/meetings.js`): teachers publish several back-to-back time slots at once; parents book one with a teacher of their child (one meeting per child per teacher) or cancel it again. Both sides get notifications; the database stops double bookings.
- **Certificates with QR verification** (`js/pages/certificates.js`, `verify.html`): administrators issue certificates (merit, completion, attendance, conduct, sports); students and parents are notified and can print them. Every certificate has a code and a QR code that opens `verify.html`, a public page that confirms it is genuine or tells you it was revoked. The QR picture is drawn with the `qrcode-generator` library from cdnjs; without internet the printed address and code still work.
- **Insights dashboard** (`js/pages/admin-insights.js`): enrolment, 30-day attendance by class, fees collected per month, fees still owed, grade spread and students with the most absences.
- **Installable app** (`manifest.json`, `sw.js`, `js/pwa.js`): browsers offer "Install app". Pages open again without a connection from a saved copy of the site's own files; data from Supabase is never stored by the service worker. Requires HTTPS (Vercel provides it).

**Added in version 5:**
- **Scan attendance** (`js/pages/attendance-extra.js`): a scan station for pupils and staff. A USB barcode scanner reads the barcode on the ID card (it holds the student or staff number); typing the number and pressing Enter works too, and browsers that support it can use the camera. Arrivals after the "late after" time are marked late; a sound confirms each scan.
- **Staff attendance**: daily register, monthly P/L/A/V report with Excel and PDF export, printable staff badges with a barcode, and a "My attendance" page for teachers. Only administrators can write staff attendance; each teacher sees only their own.
- **BECE and WASSCE results** (`js/pages/national.js`): administrators enter index numbers and subject grades, see a per-subject report (credit passes for WASSCE) and export it. Students and parents see their own results.
- **Past questions** (`js/pages/past-questions.js`): teachers and administrators upload papers (PDF, Word, JPG, PNG up to 15 MB) to a private storage bucket; every signed-in user can search and open them.
- **Class grade sheets** (`js/pages/gradesheet.js`): per-subject averages, total, average, grade and position for a term or the whole year, printable and exportable. Administrators see every class; teachers see their own.

**Added in version 6:**
- **Login activity** (`js/login-log.js`, **Audit logs > Login activity**): every successful and failed sign-in is listed with the person's name, ID and role, device (for example "Mobile (Android - Chrome)"), place, IP address, network provider and time, and can be searched, filtered by result or role, and exported. The previous change log is the second tab. The database reads the IP address from the request itself and fills in the name, role and ID of successful sign-ins, so the browser cannot fake them; entries cannot be edited or deleted, and failed attempts are throttled so the form cannot flood the table. The place and network come from a free lookup at `ipwho.is` made by the visitor's browser (it sees the visitor's IP address); if that is blocked the log shows "Unknown" for them. Only people with the Audit logs permission can read the log.

## Roles and security

| Role | Can do |
|---|---|
| Super Administrator | Everything, including other administrators, deleting payments, audit log |
| School Administrator | Everything except managing admin accounts; modules (fees, admissions, users, audit) can be switched off per person in **User accounts > shield icon** |
| Teacher | Own classes and students, attendance, scores for their own subjects (until published), assignments and grading |
| Student | Own results (once published), attendance, assignments, fees and receipts, quizzes, library loans, shared conduct notes |
| Parent | The same for each linked child, plus the child's health profile (editable) |

- **Row Level Security is on for every table.** The browser only ever holds the anon key; what a user can read or change is decided by the database. One function, `can_access_student()`, guards private academic records: only the student, their parent, a teacher of their class, or an admin.
- Roles come from `app_metadata` (settable only by the service role), so users cannot give themselves a role. A trigger blocks changes to role, status and permissions by non-admins.
- Passwords are hashed by Supabase Auth. Sessions auto-refresh and end after 30 idle minutes (`IDLE_MINUTES`). The sign-in page locks for 30 seconds after 5 failed attempts.
- Grades are calculated by the database, so they cannot be tampered with from the browser. Teachers cannot edit scores after results are published.
- The audit log is written by database triggers (create, update, delete on the main tables) plus logins and report generation. It is read-only.
- Uploads are restricted by type and size at both the app and storage-bucket level. Student submissions are private to the student, their teachers and admins.
- Public forms (admission, contact) have length limits in the database, a honeypot field, and a client cool-down. For heavy abuse add Supabase's CAPTCHA protection.

## Good to know

- **Row limits:** Supabase returns at most 1000 rows per request by default. That covers most schools; for more, raise **Project Settings > API > Max rows** (reports and exports use up to 1000 rows per query).
- **Grade scale:** A 80+, B 70+, C 60+, D 50+, E 40+, F below. It is defined in `public.grade_for()` in the SQL and in `js/config.js`; change both together.
- **Public staff list** only shows teachers with "Show on public website" ticked, and only name, title, qualification and photo.
- **Currency:** `CURRENCY: 'SLE'` is a default. Change it to your own ISO code.

## Testing checklist

This code was syntax-checked and run in a browser against a mock of Supabase (every page loaded and rendered without errors). It has not been run against your live project, so please walk through this once after deploying:

1. Sign in as Super Administrator; the dashboard loads.
2. Create a class, subject, teacher, parent and student; assign them; create logins for a teacher, a student and a parent.
3. Sign in as the teacher: take attendance with one absent student (the parent should get a notification).
4. As admin: create an exam, enter scores as the teacher, publish, and confirm the student and parent can see only their own results.
5. Record a payment, print the receipt, and check the outstanding report.
6. Submit an admission on the public site and track it with its code.
7. Try to open `admin.html` while signed in as a student; you should be sent to the student portal.
8. Import a few rows with **Students > Import**, add a photo with the camera icon, print an ID card, add a second guardian with the people icon and confirm that parent sees the child.
9. Build a class timetable and confirm a clashing lesson is refused; sign in as a teacher and parent to view it.
10. Send a message from the parent to a teacher of the child's class and reply.
11. As a parent choose **School fees > Report a payment**; as admin approve it under Payment claims and confirm a receipt appears.
12. With email/SMS keys set, use **Email, SMS, payments > Send test message**.
13. Version 3: as a teacher build a quiz with two questions and publish it; as the student take it and see the score; check the student cannot take it twice.
14. Lend a library book to a student; confirm the shelf count drops, then return it.
15. As a teacher record an incident for a student you teach (try one you do not teach; it must be refused); as the parent fill in the health profile and view the shared conduct note.
16. Version 4: add a calendar event (tick the notification) and confirm each role sees only the events meant for it; as a teacher publish meeting slots, as the parent book one, then cancel it and watch both notifications; issue a certificate, open its `verify.html` link and revoke it to see the page change; open the site on a phone and choose Install app.
17. Version 5: print an ID card and scan its barcode at **Scan attendance** (check it lands in Attendance); do the same for a staff badge; enter a WASSCE result for a student and open it from the student's portal; upload a past paper as a teacher and open it as a student; open **Grade sheets** for a class that has scores.
18. Version 6: sign out, try a wrong password, then sign in properly; open **Audit logs > Login activity** and check both attempts appear with device, place and IP.

**Not run against live services:** the new features were tested in a browser against a mock of Supabase. Email, SMS and payment providers need your own accounts, so those paths, and storage uploads, have not been exercised end to end.

## Customising

All colours are CSS variables at the top of `css/app.css`. Replace `assets/logo.svg` with your own logo (and the inline copy in `js/ui.js` as `LOGO`).


## House-plan guide

`plan.html` is a static floor-plan guide to the portal: each room is a module, with a role filter and links into each portal. `assets/house-plan.png` is a picture of it. Linked from the home page and sign-in page.

## Backup and import

Admin menu, Backup and import (needs the `users` permission): download any main table as CSV or everything as one JSON file, and bulk-add pupils from a CSV (template provided; validates rows, skips duplicates by name and birth date, max 1000 rows). No database change needed.
