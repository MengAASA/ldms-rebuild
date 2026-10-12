# Phase 4: Reminders, notifications, the daily job and dashboards

Build plan for LDMS v2 phase 4. **Approved 8 Oct 2026; the answers are in §3.** Question 4 (a closing date for TNA and TNI) was answered yes on 8 Oct 2026. Written
after reading the old system's reminder scripts and dashboards (`C:\Apache24\htdocs\ldms`) and counting, without
reading any personal data, what is in its database (`phnportalenterto_trms`, read-only). Read with `README.md`,
`CLAUDE.md` and `docs/phase-3-plan.md`.

**How to work:** as in phases 2 and 3. One module at a time, in the order in §7; after each: typecheck, lint, unit
tests, e2e tests, screenshots at desktop and phone width, then stop for review.

---

## 1. Where things stand

- Phases 1 to 3 are on master: org chart, staff, sign-in, permissions, audit log, trainings, attendance, My
  training, OJT, certificates, reports, PME, skill matrix, TNA and TNI.
- **Already in place for phase 4**
  - What is waiting on each person is worked out today, on screen only: `feedbackWaiting`, `pmeWaiting`,
    `skillWaiting` and `tnaWaiting` feed the sidebar counts, the Approvals page and the overview's *Waiting on you*.
  - A `mail.testMode` setting (on, with a test address) has been in the seed since phase 1. Nothing reads it yet.
  - The org and staff data checks already flag *Managers and executives without email*.
  - The overview has L&D's figures for the year (learning hours by month, attendance to record, spend, headcount by
    division), and Reports has staff hours, department hours, attendance and the audit log, each with an Excel export.
  - `ColumnChart` draws one series of columns. There is no chart with two series or stacked parts yet.
- **Missing**: anything that sends an email, anything that runs by itself, a record of what was sent, a notification
  list, and any chart about PME, skill matrix, TNA or TNI across departments.

## 2. What the old system does

### 2.1 Reminders

One runner, `scripts/run_reminders.sh`, started once a day by the server's scheduler (8am Malaysia time), runs three
scripts one after another and writes what each printed to a log file.

| Script | To whom | What | When |
|---|---|---|---|
| `notify_pme_incomplete.php` | Each HOD | One email listing every PME of theirs whose 3-month period has ended and is still not evaluated | Every day until none are left |
| `notify_attendance_incomplete.php` | Each participant | One email listing every training that has ended whose attendance form they haven't filled in | Every day until none are left |
| `reminder.php` | Three L&D addresses, typed into the code | Trainings that started exactly 3 months ago | On that day |

Also in the PME script: PMEs for trainings of 4 hours or less are closed before anyone is reminded (v2 needs no job for
this; they are *Not required* from the start). Three older scripts (`notify_hod`, `notify_admin`,
`notify_participation`) are no longer run.

What the code and the database show:

- Both daily scripts **are in test mode in this copy of the code**: every email goes to one test address, with the
  real recipient named in the subject. They have run every day since 7 and 8 September 2026 (27 and 26 runs). Whether
  the live server has been switched to real recipients is a question for whoever deployed it.
- The backlog today: **82 PMEs** past their period across **17 HODs**, and **144 attendance forms** not filled in by
  **126 staff**.
- **Only 447 of about 3,100 active staff have an email address on record.** All 39 HODs do; so do 137 of 140
  managers and 136 of 155 executives. Among non-executive staff it is 172 of 1,356, and among contract staff 2 of
  1,465. Email reaches the office; it does not reach the shop floor.
- Each script marks the day as sent **before** sending, so a failure halfway means the rest wait until tomorrow. There
  is no record of who was sent what, only the printed log.
- Email goes through Office 365 with a mailbox sign-in. **The mailbox password is written into five source files**,
  and each script's web address is protected only by a token that is also in the code. See §9.
- No reminders exist for skill matrix, TNA or TNI, and none for the staff member's or L&D's PME step.

### 2.2 Dashboards

Every role has a dashboard page, all about **training hours**; none shows PME, skill matrix, TNA or TNI. L&D's has:

- Seven figures: trainings, staff trained, headcount, days, total hours, public hours, OJT hours.
- **Public and OJT** hours side by side, **cost by month**, the **top 10 staff by hours**, and **average training
  hours per person by month**.
- **One chart per division** (nine of them), each with its departments.
- A switch on most charts between **total man-hours** and **average hours per person**, a date range and a year picker.
- A table of staff with their total hours.

The HOD's, the clerks' and ordinary staff's pages are cut-down copies of the same page, 1,200 to 1,500 lines each.
Ordinary staff see the company-wide division charts too. The skill matrix has its own chart page, which v2 already has.

About half of trainings have a cost entered (81 of 152 in 2026), so a cost chart undercounts.

---

## 3. Decisions (8 Oct 2026)

Each has what the old system does, what was recommended and its downside. **The answers:**

- **1**: one combined email per person, **every day until resolved**, as the old system does. No weekly option, so
  there is no `reminders.cadence` setting.
- **4**: **yes** (8 Oct 2026): L&D can set an optional closing date for the open year's TNAs and TNIs.
- **8**: SMTP, with the settings in `.env`.
- **9**: a **Linux** server; the daily job is a `cron` line.
- **12**: **yes**, the old PDF reports are needed. Added as module 5: the PME report, the training audit report and
  the OJT audit report, unless fewer are named.
- **2, 3, 5, 6, 7, 10, 11**: as recommended.

### Reminders

| # | Question | Old system | Recommended for v2 | Downside |
|---|---|---|---|---|
| 1 | **How often?** | Every day until done. | **One email per person**, listing everything waiting on them. Sent the day something new is waiting, then **every Monday** while anything remains. L&D can switch it to every working day. | Slower chasing than daily. L&D chose daily only a month ago, so they may want daily kept; that is why it is a switch and not fixed. A HOD with 30 overdue PMEs learns to delete a daily email. |
| 2 | **Which things are chased?** | PME for the HOD; attendance form for the participant. | Everything that already appears under *Waiting on you*, listed in §4: twelve kinds, each one L&D can switch off. | More email than today. The single combined email keeps it to one per person. |
| 3 | **Skill matrices not yet filled in** | No reminder. | Remind the department's evaluators **only in the last month** before the quarter closes, with the number of staff still without one. | Several people can fill them in, so each may assume another will. The HOD's dashboard (question 10) shows the same number, which is the real pressure. |
| 4 | **TNAs and TNIs not yet started** | No reminder, and no deadline. | **No reminder unless L&D set a closing date** when they open the year. With a date: remind from 14 days before. | Needs a small addition to the *Open year* dialog. Without a date nobody is chased to start, as today. A reminder with no deadline behind it is noise. |
| 5 | **Staff with no email** (about 2,650) | Skipped; counted in the log. | They get the **in-LDMS notification** only. L&D's run summary lists how many were skipped, by department, with a link to the staff list. | They only see it if they sign in. Nothing in phase 4 fixes that; a kiosk or a printed list from the clerk would. |
| 6 | **The first live run** | A cut-off date in the code, so the first run didn't send the whole backlog. | A **Chase from** date L&D set when they switch test mode off. Older items still show on screen but aren't emailed. | Older backlog isn't chased by email unless L&D move the date back. |
| 7 | **Can a person turn their reminders off?** | No. | **No.** L&D switch a kind on or off for everyone. | Someone on long leave still gets them. |

### Sending and running

| # | Question | Old system | Recommended for v2 | Downside |
|---|---|---|---|---|
| 8 | **How is email sent?** | Office 365, signing in as a mailbox with a password. | The same mailbox through SMTP, with the address and password in the server's `.env` file and **a new password**. Built behind one small piece of code so it can be swapped. **I need IT to confirm** the mailbox can still sign in this way: Microsoft has been retiring password sign-in for sending mail, and I can't see from here whether the old emails are actually being delivered. | If IT say no, the alternative is sending through Microsoft Graph with an app registration, which IT must set up. About a day more work. |
| 9 | **Where does the daily job run?** | The server's scheduler runs a script; a web address with a token as a fallback. | A command, `npm run job:daily`, run by the server's scheduler (Task Scheduler on Windows, cron on Linux) at 8am. **No web address.** L&D also get a **Run now** button. | Someone must set the schedule up once on the server. I need to know which system v2 will be hosted on. |

### Dashboards and exports

| # | Question | Old system | Recommended for v2 | Downside |
|---|---|---|---|---|
| 10 | **What is charted?** | Training hours only. | A **Dashboard** screen with two parts. *Training*: the old charts worth keeping (§6). *Workflows*: how far each department has got with PME, skill matrix, TNA and TNI. | The nine per-division charts become one chart with a division picker; anyone used to seeing all nine at once has to click. |
| 11 | **Who sees it?** | Everyone, company-wide. | **L&D** see everything. A **HOD** sees their department, a **division head** their division. Other staff keep their own figures on the overview. | Ordinary staff lose the company-wide charts and the top 10 list. Showing a ranked list of named colleagues to 3,000 people is the part I'd question. |
| 12 | **PDF reports in the old layouts** (PME report, audit reports) | Three PDF pages. | **Not in phase 4** unless L&D name one an auditor asks for. Excel exports exist for all of them. | If an auditor does want the exact old layout, it is added later, one report at a time. |

**Before module 0, I also recommend** spending a short session on the end-to-end tests. A few fail on a full run and
pass when run alone, and the cause isn't known. A daily job and emails add more things that depend on time, so the
checks need to be dependable first.

---

## 4. The reminders

One list per person, built from the same rules that fill *Waiting on you*, so the email and the screen never disagree.

| # | What is waiting | Who is told | Becomes due |
|---|---|---|---|
| 1 | Feedback form for a training that has ended | The participant | The day after the training ends |
| 2 | PME to evaluate | The HOD | When the 3-month period ends |
| 3 | PME to acknowledge | The staff member | When the HOD evaluates |
| 4 | PME sent back by L&D | The HOD | When sent back |
| 5 | PME to verify | L&D | When acknowledged |
| 6 | Attendance to record for a training that has ended | L&D | The day after it ends |
| 7 | Skill matrices not filled in | The department's evaluators | The last month before the quarter closes (question 3) |
| 8 | Skill matrix to approve | The HOD | When submitted |
| 9 | Skill matrix sent back | The evaluator who filled it in | When sent back |
| 10 | TNA to approve | The HOD | When submitted |
| 11 | TNA sent back | The staff member, or the main clerk for a job grade | When sent back |
| 12 | TNA or TNI not started | The staff member; the HOD for a TNI | 14 days before the closing date, if L&D set one (question 4) |

- **The email**: plain and short. Who it is for, each kind as a heading with a count and up to ten lines (name,
  training or quarter, how many days it has waited), and one link into LDMS for each kind. The old L&D greeting and
  sign-off lines are kept.
- **Never sent twice**: each email is recorded before it is sent, one per person per day. A failed send is retried on
  the next run; a second run on the same day sends only what is missing.
- **Test mode**: on until L&D switch it off. Every email goes to the test address, with the real recipient named in
  the subject, exactly as the old scripts do.
- **Resigned staff and people with no HOD** are never emailed. A department with no active HOD is listed in L&D's
  run summary.

## 5. Notifications inside LDMS

- A **bell** in the header with a count of unread, and a list: newest first, each line says what happened and opens
  the record. *Mark all as read*.
- A notification is written **when something happens to your record**: sent back, approved, evaluated and waiting
  for you, verified. It is written in the same step as the change, so it can't be missed or doubled.
- It does not replace *Waiting on you*. That shows what is waiting now; the bell shows what happened. A line is marked
  read when the record is opened.
- Notifications older than 90 days are removed by the daily job.
- **Browser push** (a pop-up when LDMS isn't open) is not in phase 4. It needs HTTPS on the live server and a
  permission on each device, and most shop-floor staff share a computer.

## 6. The dashboard

One screen, **Dashboard**, in the sidebar. A year picker; L&D also get a division and department picker.

**Training** (what the old dashboards showed, minus repeats of what Reports already has):

| Chart | Notes |
|---|---|
| Hours by month, Public / In-house and OJT | Replaces *Public and OJT*. Stacked columns, with the old switch between total hours and average per person. |
| Hours by department | Replaces the nine division charts: one chart, the division chosen above. |
| Cost by month | Says how many trainings have no cost entered, so the gap is visible. |
| Most hours | The ten staff with the most hours, within what the viewer may see. L&D and HODs only. |

**Workflows** (new):

| Chart | Shows |
|---|---|
| PME | By department: waiting for the HOD, for the staff member, for L&D, and verified. Overdue ones counted separately. |
| Skill matrix | By department for the open quarter: not started, draft, waiting for the HOD, approved, against the number of staff who need one. |
| TNA | By department for the open year: not started, draft, with the HOD, approved. |
| TNI | Which departments have saved one for the open year. |

Each chart has a table behind it for screen readers and an Excel export of the same numbers. The existing overview
keeps its own cards; the L&D figures there link to this screen.

## 7. Build order

| Module | What it builds | You can check |
|---|---|---|
| **0. Groundwork** | The records for job runs, emails and notifications. The mail sender with test mode. `npm run job:daily`. A **Jobs and email** screen for L&D: each run with its counts, the test-mode switch, *Send a test email*, *Run now*. No reminders yet. | Send yourself a test email; see a run in the log. |
| **1. Notifications** | The bell and the list; a notification written by each PME, skill matrix and TNA step. | Send a TNA back as a HOD; see it in the staff member's bell. |
| **2. Reminders** | The twelve kinds, the combined email, how often, the switches, the *Chase from* date, the closing date for TNA and TNI. | In test mode, read the email each demo person would get and compare it with their *Waiting on you*. |
| **3. Dashboard: training** | The Dashboard screen and the four training charts, with the stacked chart piece. | Compare the totals with the Reports screens for the same year. |
| **4. Dashboard: workflows** | The four workflow charts and their exports. | Compare a department's counts with its PME, skill matrix and TNA lists. |
| **5. The old audit reports** | (Planned as PDFs; they turned out to be Excel downloads. See *Module 5* below.) The real feedback questions, gender on staff, and the old columns in the audit and OJT exports. | Put each beside the old system's PDF for the same training. |

### Module 0: Groundwork (built 8 Oct 2026, merged)

- **Jobs and email** (`/jobs`, Administration, L&D only: permission `jobs.manage`): how email is set up, test mode,
  the daily job's runs and the latest 50 emails with who each was meant for and where it went.
- **Email** (`src/server/mailer.ts`, `services/mail.ts`, `rules/mail.ts`): `queueEmail` writes the email down under a
  unique key, `sendEmail` sends it and records the result. A failed one is tried again by the next runs, three times
  in all. **Send a test email** goes to the signed-in person, or to the test address in Test; in Off it is only recorded.
- **Safe when unreadable**: a sending setting that can't be read counts as off, and a test-mode setting that can't
  be read counts as on with no address, so nothing reaches staff by accident.
- **The daily job** (`npm run job:daily`, `scripts/daily-job.ts`, `services/job.ts`): sends what is waiting, then
  removes emails, notifications and runs older than 90 days. One run at a time; a run that died is closed as
  failed after 30 minutes. **Run now** does the same from the screen.
- **Decided while building**
  - **One email mode on the screen: Off, Test or Live** (asked for 8 Oct 2026, instead of a line in `.env` and
    in place of separate sending and test-mode switches). Off: emails are only recorded, shown as *Recorded
    only*, and never sent later. Test: really sent, all to the test address typed in with it. Live: really sent to
    staff, behind a warning and a *Go live* button. It starts Off; Test and Live can't be chosen until the mail
    server is set up in `.env`; each change is in the audit log. The end-to-end tests put it to Off while they
    run. The mailbox address and password stay in `.env`: a password typed into a screen would sit in the
    database and its backups.
  - The `Notification` table is created now and first used in module 1.
  - Email bodies are kept (for retries) but never shown on the screen.

### Module 1: Notifications (built 8 Oct 2026, merged)

- **Notifications** (`/notifications`, everyone, under My work): the person's own list, newest first, 50 a page,
  unread ones in bold with a dot (amber when it asks them to do something). **Mark all as read**. The sidebar entry
  shows the unread count; on a phone or tablet a **bell** with the count sits in the top bar.
- **When one is written** (`rules/notification.ts`, `services/notification.ts`), always in the same transaction as
  the change, and never to the person who made it:

  | What happened | Who is told | Opens |
  |---|---|---|
  | The HOD evaluated a PME | The staff member | Their training's page, to acknowledge |
  | L&D verified a PME | The staff member | Their training's page |
  | L&D sent a PME back | The HOD who evaluates | The PME |
  | The HOD sent a skill matrix back, or approved it | Whoever filled it in | The matrix |
  | A TNA was sent back, approved, or reopened by L&D | The person it is about; for a job grade's, whoever submitted it | My TNA, or the job grade's TNA |

- **Opening one** goes through `/notifications/[id]/open`, which marks it read and goes to the record. Only the
  person it was written for can; anyone else gets 404.
- **Decided while building**
  - **A screen and a sidebar entry, not a pop-up list.** The desktop has no top bar to hang a bell on, and the
    sidebar already carries counts. The phone's top bar gets the bell.
  - **Read when opened from the list**, not whenever the record is opened some other way. Marking it from the
    record's own page would also mark it when the browser pre-loads a link.
  - **No notification for things already under Waiting on you**: a TNA or skill matrix submitted for approval, or
    a PME acknowledged and waiting for L&D. Those are counted in the sidebar and chased by the reminders of
    module 2; a notification each would double them.
  - Approving 40 skill matrices at once writes 40 notifications to their evaluators. If that proves noisy, it can
    become one line per approval.

### Module 2: Reminder emails (built 8 Oct 2026, merged)

- **The daily job** now starts by writing today's reminder for each person with something waiting: one email, every
  kind in it, each with a count, up to ten lines, how many days each has waited, and a link into LDMS. One per
  person per day, so a second run writes nothing. Then it sends as before, following the email mode.
- **Thirteen kinds** (the twelve of §4, with *TNA not submitted* and *TNI not filled in* counted apart), each
  using the same filter as the matching part of *Waiting on you* (`services/reminder.ts`).
- **Jobs and email → Reminders**: each kind with who is told, whether it is on, and how many items and people are
  waiting today. **Change reminders** switches kinds on and off and sets **Chase from**. **Who is reminded today**
  lists everyone with something waiting; each row opens **the email that person would get**, as it would arrive.
- **Closing date** (question 4): **Set closing date** on the TNA screen, for L&D. It closes nothing; from 14 days
  before it, staff who haven't submitted their TNA and HODs who haven't filled in their TNI are reminded each day
  until they do. My TNA shows *Submit by* that date. With no date, no one is chased to start.
- **Each run's summary** says how many people had something waiting and how many have no email address, by
  department.
- **Decided while building**
  - **People with no email address get no daily notification either.** A new line in the bell every day would
    bury the real ones; what is waiting is already on their overview and in the sidebar counts. L&D see how many
    there are, by department, on each run.
  - **Skill matrices not submitted** are one line per evaluator per department ("12 staff in Stamping have no
    skill matrix submitted for Q3 2026"), not a line per person, and only in March, June, September and December.
  - **A job grade's TNA not started** isn't chased; only a person's own TNA and a department's TNI are.
  - **A sent-back TNA** is listed under *sent back*, not also under *not submitted*.
  - **L&D's own reminders** (PMEs to verify, attendance to record) go to everyone holding the L&D admin role.
  - **The emails are Handlebars templates in one layout** (asked for 8 Oct 2026; `rules/emailTemplates.ts`): a navy
    LDMS band, a white card, each kind as a small table with how long each line has waited and a teal button into
    LDMS, a quiet footer. Built for Outlook: tables, inline styles, no images. The test email uses the same
    layout. Handlebars was chosen over MJML (a large set of packages for two templates) and React Email (its
    renderer doesn't suit how the daily job runs). One new package: `handlebars`.
  - On a development copy in Test mode, **Run now really sends** one email per demo person with an address to the
    test address. The end-to-end tests put email to Off first, and clear the day's reminder emails.

### Module 3: Dashboard, training (built 9 Oct 2026, merged)

Laid out as the user asked on 9 Oct 2026, after the old system's L&D dashboard.

- **Dashboard** in the sidebar, just below Overview, for everyone who has Reports: L&D see all of PHN, a HOD their
  departments, a division head their divisions. It is built from the same rows and rules as the staff and
  department reports (`trainingDashboard` in `services/dashboard.ts`, `rules/dashboard.ts`), so its totals are theirs.
- **The only filter is the period** (start and end date; empty is this year). No division or department filter.
- **Two tabs**: *Total man hour* and *Average total hour*.
- **Total man hour** has, in this order:
  - **Training overview**: total hours on a large dark tile, split by a bar into total public training hours and
    total OJT hours, each with its percentage; beside it four small tiles for total trainings, total participant
    attend training, total manpower and total training days. There is no pie chart: the user had it removed on
    9 Oct 2026 because the dark tile shows the same split.
  - **Monthly total cost (RM)**: a bar chart with its own **Year** picker; left on *Dates above* it follows the period.
  - **Training hours by month**: stacked columns, Public / In-house and OJT, with a line under it naming the
    busiest month and how many months had training.
  - **All Department List (Total Man Hour)**: a full-width bar chart, one column for each department, between the
    hours chart and the cost chart (asked for 9 Oct 2026). It replaces the first build's list of department bars.
  - **One bar chart for each division** under it, titled with the division's name, showing the total man hours of
    each of its departments, in the division's colour (asked for 9 Oct 2026; the old dashboard had these too).
    Shown when the viewer has more than one division.
  - **Three rankings in one row** (asked for 9 Oct 2026): *Top 5 most hours* (staff), *Top 5 in-house trainers*
    (staff set as a training's internal trainer, by the hours of the trainings they gave, as the old trainer list
    counted) and *Top 5 trainings (total man hour)* (my suggestion: which trainings the hours came from).
  - The four small tiles show the number beside its icon and, under it, how the count is made up: trainings,
    participants and training days month by month with the highest month named (asked for 9 Oct 2026: data, not
    decoration). Total manpower shows its number only, as the user asked.
  - The page is a bento grid: tiles of different sizes on twelve columns, total hours on the one dark tile. Every
    column shows its number. (A version with coloured tiles and uneven card widths was tried on 9 Oct 2026 and
    the user had it reverted.)
- **Average total hour** (laid out by the user, 9 Oct 2026) has, in this order:
  - Three cards: **average total hours**, **average public training hours** and **average OJT hours**.
  - **All Department List (Average Total Hour)**: a full-width bar chart, each department's hours ÷ its headcount.
  - **Average Monthly Total Training Hour**: hours ÷ manpower for each month, Public / In-house and OJT stacked.
  - **One bar chart for each division**, with each of its departments' average; the division's own average
    (its hours ÷ its headcount) is in the card's corner.
  - **The divisors follow the old system** (the user's decision, 12 Oct 2026): average total hours is total hours
    ÷ total manpower; average public and average OJT hours are each ÷ the staff who attended training (*total
    participant attend training*). So the public and OJT averages don't add up to the average total. The monthly
    chart and the department and division charts divide by manpower or headcount.
  - **Trainees aren't counted in total manpower** (the user's decision, 12 Oct 2026), so it is lower than the
    Staff page's count of active staff by the number of trainees.
- **Export to Excel**: a sheet for the overview and one per chart, the same numbers (`/dashboard/export`).
- **How the figures are counted**
  - *Total trainings*: trainings that started in the period and weren't cancelled (for a HOD: those with any of
    their staff on them).
  - *Total participant attend training*: staff with at least one completed training in the period, each counted once.
  - *Total manpower*: active staff, trainees not counted, as in the reports. The old system counted everyone not
    resigned, trainees included, so its number is a little higher.
  - *Total training days*: each training's days, once for every person who completed it, as the old system did.
  - *Total hours*: each training's hours for every person who completed it; the same total as the reports.
  - Public / In-house and OJT add up to total hours. **There is no Departmental type**: the
    user removed it from the system on 9 Oct 2026; trainings that had it became Public / In-house.
- **Decided while building**
  - **Monthly total cost is for L&D only.** A cost is entered for a whole training, not for each department, so a
    HOD or division head has no cost chart.
  - **OJT isn't counted as missing a cost**: its form has no cost field. The chart says how many other trainings
    have none entered.
  - **A person with one department has no department chart**: there is nothing to compare it with.
  - A period of up to two years is drawn month by month; a longer one, year by year.
  - The overview keeps its cards; its *Training at PHN* heading links to the Dashboard.

### Module 4: Dashboard, progress (built 12 Oct 2026, merged)

A third tab on the Dashboard, **Progress**, beside *Total man hour* and *Average total hour* (the user chose a tab
over a separate screen, 12 Oct 2026). For the same people as the other tabs, and each record counted under the
department its staff member is in now (`progressDashboard` in `services/dashboard.ts`, `countStages` in
`rules/dashboard.ts`).

- **Four cards**, each the share finished, a bar split by stage, and "x of y":
  - *PME verified*: of the PMEs that are due. One still inside its evaluation period isn't due and isn't counted.
  - *Skill matrix approved*, for the quarter being filled in: of the non-executive and contract staff who need one.
  - *TNA approved*, for the year being filled in: of the people who fill in their own, plus one for each job
    grade in use in a department.
  - *TNI saved*, for the same year: of the departments.
- **PME by department**, **Skill matrix by department** and **TNA by department**: one stacked column for each
  department, split by where its records stand. Colours mean the same in all three: teal finished, gold waiting
  on someone, coral needing attention (sent back, or a PME waiting for the HOD), grey not started.
- **TNI by department**: a list, saved (with the date and number of rows) or not yet.
- **PMEs waiting for the HOD**: the five departments with the most, each opening those PMEs in the PME list.
- **Export to Excel** gains a sheet for each of the four.
- **Decided while building**
  - **Only PME follows the start and end dates** (PMEs of trainings that started in the period). The skill
    matrix is always the quarter being filled in, and TNA and TNI the year being filled in: they have no other
    period that is "current".
  - **No chart for each division on this tab** (my recommendation; the user didn't object): with three charted
    workflows that would be three more charts for every division.
  - A person with one department sees one column in each chart and no ranking of departments.
- Fixed with it: the cost chart's year wasn't passed on to the Excel export.

### Module 5: The old audit reports (built 12 Oct 2026, merged)

**The plan was wrong about this module.** It called the old PME report, training audit report and OJT audit report
"three PDF pages". They are **Excel downloads**; the old system makes no PDFs. Read on 12 Oct 2026:
`admin/training/public/report_pme.php`, `report_audit.php` and `admin/training/ojt/report_audit_ojt.php`. So this
module adds what those spreadsheets have and v2's exports lacked, and builds no PDF (agreed with the user).

- **The course feedback form is now the old system's**, word for word, in English and Malay: Section A (8
  ratings), Section B (3 ratings), Section C (a yes/no and 4 written answers), all 16 required, on the old scale
  (5 Excellent to 1 Poor). Until now `FEEDBACK_V1` was placeholder wording waiting for L&D; the real questions
  were in the old attendance page and the audit report's column headings. The ids are still `q1` to `q16`, now
  with the old kinds, so phase 5 can import the old answers column for column.
- **Gender on the staff record** (Male, Female, or not recorded): on the staff form and record, in the staff
  export, and as a **Gender** column in the staff import (a file without the column leaves it as it is).
- **Reports → Audit report → Export to Excel** gains Gender, Start Time, End Time and Program, and at the end one
  column for each of the 16 feedback questions, headed with the question as asked. Ratings are their number,
  yes/no in words. OJT rows leave them blank: OJT has its own three questions.
- **OJT → Export to Excel** gains Gender and a column for each of the three OJT answers.
- **The PME report** needed nothing: the PME list's export already has every column of the old one, and more.
- **Decided while building**
  - The audit export keeps v2's wider scope (every attendance, not only completed; every training type), with the
    old columns added, where the old file had completed public trainings only. Filter Attendance to *Completed*
    and Type to *Public / In-house* in Excel for the old file's rows.
  - Demo feedback already in a development copy was answered against the placeholder questions; it was answered
    again in the real form's shape (`prisma/seed.ts` does the same on a seed).
  - The old training-hours workbook (`report.php`) isn't rebuilt: Reports → Department hours and the Dashboard's
    export cover it.

## 8. Data model

```prisma
enum JobStatus { RUNNING  OK  FAILED }

model JobRun {              // one row per run of the daily job
  id            Int       @id @default(autoincrement())
  job           String    @db.VarChar(40)   // "daily"
  startedAt     DateTime  @default(now())
  finishedAt    DateTime?
  status        JobStatus @default(RUNNING)
  summary       Json?                       // counts: due, sent, failed, skipped (no email), by kind
  error         String?   @db.Text
  startedById   Int?                        // null when the scheduler started it
}

enum EmailStatus { QUEUED  SENT  FAILED }

model EmailMessage {        // one row per email: what was meant for whom, and what happened
  id         Int         @id @default(autoincrement())
  staffId    Int?                            // who it is for
  intendedTo String      @db.VarChar(160)    // their address
  sentTo     String      @db.VarChar(160)    // the test address in test mode
  subject    String      @db.VarChar(200)
  body       String      @db.MediumText
  dedupeKey  String      @unique @db.VarChar(80)   // "digest:<staffId>:<YYYY-MM-DD>"
  status     EmailStatus @default(QUEUED)
  attempts   Int         @default(0)
  error      String?     @db.VarChar(500)
  jobRunId   Int?
  createdAt  DateTime    @default(now())
  sentAt     DateTime?
}

model Notification {        // the bell
  id        Int       @id @default(autoincrement())
  staffId   Int
  kind      String    @db.VarChar(40)       // "tna.returned", "pme.evaluated", ...
  title     String    @db.VarChar(200)
  href      String    @db.VarChar(200)
  entity    String    @db.VarChar(40)
  entityId  Int
  createdAt DateTime  @default(now())
  readAt    DateTime?
  @@index([staffId, readAt, createdAt])
}
```

Settings (the existing `Setting` table): `mail.testMode` (exists),
`reminders.kinds` (which are on), `reminders.chaseFrom` (a date), `tna.closingDate`. In `.env`: `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, and `APP_URL` for the links in emails.

New packages: `nodemailer`, and `handlebars` for the email templates.

- **Rules** (`src/server/rules/reminder.ts`, pure and unit-tested): what goes into a person's list; the *Chase from* cut-off; the last month of a quarter; the closing-date window.
- **Services**: `reminder.ts` (who is waiting on what, for everyone at once), `mail.ts` (queue, send, retry, test
  mode), `job.ts` (start, finish, never two runs at once), `notification.ts`, and `dashboard.ts` extended.
- **Permission**: `jobs.manage` for L&D admins. Changes to switches and test mode go in the audit log.
- Email bodies hold staff names, so `EmailMessage` rows are removed after 90 days, with the notifications.

## 9. Security notes

- **The old mailbox password is in the old system's source code**, in five files, and that code is in a git
  repository. Whoever can read the code can send email as that mailbox. It should be changed whatever happens with
  v2, and v2 will use the new one from `.env`, never from code.
- The old reminder scripts can be started from a web address with a token that is also in the code. v2's job has no
  web address.
- The old log file names staff and their email addresses and sits under the web folder unless the server is set up
  otherwise. v2 keeps the record in the database, shown only to L&D.
- Emails contain names and training titles and nothing else: no marks, no ratings, no reasons for sending back.

## 10. Not in phase 4

- Browser push notifications (§5).
- Telling a division head when a HOD hasn't acted after some days. The dashboard shows it; an email about a
  colleague's lateness is a decision for L&D and management, not a default.
- Importing old records: phase 5.

## 11. Tests to add

- **Rules**: each of the twelve kinds in and out of its
  window; test mode's address and subject; one email per person per day.
- **A consistency test**: for each demo person, the reminder list equals what `*Waiting` returns for them.
- **End to end**: L&D run the job in test mode and see the run and its emails; a second run the same day sends
  nothing; a HOD sends a TNA back and the staff member's bell shows it; the Dashboard's totals match Reports; a
  staff member and a clerk are refused the Dashboard and the Jobs screen.
- No test ever sends a real email: the mail sender is swapped for one that only records.

## 12. Phase 4 is done when

- Everything in §7 works and is covered by the tests in §11.
- L&D have read a week of test-mode emails and agreed the wording.
- All checks pass: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`.
