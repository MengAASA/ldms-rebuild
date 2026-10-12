# Phase 2: Training core

Build plan for LDMS v2 phase 2. Written 29 Sep 2026, at the end of phase 1, so a new session can start without the
earlier conversation. Read with `README.md` (overview, security, decisions) and `CLAUDE.md` (conventions).

**How to work:** one module at a time, in the order below. After each module: typecheck, lint, unit tests, e2e tests,
screenshots at desktop and phone width, then stop and show the user before starting the next module.

---

## 1. Where things stand

- **Phase 1 (foundation) is done**: sign-in, permissions, org chart, staff, Excel import/export, audit log, data checks,
  and a security review with fixes (see README → Security).
- **Stack**: Next.js 16 (App Router, `src/proxy.ts` instead of middleware), React 19, TypeScript strict, Prisma 6 on
  MySQL 8 (database `ldms_v2`), Auth.js v5 (credentials), Zod 4, Tailwind 4, ExcelJS, Vitest, Playwright (installed Edge).
- **Dev**: `npm run dev` → http://localhost:3006/phn-ldms (base path `/phn-ldms`, see README → Where things are). Demo sign-ins, password `Ldms@2026`: 10001 L&D admin, 10002 main clerk,
  10003 clerk, 10231 HOD Stamping. Other seeded staff: migrated password `phn12345`.
- **Confirmed rules**: staff report to their department HOD; **HODs and division heads have no approver in LDMS**.
- **Still unconfirmed**: sign-in by staff no. only (Microsoft Entra later).

## 2. Scope

**In phase 2**

1. Trainings: Public / In-house, OJT and Departmental, in one model, with optional sessions. (Public and In-house
   were merged into one type on 29 Sep 2026 at the user's request.)
2. Participants and attendance: PENDING, COMPLETED or ABSENT.
3. My Training: each person's trainings, the feedback form (16 questions), self-recorded OJT.
4. OJT for clerks: bulk entry and Excel import with preview.
5. Certificates: upload and download per participant.
6. Reports: per-training attendance, hours per staff and per department, audit report, Excel exports.

**Not in phase 2** (don't build yet)

- PME, TNA, TNI, skill matrix: phase 3. But design `Participant` so phase 3 can attach one `Pme` per participant.
- Dashboards with charts, reminder emails, the daily job: phase 4.
- Importing the old database: phase 5 (but keep `legacySource`/`legacyId` columns now).

## 3. Questions for the user before starting

**Answered 29 Sep 2026: the user chose the default for all seven.** (Question 5 was later overtaken: the form now follows
the old system's fields; see module 1.) Q1–Q2 stay as `TODO` placeholders in
`src/lib/forms/feedback.ts` until L&D supplies the wording.

Ask these first. The default applies if the user has no preference.

| # | Question | Default if not answered |
|---|---|---|
| 1 | The 16 feedback questions: wording, answer scale per question, which are required | Build with the form versioned (`feedbackVersion = 1`) and placeholder wording clearly marked `TODO` in one file, so the wording can be swapped without code changes elsewhere |
| 2 | The 3 answers staff give when they record their own OJT | Same approach: placeholders in the form definition file |
| 3 | Certificate storage and limits | Folder `uploads/certificates/` (outside `public/`, git-ignored), PDF/JPG/PNG, max 5 MB, served only through a permission-checked route |
| 4 | Clerks' existing OJT Excel layout | Design a template like the staff import one |
| 5 | Extra training fields (course code, category, HRDF-claimable, provider…) | Include `code`, `provider`, `category` (free text), `hrdfClaimable` (boolean); all optional |
| 6 | When may staff fill in the feedback form: from the start date or only after the end date? | From the **end date** (old system sent reminders after the training ended) |
| 7 | What exactly was the old "audit report"? | A list of trainings in a date range with each participant's attendance, hours and certificate status, for ISO audits |

## 4. Conventions to follow (from phase 1)

- **Layers**: pages and server actions never write through Prisma directly. They call a service in
  `src/server/services/*`, which calls `ensure(user, permission)`, applies rules from `src/server/rules/*` (pure
  functions, no Prisma, unit-tested) and writes an `AuditLog` entry in the **same transaction** (`recordAudit`, `diffFields`).
- **Auth**: every page calls `requireUser()` or `requirePermission()`; every server action calls `requireUser()` first;
  route handlers call `getCurrentUser()` and check `mustChangePassword` and the permission. Never `redirect()` from a
  layout (it loops during client navigation).
- **Permissions**: add new ones to `Permission` and `ROLE_PERMISSIONS` in `src/server/permissions.ts`; check with `can()`.
  Record-level checks (like `canManageStaffRecord`) take a typed shape that forces callers to load what the check needs.
- **Validation**: Zod schemas in `src/lib/validation/*.ts`, parsed with `parseForm()`; errors become form state through
  `toErrorState()`. Business-rule failures throw `UserError` with a plain-language message.
- **Forms**: client forms use `useFormAction()` (no React form reset on error), `Field` + `fieldProps()`, `SubmitButton`.
  Required fields get `required` (red asterisk). Short confirmations and small forms go in `DialogButton`/`ConfirmDialog`.
  Keep a dialog mounted when the action changes the page under it (see `hideTrigger` in `Dialog.tsx`).
- **Dropdowns**: always `src/components/ui/Select.tsx` (groups, hints, search on long lists). Never a native `<select>`.
- **Pages**: `PageHeader` with a `module` (icon tile and colour). List pages with long tables use the `page-fit` +
  `table-scroll` classes (table fills the screen and scrolls on its own). White `Panel`s only for self-contained blocks.
- **Design** (redesigned 01 Oct 2026, see README → Design notes): light sidebar, white `.card`s, bento overview,
  `TrainingCover` for trainings. Colour tokens in `src/app/globals.css`. Primary navy `#17324D` (primary buttons, hero card), learning accent
  teal `#167D7F` (links, focus, current location), background `#F6F8FA`, text `#1F2933`/`#667085`, border `#D9E0E6`,
  success `#2E7D5B`, warning `#B7791F`, danger `#C0392B`. Status is a dot plus words (`Status`), never a filled badge.
  Plain-language labels and hints; explain *why* an action is blocked. Staff no., dates and hours use the `num` class.
  Dates shown as `03 Apr 2017` (`formatDate`), Malaysia time (`nowInMalaysia`). No gradients, glows or decoration.
- **Navigation**: screens appear in the sidebar only once built, grouped by what people do (see §7).
- **Excel import**: follow `src/server/services/staffImport.ts`: header-matched columns, per-row errors, preview, then
  commit that re-reads and re-validates the same file, optional "skip rows with errors", template download route.
- **Tests**: rules → `tests/rules/*.test.ts` (Vitest). Flows → `tests/e2e/*.spec.ts` (Playwright, one worker, uses the
  `choose()` helper for Select, relative paths such as `page.goto("trainings")` because of the base path). E2e tests create their own records with unique numbers and restore shared demo data
  in `finally`.
- **Windows**: stop the dev server before `prisma migrate dev`/`generate` (it locks the query engine DLL).
- **Base path**: plain `<a href>` (downloads) must use `withBasePath()` from `src/lib/base-path.ts`; `Link` and
  `redirect()` add it themselves.
- **Next 16**: read `node_modules/next/dist/docs/` before using an API you're unsure of. `params`/`searchParams` are
  promises; `forbidden()` needs `experimental.authInterrupts` (already on).

## 5. Data model (add to `prisma/schema.prisma`)

```prisma
enum TrainingType {
  PUBLIC_INHOUSE // a course run by an external provider, at their venue or at PHN
  OJT          // on-the-job training
  DEPARTMENTAL // run by a department for its own staff
}

enum TrainingStatus {
  SCHEDULED
  CANCELLED
}

enum Attendance {
  PENDING
  COMPLETED
  ABSENT
}

enum ParticipantSource {
  ADMIN   // added by L&D
  CLERK   // OJT entered or imported by a clerk
  SELF    // OJT recorded by the staff member
  IMPORT  // Excel import
}

model Training {
  id            Int             @id @default(autoincrement())
  type          TrainingType
  title         String          @db.VarChar(200)
  code          String?         @db.VarChar(40)
  provider      String?         @db.VarChar(160) // training provider / organiser
  trainerName   String?         @db.VarChar(160)
  venue         String?         @db.VarChar(160)
  category      String?         @db.VarChar(80)
  hrdfClaimable Boolean         @default(false)
  cost          Decimal?        @db.Decimal(12, 2) // RM, whole course
  description   String?         @db.Text
  startDate     DateTime        @db.Date
  endDate       DateTime        @db.Date
  startTime     DateTime        @db.Time(0)
  endTime       DateTime        @db.Time(0)
  status        TrainingStatus  @default(SCHEDULED)
  departmentId  Int?            // organising department (DEPARTMENTAL, and OJT)
  createdById   Int?
  legacySource  String?         @db.VarChar(10) // "training" | "ojt": old IDs overlap between tables
  legacyId      Int?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  department    Department?     @relation(fields: [departmentId], references: [id])
  sessions      TrainingSession[]
  participants  Participant[]

  @@unique([legacySource, legacyId])
  @@index([type, startDate])   // replaces the old *_archive tables
  @@index([startDate])
}

// Optional. Only for trainings whose days are not consecutive or whose times
// differ per day. Without sessions, hours come from the date range × daily hours.
model TrainingSession {
  id         Int      @id @default(autoincrement())
  trainingId Int
  date       DateTime @db.Date
  startTime  DateTime @db.Time(0)
  endTime    DateTime @db.Time(0)
  training   Training @relation(fields: [trainingId], references: [id], onDelete: Cascade)

  @@unique([trainingId, date, startTime])
}

model Participant {
  id                  Int               @id @default(autoincrement())
  trainingId          Int
  staffId             Int
  attendance          Attendance        @default(PENDING)
  source              ParticipantSource @default(ADMIN)
  recordedById        Int?              // who added the row (clerk, admin or the staff member)
  attendanceReason    String?           @db.VarChar(255) // why absent, or why marked completed on their behalf
  feedback            Json?             // answers, shape checked by the Zod schema for feedbackVersion
  feedbackVersion     Int?
  submittedAt         DateTime?
  certificateFile     String?           @db.VarChar(255) // stored name under uploads/certificates
  certificateName     String?           @db.VarChar(255) // original file name, for download
  certificateAt       DateTime?
  legacyId            Int?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  training            Training          @relation(fields: [trainingId], references: [id])
  staff               Staff             @relation(fields: [staffId], references: [id])
  // phase 3: pme Pme?

  @@unique([trainingId, staffId])
  @@index([staffId, attendance])
  @@index([attendance, trainingId])
}
```

Also add the back-relations on `Staff` (`participants Participant[]`) and `Department` (`trainings Training[]`), and
`"Training" | "Participant"` to the audit `entity` union in `src/server/services/audit.ts`.

## 6. Business rules (`src/server/rules/training.ts`, all unit-tested)

| Rule | Detail |
|---|---|
| `trainingHours(t)` | **The single definition of hours.** Without sessions: `(endDate − startDate + 1 days) × (endTime − startTime)`. With sessions: sum of each session's `endTime − startTime`. Round to 2 decimals. End time must be after start time (no overnight). Test: 1 day 08:30–17:30 = 9 h; 3 days 09:00–13:00 = 12 h; sessions 2×4 h = 8 h. |
| `countsTowardHours(p)` | Only when `attendance === "COMPLETED"` and the training is not CANCELLED. |
| Attendance transitions | PENDING → COMPLETED when the participant submits the feedback form (or admin marks it, with a reason, for people who can't use a computer). PENDING → ABSENT by admin, reason optional. ABSENT → PENDING (undo) by admin. COMPLETED → PENDING only by admin ("reopen"), audited. Nothing else. |
| Feedback availability | Form opens on the training's end date (see question 6) and stays open while attendance is PENDING. |
| OJT self-record | Saved directly as COMPLETED, source SELF, with the 3 OJT answers. |
| OJT edit/delete | Staff can edit and **delete** OJT they recorded themselves (source SELF). OJT recorded by a clerk or admin can be **edited but not deleted** by the staff member. |
| Clerk scope | Clerks enter OJT for **contract staff only** (same rule as phase 1 staff records, including the extra-access guard). |
| Remove participant | Only while PENDING and without feedback; otherwise mark ABSENT or reopen. |
| Delete training | Only with no participants; otherwise cancel it (status CANCELLED keeps history, hours stop counting). |
| Resigned staff | Can't be added as participants; their history stays. |

Feedback form definitions live in one file, `src/lib/forms/feedback.ts`: `FEEDBACK_V1` (16 questions) and
`OJT_V1` (3 answers, used for all OJT), each with the question text, answer type (1–5 scale, yes/no, text) and a Zod schema. Store
`feedbackVersion` with every answer set so wording can change later.

## 7. Permissions and navigation

New permissions in `src/server/permissions.ts`:

| Permission | Who |
|---|---|
| `training.view` | L&D admin |
| `training.manage` (create/edit/cancel trainings, participants, attendance) | L&D admin |
| `ojt.manage` (OJT entry and import, contract staff only unless admin) | L&D admin, main clerk, clerk |
| `reports.view` | L&D admin; HODs see their own departments only |

Everyone can use My Training for themselves. HODs and division heads can see the training history of staff they can
already view (staff record page, §8 module 6).

Sidebar (only after each screen exists), with module keys and colours in `src/lib/tones.ts` / `moduleIcons.ts`:

- **My work**: My training (`training`, marigold)
- **Training**: Trainings (`training`), OJT (add module key `ojt`, e.g. olive, or reuse `training`)
- **Records**: Staff, Organization (as now)
- **Reports**: Training reports (add module key `reports`, cobalt)
- **Administration**: Audit log

## 8. Modules, in build order

Each module lists screens, services/actions, and when it is done.

### Module 1: Trainings (done 30 Sep 2026)

Built to match the old system's Add Training form, following the user's review. What exists now:

- **Training code** (added 2 Oct 2026, migration `20261002090000_training_code`): every training gets one automatically
  when it is added and it never changes: `TR` (`OJT` for OJT; departmental trainings use `TR`), the day it was added
  in Malaysia time (YYYYMMDD), then 6 random digits, e.g. `TR20261002909393`. Column `Training.trainingCode` (unique);
  existing trainings got one from their `createdAt`. Rule `trainingCode` in `src/server/rules/training.ts`,
  `newTrainingCode` in the training service (also used for self-recorded OJT). Shown on the list and the training page,
  and searchable. (`Training.code` is separate: the provider's course code.)
- `/trainings`: list with `page-fit` table. Filters: search (code, title, trainer, venue), type, status (the four the table shows; only Cancelled is stored, the rest come from the dates: `trainingPhaseWhere`), start date
  (starts on or after) and end date (ends on or before). Columns: no., training code, dates (no times), training (title
  only), type (Public / In-house shown as "Public"), total days (session days, or start to end), hours (per person),
  participants (completed / total), total man hours (hours × completed participants; 0 when cancelled), status
  (Upcoming / In progress / Held / Cancelled). Sortable by dates (default, newest first), title, type and participants.
  Excel export with the same filters and sort: training code, the form's fields in its order, then total days, hours,
  participants, completed, total man hours and status.
- `/trainings/new`, `/trainings/[id]/edit`: **Type** (Public / In-house or OJT), then the old form's fields in its order:
  Title, Venue, Cost (RM), HRDC (Yes/No), Platform (Physical / Online), Function (Business / Digital / Leadership /
  Personal effectiveness), Start/End date, Start/End time, Program (External public program / Internal training by
  external trainer / Internal training by internal trainer), then **Trainer**: a dropdown of active executives and
  managers for an internal trainer (`trainerStaffId`, name copied to `trainerName`), typed otherwise. Program,
  function and platform are required except for OJT. Hours are shown live. Dates and times use the custom
  `DateField` / `TimeField` (typed day-first dates or a calendar; 24-hour times or a 15-minute list).
- `/trainings/[id]`: the form's fields, schedule and hours, participant summary, history in plain language; actions Edit,
  Cancel training / Restore, Delete (only with no participants; the dialog explains otherwise).
- Service `src/server/services/training.ts`; validation `src/lib/validation/training.ts`; rules
  `src/server/rules/training.ts`; migration `20260929100000_phase2_trainings`.

**Removed on 9 Oct 2026:** the Departmental type (the user: it should not exist in this system; trainings that had
it became Public / In-house). **Kept in the model but not on the form:** course code, category, provider,
description, organising department and sessions. Editing leaves them unchanged, except that saving replaces any sessions
with the form's dates and times. Decide at the phase 5 import whether the old data fills them; otherwise remove them.
Phase 5 must also map the old values of HRDC, platform, function and program.

### Module 2: Participants and attendance (done 01 Oct 2026, merged)

- `/trainings/[id]`: Details beside Schedule, then a full-width **Participants** panel, then History. The panel has
  counts that double as filters (All / Pending / Completed / Absent), a name or staff no. search, and a table: staff no.,
  name, department and section, attendance (with its reason), feedback date, certificate. On phones the table scrolls
  sideways inside the panel.
- **Add participants** dialog: active staff load when it opens; narrow by department, section or search, tick people or
  "Select all" (everyone matching, which is how a whole department or section is added). Staff already on the list show
  "Already added". The server skips and reports duplicates and resigned staff.
- **Row actions**: Pending → Mark completed (reason required, only from the training's last day), Mark absent (reason
  optional), Remove. Absent → Undo absent. Completed → Reopen (reason optional, kept in history). **Bulk**: Mark
  completed, Mark absent, Remove for ticked rows. The dialog shows up front which rows will change and why the others
  are skipped; the server re-checks. Nothing changes while the training is cancelled.
- Every change writes an audit entry (entity `Participant`, the training's id), shown in the training's History. One
  entry per add or action, naming everyone it covered (a *Staff* line), so adding a whole department doesn't push the
  training's own changes out of the History's latest 25.
- **Excel export** of the participant list: training title and dates on top, then staff, attendance, reason, feedback
  date, certificate, and hours (training hours only when completed and not cancelled).
- Rules `src/server/rules/attendance.ts` (tests `tests/rules/attendance.test.ts`), service
  `src/server/services/participant.ts`, validation `src/lib/validation/participant.ts`, migration
  `20260930090000_participant_attendance_reason` (renames `absentReason` → `attendanceReason`, which now holds the
  reason for absent or for completed-on-their-behalf). The seed adds demo participants when the table is empty.

### Module 3: My Training (done 02 Oct 2026, merged)

- `/my-training` (sidebar **My work → My training**, with a count of forms waiting): one `page-fit` table of every
  training the person is on, newest first, like `/trainings`. Filters: search (title, trainer, venue), status
  (Feedback due / Coming up / Completed / Absent / Cancelled), start date (starts on or after) and end
  date (ends on or before). Columns: no., training (title only), start date, end date (dates only), type (Public /
  In-house or OJT), venue, training hours (completed count; "–" when absent or cancelled), status, and a **Give
  feedback** / **Give answers** button when a form is open. The header shows this year's completed hours and
  links the forms waiting to the *Feedback due* filter. **Record OJT** button.
- `/my-training/[participantId]`: the training's facts, the form, and *Your record* (attendance, hours, when the
  answers were given, who recorded an OJT). Only the participant can open it; anyone else gets 404.
- **Which form**: OJT trainings use `OJT_V1` (one form for all OJT, so it isn't called `OJT_SELF_V1`), every other
  training `FEEDBACK_V1` (16 questions, ids `q1`–`q16` for the phase 5 import), both in `src/lib/forms/feedback.ts`.
  `OJT_V1` is the old system's OJT evaluation (confirmed 1 Oct 2026): *what you have learned* (text), then knowledge /
  skill *before* and *after* training on the old 1–5 rating scale (5 Excellent ≥ 90% … 1 Poor below 50%), with the
  Malay wording. `FEEDBACK_V1` was placeholder wording until 12 Oct 2026, when the old system's
  Training Evaluation form was put in word for word (phase 4, module 5).
- **Rules** (`src/server/rules/myTraining.ts`, tests `tests/rules/myTraining.test.ts`): the form opens on the last day
  while PENDING; sending it sets COMPLETED. Course feedback can't be changed once sent; OJT answers can be updated any
  time. Closed (with the reason shown) when cancelled, absent, not ended yet, or completed by L&D without a form.
- **Own OJT** (`/my-training/ojt/new`, `/my-training/[participantId]/edit`): the old system's OJT form. Section A:
  title, training type (OJT, Coaching / Coachee, Mentor / Mentee: new column `Training.ojtMethod`, migration
  `20261001075424_ojt_method`), start and end date, start and end time, venue, external/internal trainer (stored as
  the program: internal training by an external / internal trainer). Section B: `OJT_V1`. All required; saved as a
  one-person OJT training, COMPLETED, source SELF; it must have ended by today. Its page shows the
  answers read-only with one **Edit** button, which opens the whole form (details and answers, saved together), and
  **Delete**, while no one else is on it. **OJT from a clerk or L&D**: an **Edit answers** button opens Section B only;
  the details (which may be shared with others) can't be changed and it can't be deleted. An OJT still waiting for
  answers shows the form on its page, since sending it completes the OJT.
- Overview: *Waiting on you* lists the forms; Next training and Recent learning link to the person's own pages.
- Audit: sending feedback is a `Participant` entry on the training (shows in its History); recording, editing and
  deleting own OJT are `Training` entries. Answers themselves are not copied into the audit log.
- Service `src/server/services/myTraining.ts`, validation `src/lib/validation/myTraining.ts`, e2e
  `tests/e2e/my-training.spec.ts` (with `tests/e2e/db.ts`, a test-only clean-up for the training a test gave feedback
  on, which the app rightly never deletes). The seed now gives seeded feedback dates demo answers.

### Module 4: OJT for clerks (done 05 Oct 2026, merged)

- Permission `ojt.manage` (L&D admin, main clerk, clerk); sidebar **Training → OJT** (module key `ojt`, olive).
  OJT are trainings, so L&D also have **Import from Excel** on the Trainings page (`/trainings/import`: the same flow
  and template as `/ojt/import`, ending on *View OJT trainings*). `/ojt` stays a page of its own (decided 5 Oct 2026):
  clerks can't see Trainings and may only see contract staff, and L&D use it for OJT by person.
  Whose OJT: `ojtStaffScope` (admin everyone, clerks contract staff) and `ojtStaffBlock` (clerks: contract staff
  without extra access, as for staff records; nobody: resigned staff). Rules `src/server/rules/ojt.ts`, tests
  `tests/rules/ojt.test.ts`; services `src/server/services/ojt.ts` and `ojtImport.ts`; e2e `tests/e2e/ojt.spec.ts`.
- `/ojt`: one row per person per OJT, newest first: no., training code, staff no., name, department, OJT title, start
  and end date, hours, status (Completed / Answers due / Absent / Cancelled), recorded by (Clerk / Excel import / L&D /
  Staff member). Filters: search (title, code, staff no., name), department, start and end date, Clear. Clicking
  anywhere on a row (`ClickableRow`; the title is the keyboard link) opens **`/ojt/[participantId]`**, the OJT record:
  the OJT's facts, the person's answers (or why there are none), *Record* (staff, department, status, hours, recorded
  by whom and when, answers given), and *On this OJT* (the others on it the user may see, each linking to their
  record). Clerks only get records of their contract staff (anything else is 404); admins also get **Open training**. **Export to Excel** (`/ojt/export`) with the same filters: every
  matching row with the OJT's details (section, training type, venue, times, trainer type and name, hours, status, when
  the answers were given, recorded by).
- `/ojt/new` **Record OJT**: the OJT form's Section A (title, training type, dates, times, venue, external/internal
  trainer) plus the trainer's name, and a staff picker (`src/components/StaffPicker.tsx`, shared with Add participants).
  Saves one OJT training with a participant per person, source CLERK (ADMIN for L&D). It must have ended by today.
- **Edit and delete** (from the record page; `ojtChangeBlock`): clerks change OJT recorded by a clerk or imported,
  while everyone on it is contract staff; L&D change any. Nobody changes, here, an OJT a staff member recorded for
  themselves (they do, on My training). **Edit** (`/ojt/[participantId]/edit`) is the Record OJT form filled in: the
  details apply to everyone on the OJT, and unticking someone takes them off it. Where the hours decided whether
  someone is completed, a change of hours carries through (`ojtAttendanceAfterEdit`); answers given and attendance
  set by hand stay. **Delete** removes the OJT for everyone on it. Both audited as `Training` UPDATE / DELETE, with
  staff added, removed or deleted named.
- `/ojt/import`: the clerks' own template (given 5 Oct 2026; the app builds the same file at `/ojt/import/template`,
  so the original isn't kept in the repo): sheet "OJT Import", one row per participant, columns Title, Venue, Start/End Date
  (YYYY-MM-DD), Start/End Time (HH:MM), Trainer Type (INTERNAL/EXTERNAL), Trainer Name, Participant Staff No, and
  optional What Did You Learn / Skill Before / Skill After (1–5). Rows with the same title (exact case), venue, dates,
  times and trainer are one OJT. Preview, then commit, **all or nothing** (the template's rule, replacing "skip rows
  with errors"). Rows starting "(EXAMPLE)" and a person who already has the same OJT (title and dates) are errors, so
  a file can't be imported twice. Source IMPORT.
- **Completed or answers due** (template instructions, used for on-screen entry too): all three answers given →
  COMPLETED with the answers stored as `OJT_V1`; an OJT of 4 hours or less → COMPLETED; otherwise PENDING, and the
  person gives their answers on My Training (which completes it). Only some of the three answers → row error.
- Audit: a `Training` CREATE entry per OJT naming everyone on it, plus one IMPORT entry per file.

### Module 5: Certificates (done 06 Oct 2026, merged)

- **Per training, not per participant** (decided 5 Oct 2026: providers send one certificate file for the whole
  class). `certificateFile` / `certificateName` / `certificateAt` moved from `Participant` to `Training`, plus
  `certificateById` (migration `20261005070900_training_certificate`; the participant columns were all empty). One
  file per training.
- Rules `src/server/rules/certificate.ts` (tests `tests/rules/certificate.test.ts`), service
  `src/server/services/certificate.ts`, actions `src/app/(app)/certificates/actions.ts`, e2e
  `tests/e2e/certificates.spec.ts`.
- **Who changes it** (`certificateManageBlock`): L&D, any training; a clerk, OJT they may change (`ojtChangeBlock`); a
  staff member, an OJT they recorded for themselves. **Upload** also needs the training to have started and not be
  cancelled (`certificateUploadBlock`). Upload, replace and remove are `Training` UPDATE audit entries (field
  `certificate`, shown in the training's history).
- **Files**: `uploads/certificates/<year>/<random id>.<ext>` (`UPLOAD_DIR` overrides `uploads/`; git-ignored), never
  under `public/`. The type comes from the file's first bytes (PDF, JPG or PNG), at most 5 MB (checked in the page
  first; server actions accept 6 MB). The original name is kept, cleaned, for the download. A replaced or removed
  file is deleted, as is the file of a training or OJT that is deleted.
- **Download** `/certificates/[trainingId]` (`certificateDownloadAllowed`): L&D; anyone on the training marked
  Completed; a clerk for OJT of contract staff. Anyone else, and a training without one, gets 404.
  `Content-Disposition: attachment`, `Cache-Control: private, no-store`.
- **Screens**: one *Certificate* panel (`src/components/CertificatePanel.tsx`) on the training page (a full-width row),
  the OJT record and My training (with why it can't be downloaded yet: not completed, or absent). The participants
  table and its export lose their per-person Certificate column; the Trainings list and export gain one (Yes / –).
- **Preview first** (asked 5 Oct 2026): the file, or *View certificate*, opens a preview (PDF in the browser's viewer,
  fitted to the width; images as they are), fetched through the download route so the same check applies. Download,
  Replace and Delete are in the preview, for those who may. Phones that can't show a PDF in a page are told to download it.
- **Done when**: upload, replace, remove and download work, and someone not completed on the training (or not on it)
  can't fetch its certificate.

### Module 6: Reports and staff training history (done 06 Oct 2026, merged)

- Permission `report.view`: L&D (role), HODs and division heads (derived, like `staff.view`). `reportStaffScope` /
  `reportDepartmentScope`: L&D everyone; HODs their departments; division heads their divisions. **Clerks have no
  reports.** Sidebar **Records → Reports** (module key `reports`, coral). Rules `src/server/rules/report.ts` (tests
  `tests/rules/report.test.ts`), service `src/server/services/report.ts`, e2e `tests/e2e/reports.spec.ts`.
- **How figures are counted** (decided 6 Oct 2026; one place, so screens, exports and the overview agree):
  hours from `trainingHours`, only for attendance that `countsTowardHours`; a training belongs to the period it
  **starts** in; a person's hours go to the department they are in **now**; a department's total is the sum of its
  staff rows; its average divides by the manpower headcount (`isActiveHeadcount`: active, not a trainee). Trainees'
  and leavers' hours count in the total but they aren't in the headcount.
- **Period**: start and end date filters (as on the lists, not a year box), filled in with the current calendar year
  when left empty (`reportPeriod`). Clear goes back to this year. The tabs keep the period.
- `/reports` → four tabs, each a `page-fit` table with a pinned totals row (`.table tfoot`) and **Export to Excel**
  (`/reports/export?report=…`, one route; title and period above the table, table from row 4, totals row last):
  1. **Staff hours** (`/reports/staff-hours`): everyone still employed (0 h if none, so gaps show) plus leavers with
     hours in the period (`inStaffReport`); trainings completed and total hours; most hours first. Filters: search,
     division, department, *Show* (all / with training / no training yet).
  2. **Department hours** (`/reports/department-hours`): headcount, staff trained (and % of headcount), trainings
     completed, total hours, average per head. A row opens that department in Staff hours for the same period.
  3. **Training attendance** (`/reports/attendance`): each training that started in the period: hours, participants,
     completed / pending / absent, man hours, certificate, status. A row opens its participants
     (`/reports/attendance/[trainingId]`), with the hours each got. A HOD sees trainings with at least one of their
     staff, and counts and lists only their staff.
  4. **Audit report** (`/reports/audit`): one line per person per training (100 a page; the export has all): dates,
     code, training, type, staff, department, attendance, hours, certificate (*Yes* = the training has one and the
     person completed it, since certificates are per training).
- **Staff record**: a *Training* panel (`staff/[id]/TrainingPanel.tsx`, `staffTrainingHistory`): hours and trainings
  for each year, then every training the person has been on, latest first. For whoever may open the record.
- **Done when**: figures agree with the rule tests and with each other (staff totals add up to department totals).
  Checked in the e2e test on a training of its own in an otherwise empty year.

## 9. Demo data (extend `prisma/seed.ts`)

Realistic trainings for a stamping and welding plant, spread over 2025–2026, e.g. *ISO 9001:2015 Internal Auditor*
(public, 2 days), *Power Press Safety* (in-house), *5S Workplace Organisation* (in-house), *Forklift Operation Licence*
(public), *Spot Welding Parameter Setting* (OJT), *Die Maintenance Basics* (OJT), *Excel for Production Reporting*
(departmental, HRA), *IATF 16949 Awareness* (in-house). Mix of PENDING / COMPLETED / ABSENT, some with feedback, one
cancelled training, one multi-session training. Only seed trainings when the Training table is empty.

## 10. Tests to add

- **Unit** (`tests/rules/training.test.ts`): `trainingHours` (single day, multi-day, sessions, invalid times),
  `countsTowardHours`, every attendance transition (allowed and refused), OJT edit/delete by source, feedback schema
  (required answers, out-of-range values), clerk scope for OJT.
- **E2e**: admin creates a training and adds participants; staff submits feedback and sees hours; admin marks absent and
  undoes; clerk enters OJT for a contract staff member and is refused for an executive; OJT import preview and commit;
  certificate upload and a refused download by another staff member; a report's Excel export downloads.

## 11. Phase 2 is done when

- Everything in §8 works and is covered by the tests in §10.
- On migrated data (checked in phase 5), training and OJT hours per staff member and per department match the old
  system for 2026.
- All checks pass: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`.

## 12. Notes for the phase 5 migration

- The old `training` and `ojt` tables have overlapping IDs: import both into `Training` with `legacySource` set.
- Old public and in-house trainings both import as `PUBLIC_INHOUSE`.
- Old feedback columns `q1`–`q16` → `Participant.feedback` with `feedbackVersion = 1`.
- Old status values are free text (`'1'`, blank, `'APPROVE'`): map them explicitly and list anything unmapped in the
  reconciliation report rather than guessing.
