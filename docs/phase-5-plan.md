# Phase 5: Bringing the old data across, rehearsal and cutover

Build plan for LDMS v2 phase 5. **Approved 12 Oct 2026: the recommendations in §3 were accepted, with one change, that everything that can be imported is imported (§3.1).** Written on 12 Oct 2026 after reading
the old system's code (`C:\Apache24\htdocs\ldms`) and counting, without reading any personal data, what is in its
database (`phnportalenterto_trms`, read-only). Read with `README.md`, `CLAUDE.md` and the migration notes at the end
of `docs/phase-2-plan.md` (§12) and `docs/phase-3-plan.md` (§11).

**How to work:** as in phases 2 to 4. One module at a time, in the order in §6; after each: typecheck, lint, unit
tests, e2e tests, the counts in §5 compared with the old system, then stop for review.

---

## 1. Where things stand

- Phases 1 to 4 are on master. The new database (`ldms_v2`) holds demo data only: 135 staff, 19 trainings.
- **Already in place for the import**
  - `legacyId` on divisions, departments, staff, participants, PMEs, skill matrices, TNAs and TNIs, and
    `legacySource` + `legacyId` on trainings (the old `training` and `ojt` tables reuse the same ids: 544 clash).
  - `Staff.legacyMd5`: an old password works once, then is replaced by a modern hash and removed.
  - The 16 course feedback questions and the 3 OJT questions match the old columns (phase 4, module 5).
  - `Staff.gender`, the Skill matrix evaluator role, `fillsOwnTna` and `jobGrade` are waiting for the old values.
  - The org and staff data checks, which will show what the import left unfinished (no email, no HOD and so on).
- **Missing**: anything that reads the old database, a way to compare old and new totals, and a written procedure for
  the day the old system is switched off.

## 2. What is in the old database

Counted on 12 Oct 2026 from the copy on this machine. The live server keeps changing until cutover, so the final
numbers will be a little higher.

| What | Old tables | Rows | Goes to |
|---|---|---|---|
| Divisions, departments, sections | `divisions`, `departments`, `sections` | 9, 43, 150 | `Division`, `Department`, `Section` |
| Staff | `user` | 6,003 | `Staff`, `StaffRole` |
| Trainings | `training`, `training_archive` | 154 + 508 | `Training` (public / in-house) |
| Their attendance and feedback | `participation`, `participation_archive` | 2,280 + 6,615 | `Participant` |
| OJT | `ojt`, `ojt_archive` | 5,941 + 32,995 | `Training` (OJT) |
| OJT attendance and feedback | `participateojt`, `participateojt_archive` | 78,898 + 253,131 | `Participant` |
| PME | `pme`, `pme_archive` | 1,989 + 6,628 | `Pme` |
| Skill matrix | `skill_matrix_evaluations`, `_topics`, `_items` | 2,851 / 32,936 / 153,296 | `SkillEvaluation`, `SkillTopic`, `SkillItem` |
| Skill matrix evaluators | `skill_matrix_whitelist` | 147 | the Skill matrix evaluator role |
| TNA | `tna`, `tna_archive` | 206 + 2,250 | `Tna`, `TnaItem` |
| TNA training options | `tna_training_category`, `tna_training_option` | 14, 196 | the same two tables |
| TNI | `tni_archive` (`tni` is empty) | 49 | `Tni`, `TniItem` |

**Not brought across:** the two reminder logs, `session` (empty), `certificate` (one row, a file L&D uploaded once),
the four `*_all` views, and the six triggers (v2 has no need of them).

The live tables hold 2026; the `*_archive` tables hold 2023 to 2025. V2 has one table for all years.

### 2.1 What doesn't fit

These are the rows the import has to decide about. Each is counted here so nothing is a surprise later.

**Staff**

- **Status** is `ACTIVE` for 1,903, `RESIGN` for 2,916, and **blank for 1,184**. The old system treats blank as
  active (it only asks "not resigned"), and 1,137 of the blank ones attended training in 2026, so they are working
  staff. That makes **3,087 active staff**.
- No one has a resignation date. 1,307 have a join date, 529 an email address, and 665 have no gender.
- **102 resigned staff have no department**, and 86 of them have training records. V2 requires a department.
- Roles: 8 admins; 75 clerks, **every one of them marked `MAIN`**; 64 "office" users; 47 marked HOD (v2 takes HODs
  from the org chart instead: 40 of 43 departments have one, 6 of 9 divisions have a head).
- **Plant** is filled in for 1,158 staff. V2 has no plant field.
- Every password is an unsalted MD5 value.

**Trainings (public / in-house)**

- 321 attendance rows belong to a training that no longer exists, and 66 to a staff member who no longer exists.
- 22 people are on the same training twice or more (25 extra rows).
- 307 rows have no attendance recorded; 303 of them are from 2026.
- 4 trainings end before or when they start. 49 have no function and 33 no platform. Three feedback rows answer question
  12 (yes / no) with "5".

**OJT**

- **144 OJTs have an impossible date** (year 0, 1970, 2032 and so on), with 998 attendance rows.
- **7,873 people are on the same OJT more than once: 16,791 extra rows**, about 13,700 of them completed. The old
  dashboard counts every one, so its hours are too high by that much. V2 allows a person on a training once.
- 11,084 attendance rows belong to a staff member who no longer exists, and 1,371 to an OJT that no longer exists.
  The old reports already leave these out.
- 15,930 rows have no attendance recorded; 7,209 of them are from 2026.
- 1,317 OJTs have no training code and 2 share one; 13 titles are longer than v2's 200 characters; 77 have an end
  time at or before the start; 550 have no one on them.
- Trainer type is `INTERNAL`, `EXTERNAL`, `INHOUSE`, `OJT`, `INEXTERNAL` or blank. There is no column for OJT,
  coaching or mentoring.
- **Good news:** the old dashboard works out hours the way v2 does (days × hours a day), not from the stored
  `totalhour` column, so the two systems should agree once the duplicates are set aside.

**PME**

- 8,617 in all: 3,913 verified, 371 acknowledged by the staff member, 369 evaluated, 1,122 not applicable, and
  **2,842 pending**. Of the pending, 1,750 are for trainings whose three months ended in 2025.
- The old reminder only chases the live table (82 overdue when phase 4 was planned), so nobody is being asked for
  the 2025 ones today.
- 54 point at an attendance row that no longer exists.

**Skill matrix**

- All 2,851 are from 2026: 1 for Q1, 1,687 for Q2, 1,163 for Q3. 1,489 approved, 973 waiting for the HOD, 389 drafts.
- Since 6 Oct 2026 the old system stores the quarter being evaluated on each row (`eval_year`, `eval_quarter`).
  No one has two for the same quarter. This removes the problem noted in the phase 3 plan.

**TNA and TNI**

- **Every TNA row's year is wrong or unclear.** The archive (2,250 rows) all say 2023 but were approved September
  to December 2025. The live table has 163 rows that say 2023, approved February to October 2026, and 43 that say
  2027. 17 people have rows in both the archive and the live "2023" set.
- A TNA in v2 has one status; in the old tables each row has its own, and some people's rows disagree.
- 532 archive rows are TNAs by job grade (71 department-and-grade sets). Their department is typed text: only 3 of
  the 16 names match a department exactly. The same is true of TNI: 3 of 10.
- Only 95 of the 2,250 archive rows name a training that is on today's option list.
- TNI: 49 rows for 2025. One has no method, and "attitude, skill or knowledge" is free text.

## 3. Decisions (12 Oct 2026)

The recommendations were accepted as written, except rows 6, 9, 13 and 14, which changed because **all data is to be imported**.

| # | Question | Decided | Downside, and the alternative |
|---|---|---|---|
| 1 | **How far back?** | Everything: 2023 to 2026. | More messy rows to deal with. Alternative: 2026 only, but then audit reports for earlier years stay in the old system. |
| 2 | **Where does the import go?** | A new, empty database each time (`ldms_v2_live`). `ldms_v2` keeps its demo data for the tests. | Settings chosen in v2 (email mode, reminder kinds) are set again after the final run. Alternative: import on top of what is there, which is slower to build and easy to get half-right. |
| 3 | **Staff with a blank status** (1,184) | Active, as the old system treats them. | A few may have left without being marked. HR's list is the fix, in the old system before cutover or in v2 after. |
| 4 | **Resigned staff with no department** (102) | Put them in one holding department, "No department (old system)", so their training history is kept. | One extra department in lists and filters. Alternative: leave out the 16 with no records and still need the holding department for the other 86. |
| 5 | **The 75 clerks, all marked `MAIN`** | Main clerk for all, so no one loses what they can do today. L&D trim the list afterwards. | 75 people with the wider clerk rights. Alternative: plain Clerk for all, and L&D promote the few real main clerks; safer, but some clerks will find things missing on day one. |
| 6 | **OJTs with impossible dates** (144, 998 rows) | **Imported with the date they have** wherever it is a real date (1970, 2032 and so on), and listed in the import report for a clerk to correct. The few with no date at all (year 0) need a date from L&D first (§3.1). | Wrong dates come across as wrong dates; they sit outside every normal report period until corrected. |
| 7 | **The same person twice on one training** (16,816 extra rows) | Keep one row, a completed one if there is one. | V2's hours will be lower than the old dashboard's, by exactly the duplicates. The report shows old total, duplicates and new total side by side. |
| 8 | **Attendance left blank** | 2026: *Pending*, so the person can still complete it. 2025 and earlier (8,700 rows): *Absent*, with the reason "Not completed in the old system". | If all were Pending, staff would be asked for feedback on trainings from 2023. Marking them Absent is a judgement; the reason says where it came from and L&D can change any of them. |
| 9 | **Pending PMEs from 2025 trainings** (1,750) | **Imported as Pending**, like the 1,092 from 2026. | 1,750 old evaluations land on HODs' Approvals pages on day one, and in their reminder emails once email is Live. L&D may want to tell HODs first, or leave the PME reminder switched off for a while. |
| 10 | **Skill matrix quarter** | Use the quarter the old system now stores. | None found. It replaces the 6 Oct decision to work it out from the date. |
| 11 | **Which year each TNA belongs to** | Archive → 2025. Live rows that say 2023 → 2026. Live rows that say 2027 → 2027. | This is the only reading where no one ends up with two TNAs for one year, but it is a reading, not a fact. L&D should confirm. |
| 12 | **A TNA whose rows disagree on status** | Approved only if every row is; otherwise Submitted if any row was; otherwise Draft. | A partly approved TNA goes back to the HOD to approve once more. |
| 13 | **Department names typed as text** (TNA by grade, TNI) | I list every name that doesn't match with my suggested department; L&D confirm or correct each one, and then all are imported (§3.1). | A short checking job for L&D (about 20 names). |
| 14 | **Plant** | **Imported**: a Plant field is added to the staff record, shown on the staff page and in the staff export. | One more field on the staff form. It is free text in the old system (11 values), so it stays a short list L&D can add to. |
| 15 | **Old passwords** | Carried for active staff only, as the one-time `legacyMd5`. Resigned staff get none. | None: resigned staff can't sign in anyway, and it keeps weak hashes of 2,900 people out of the new database. |
| 16 | **The final copy** | On cutover day someone takes a fresh copy of the live server's database and the old system is made read-only. | Needs whoever runs the live server. The copy on this machine is only for rehearsals. |

### 3.1 Importing everything, and where help is needed

Everything that can be imported is. Four kinds of row cannot be, whatever the import does:

- **Attendance for a staff member who is no longer in the old database** (11,084 OJT rows, 66 training rows). The staff record was deleted, so there is no one to attach the row to. The old staff merges of August 2026 are not the cause: those moved the rows to the surviving record.
- **Attendance for a training that is no longer in the old database** (1,371 OJT rows, 321 training rows), and 54 PMEs whose attendance row is gone.
- **The second and later copies of the same person on the same training** (16,816 rows). One row is kept.
- **OJTs with no date at all** (about 10), until someone gives the date.

All of these are listed in the import report by old id, so none disappears without a trace.

**Help that will be asked for, at the module where it comes up:**

| Module | What | Who |
|---|---|---|
| 1 | The 1,184 staff with a blank status: any who have left | HR |
| 3 | The OJTs with impossible dates: the right date for each | L&D or the clerks |
| 3 | Whether the deleted staff can be named from HR records (if so, they can be added as resigned staff and their attendance imported) | HR |
| 6 | The department names that do not match, and the TNA years (decision 11) | L&D |

Cleaning is best done in the old system before the final run, so a rehearsal shows it worked.

## 4. How the import works

- **A command, not a screen**: `npm run import:old`, with `-- --only staff` (or `training`, `ojt`, `pme`, `skill`,
  `tna`) to run one part and those that depend on it, and `-- --check` to count and report without writing anything.
  `npm run import:setup` creates the database being filled, or brings its tables up to date.
- **Two connections.** `OLD_DATABASE_URL` (the old database) and `IMPORT_DATABASE_URL` (where it goes), both only in
  `.env`. The command only ever runs `SELECT` on the old one, and refuses to start if the two point at the same
  database, if the target is the one the app and tests use (`DATABASE_URL`), or if people have changed records in the
  target since it was last filled (`--discard-changes` goes ahead anyway).
- **Start empty, load, compare.** Each run empties the target's tables and loads them again in order: org chart,
  staff, trainings, attendance, PME, skill matrix, TNA options, TNA, TNI. A full run should take minutes. Rehearse
  as often as needed; the cutover run is the same command against a fresh copy.
- **Rules are separate and tested.** Every mapping (status, designation, program, attendance, PME rating words,
  months, TNA sections) is a pure function in `src/server/rules/import.ts` with unit tests. A value with no mapping
  is never guessed: the row is listed.
- **The import report.** Each run writes one Excel file to `import-reports/` (git-ignored, because it names staff):
  a summary sheet (read, imported, left out, by reason) and a sheet per reason listing the old ids. This is what
  L&D and HR work from to clean up.
- **The audit log** gets one entry per part ("Imported 3,087 active and 2,916 resigned staff"), not one per row.
- **Nothing is sent.** The import creates no notifications, and a fresh database starts with email Off.
- **Looking at the result**: `npm run dev:live` runs v2 against the imported database (stop `npm run dev` first:
  both use port 3006). The demo copy and the tests are untouched.

### Mappings already settled

- Designation: `NON EXECUTIVE`, `EXECUTIVE`, `MANAGER (AM/HOS & ABOVE)`, `CONTRACT`, `TRAINEE` → the five in v2.
- `user.grade` 1 to 5 → job grade (0 and blank → none). `usertype = 'OFFICE'` → fills in their own TNA.
  `roletype = 'ADMIN'` → L&D admin. The whitelist → Skill matrix evaluator.
- Program: `EXT`, `INTX`, `INTI` → external public, internal by external trainer, internal by internal trainer.
  `hadc` → HRDC claimable. Function and platform by name; blank stays blank.
- Public and in-house trainings both → `PUBLIC_INHOUSE`. Old training codes are kept; OJTs without one get a new one.
- Attendance: `COMPLETED` / `COMPLETEDOJT` → Completed, `ABSENT` → Absent, blank → decision 8.
- Feedback: `q1`–`q16` → the course form, `q1`–`q3` → the OJT form, as they are. Blank answers stay blank.
- PME: `approved` → Evaluated, `completed` → Acknowledged, `verified` → Verified, `not_applicable` → Not required.
  Rating words and percentages are converted; one that doesn't fit its band is listed.
- Skill matrix: blank status → Draft, `PENDING` → Submitted, `APPROVED` → Approved.
- TNA: method `1`, `2`, `3` → OJT, coaching, external / in-house; month `Jan`–`Dec` → 1–12; the seven old sections
  → the seven in v2; the training is matched to an option by name and kept as text where there is no match.

## 5. Proving nothing was lost

After every run the command prints, and writes to the report, old against new:

- Staff: active and resigned, by designation and by department.
- Trainings and OJTs by year; attendance rows by year and status.
- **Training hours by year and by department**, public and OJT, worked out the old dashboard's way from the old
  tables and by v2's rules from the new. The old figure is shown with and without the duplicates and the rows the
  old reports already leave out.
- PMEs by status; skill matrices by quarter and status; TNAs by year and status; TNI rows by department.

Every difference must be explained by a line in the report (duplicates, impossible dates, missing staff). A
difference with no reason is a bug in the import.

## 6. Build order

| Module | What | Stop and review |
|---|---|---|
| 0 | **Groundwork**: the command, the two connections and their safety checks, the report file, `dev:live`. Imports the org chart (divisions, departments, sections, HODs and heads). | The org chart in v2 matches the old one. |
| 1 | **Staff**: people, roles, old passwords, gender, job grade, plant, the holding department. | Counts by status, designation and department; an old password signs in. |
| 2 | **Trainings**: the 662 trainings, their attendance and the 16 feedback answers. | Hours by year and department against the old dashboard; the audit report export. |
| 3 | **OJT**: the 38,936 OJTs and their attendance. Also checks the dashboard and reports stay quick with 300,000 rows. | OJT hours by year and department; page speed. |
| 4 | **PME**: matched to the imported attendance. | Counts by status; the Approvals page shows only what is really waiting. |
| 5 | **Skill matrix** and the evaluator role. | Counts by quarter and status; the chart. |
| 6 | **TNA and TNI**, with the option lists and the department-name list for L&D. | Counts by year and status; the TNA summary. |
| 7 | **Rehearsal and cutover**: a full run from start to finish, the comparison in §5 signed off, and a written step-by-step for cutover day and for going back if it fails. | L&D and HR have read the import report. |

Modules 0 and 1 are small and could be reviewed together.

### Module 0: Groundwork and the org chart (built 12 Oct 2026)

- **The command**: `scripts/import-old.ts` → `src/server/import` (`index.ts` runs the parts, `run.ts` holds the two
  connections and what a run found, `report.ts` writes the Excel report, `org.ts` is the first part). The rules are in
  `src/server/rules/import.ts`: where the import may run, that only a single `SELECT` reaches the old database, the
  parts and their order, and how old text is cleaned.
- **`scripts/with-import-db.mjs`** points one command at the imported database: `import:setup` and `dev:live`.
- **Each run** empties the database being filled (settings are kept), loads it, counts what is there, writes one
  `IMPORT` entry per part to the audit log, and writes `import-reports/import-<date>-<time>.xlsx`: a Summary sheet
  (old against v2), a Reasons sheet, and a sheet per reason listing old ids.
- **The org chart**: 9 divisions, 42 departments and 147 sections, with short names and the old ids. Every one
  matches the old database; two department names lost a doubled space.
- **The department named "(DELETED) OPERATION RASA & SERENDAH" is not imported** (decided 12 Oct 2026), nor are its
  3 sections. The old database is not touched. 142 staff still belong to it there (141 resigned, 1 with no status):
  in module 1 they go to the holding department, and the one who is not resigned is listed for HR.
  `isDeletedDepartment` is the rule: a name that starts with "(DELETED)".
- **Data model**: `Section.shortName` and `Section.legacyId` (148 of the 150 old sections have a short name, and v2
  had nowhere to keep it). The department page shows it beside the section name; it can't be edited on screen yet.
- **Left for module 1**: who heads each division and department, since that points at a staff record. Until then
  nobody can sign in to the imported copy, so there is nothing to look at with `dev:live`.
- **Tests**: `tests/rules/import.test.ts` (19 tests). Checked by hand: each refusal (target is the old database, target
  is the app's, an address missing, records changed by people), a second run giving the same result, and the demo
  database untouched.

## 7. Data model

Two changes: `Section.shortName` and `Section.legacyId` (module 0), and `Staff.plant` (decision 14, module 1).

- If an old value turns out to need a home, it is raised at that module's review, not added quietly.

`Participant.legacyId` is the old row's id; which old table it came from follows from its training's `legacySource`.

## 8. Security notes

- The old database and every imported copy hold real staff records. `OLD_DATABASE_URL` and `IMPORT_DATABASE_URL`
  live only in `.env`; `.env.example` gets the names with no values.
- `import-reports/` is git-ignored. No real name, staff number or answer goes into the repository, the tests or a
  screenshot kept with the code.
- The tests keep using the demo database. Nothing in `npm test` or `npm run test:e2e` touches the old database or
  the imported one.
- While building, I check the imported database by counts, not by reading people's records.
- Best practice for the final run is an old-database account that can only read. The command works with one.

## 9. Not in phase 5

- Fixing the old data at its source (duplicate attendance, impossible dates, staff with no status): that is L&D's
  and HR's, from the import report. The import works around it and says so.
- Uploaded files from the old server: there are none worth moving (one certificate file).
- Setting up the live server, its scheduler for the daily job and its backups: listed in the cutover steps in
  module 7, done by whoever runs the server.

## 10. Tests to add

- **Unit**: every mapping in §4 (each known value, and an unknown one refused); which duplicate row is kept; the
  TNA status rule in decision 12; the TNA year rule in decision 11; an impossible date refused.
- **Import test**: a small made-up "old" database (a few rows of each kind, including one of each problem in §2.1)
  is imported into an empty one and the result checked row by row. It uses no real data and runs with `npm test`
  only when a test database is configured.
- **E2e**: unchanged; they run against the demo data.

## 11. Phase 5 is done when

- A full run into an empty database finishes with every difference in §5 explained.
- L&D have confirmed decisions 11 and 13 and read the import report; HR have seen the staff lists in it.
- Hours per staff member and per department for 2026 match the old system once duplicates are set aside (the test
  set in `docs/phase-2-plan.md` §11).
- The cutover steps have been walked through once from start to finish on a rehearsal copy.
- All checks pass: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`.
