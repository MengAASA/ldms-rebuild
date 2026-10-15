import type { Prisma } from "@prisma/client";
import { trainingHours } from "../rules/training";
import {
  PENDING_FROM_YEAR,
  cleanDate,
  cleanText,
  isDeletedDepartment,
  cleanTime,
  keptDuplicate,
  mapAttendance,
  mapFeedback,
  mapFunction,
  mapHrdc,
  mapPlatform,
  mapProgram,
  nameKey,
  type OldFeedback,
} from "../rules/import";
import type { ImportRun } from "./run";

// Trainings (public and in-house): the old `training` and `training_archive`
// tables, then their attendance and course feedback from `participation` and
// `participation_archive`. The live tables hold 2026, the archives 2023 to
// 2025; their ids don't overlap. OJT is the next part.

type OldTraining = {
  id: number;
  trainingcode: string | null;
  title: string | null;
  program: string | null;
  cost: number | null;
  platform: string | null;
  func: string | null;
  startdate: string | null;
  enddate: string | null;
  starttime: string | null;
  endtime: string | null;
  venue: string | null;
  trainer: string | null;
  hadc: string | null;
  /** The training's hours as the old dashboard works them out (fetch_dash.php). */
  oldhours: unknown;
};

type OldAttendance = OldFeedback & { id: number; trainingid: number | null; userid: number | null; attendance: string | null; table: string };

const P = "training" as const;
const SOURCE = "training"; // Training.legacySource: the old OJT table reuses the same ids
const CHUNK = 1000;
const TRAINING_COLUMNS =
  "id, trainingcode, title, program, cost, platform, `function` AS func, CAST(startdate AS CHAR) AS startdate, CAST(enddate AS CHAR) AS enddate, " +
  "CAST(starttime AS CHAR) AS starttime, CAST(endtime AS CHAR) AS endtime, venue, trainer, hadc, " +
  "(DATEDIFF(enddate, startdate) + 1) * ROUND(TIME_TO_SEC(TIMEDIFF(endtime, starttime)) / 3600, 2) AS oldhours";
const ATTENDANCE_COLUMNS = "id, trainingid, userid, attendance, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, q13, q14, q15, q16";
const HOLDING = "holding"; // the department key of staff in the holding department

const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function importTrainings(run: ImportRun) {
  const [live, archive, liveRows, archiveRows, users, departments] = await Promise.all([
    run.read<OldTraining>(`SELECT ${TRAINING_COLUMNS} FROM training ORDER BY id`),
    run.read<OldTraining>(`SELECT ${TRAINING_COLUMNS} FROM training_archive ORDER BY id`),
    run.read<OldAttendance>(`SELECT ${ATTENDANCE_COLUMNS}, 'participation' AS \`table\` FROM participation ORDER BY id`),
    run.read<OldAttendance>(`SELECT ${ATTENDANCE_COLUMNS}, 'participation_archive' AS \`table\` FROM participation_archive ORDER BY id`),
    run.read<{ id: number; staffname: string | null; status: string | null; department_id: number | null }>(
      "SELECT id, staffname, status, department_id FROM user",
    ),
    run.read<{ id: number; name: string | null }>("SELECT id, name FROM departments"),
  ]);
  const oldTrainings = [...archive.map((t) => ({ ...t, table: "training_archive" })), ...live.map((t) => ({ ...t, table: "training" }))];
  const db = run.target;

  // The staff the previous part brought across, by old id. Checking only, they are the old records themselves.
  const staffOf = new Map<number, number>();
  if (run.checkOnly) for (const u of users) staffOf.set(u.id, u.id);
  else for (const s of await db.staff.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } })) staffOf.set(s.legacyId!, s.id);

  // An internal trainer is the one staff record with that name, the active one if several share it.
  const byName = new Map<string, typeof users>();
  for (const u of users) if (staffOf.has(u.id)) byName.set(nameKey(u.staffname), [...(byName.get(nameKey(u.staffname)) ?? []), u]);
  const trainerOf = (raw: unknown) => {
    const same = byName.get(nameKey(raw)) ?? [];
    const working = same.filter((u) => nameKey(u.status) !== "RESIGN");
    const one = same.length === 1 ? same[0] : working.length === 1 ? working[0] : null;
    return one ? { staffId: staffOf.get(one.id)!, name: cleanText(one.staffname, 160).value } : { staffId: null, name: null, several: same.length > 1 };
  };

  // ---- trainings
  type Row = Prisma.TrainingCreateManyInput & { legacyId: number; startDate: Date; endDate: Date; startTime: Date; endTime: Date };
  const rows: Row[] = [];
  const seenCode = new Set<string>();
  for (const t of oldTrainings) {
    const title = cleanText(t.title, 200);
    const startDate = cleanDate(t.startdate);
    const endDate = cleanDate(t.enddate);
    const startTime = cleanTime(t.starttime);
    const endTime = cleanTime(t.endtime);
    // Without these there is no training to make. None is expected; each is listed if it happens.
    if (!title.value) run.issue(P, "Not imported: no title", t.table, t.id);
    else if (!startDate || !endDate || endDate < startDate)
      run.issue(P, "Not imported: no dates, or it ends before it starts", t.table, t.id, `${t.startdate} to ${t.enddate}`);
    else if (!startTime || !endTime) run.issue(P, "Not imported: no start or end time", t.table, t.id, `${t.starttime} to ${t.endtime}`);
    if (!title.value || !startDate || !endDate || endDate < startDate || !startTime || !endTime) continue;

    if (title.cut) run.issue(P, "Title cut to 200 characters", t.table, t.id);
    if (endTime <= startTime)
      run.issue(P, "Ends at or before its start time: no hours until L&D correct the time", t.table, t.id, `${t.starttime} to ${t.endtime}`);

    let code = cleanText(t.trainingcode, 20).value?.toUpperCase() ?? null;
    if (!code || seenCode.has(code)) {
      const given = `TR${t.startdate!.slice(0, 10).replaceAll("-", "")}${String(t.id).padStart(6, "0")}`;
      run.issue(P, "No training code, or one another training has: given a new one", t.table, t.id, `${t.trainingcode ?? "blank"} → ${given}`);
      code = given;
    }
    seenCode.add(code);

    const program = mapProgram(t.program);
    const fn = mapFunction(t.func);
    const platform = mapPlatform(t.platform);
    const hrdc = mapHrdc(t.hadc);
    if (!program.known) run.issue(P, "A program v2 doesn't have: left blank", t.table, t.id, String(t.program));
    else if (!program.value) run.issue(P, "No program in the old system: L&D to fill in", t.table, t.id);
    if (!fn.known) run.issue(P, "A function v2 doesn't have: left blank", t.table, t.id, String(t.func));
    else if (!fn.value) run.issue(P, "No function in the old system: L&D to fill in", t.table, t.id);
    if (!platform.known) run.issue(P, "A platform v2 doesn't have: left blank", t.table, t.id, String(t.platform));
    else if (!platform.value) run.issue(P, "No platform in the old system: L&D to fill in", t.table, t.id);
    if (!hrdc.known || hrdc.value === null) run.issue(P, "HRDC claimable blank in the old system: imported as No", t.table, t.id, String(t.hadc ?? ""));

    const venue = cleanText(t.venue, 160);
    const trainerName = cleanText(t.trainer, 160);
    if (venue.cut) run.issue(P, "Venue cut to 160 characters", t.table, t.id);
    if (trainerName.cut) run.issue(P, "Trainer cut to 160 characters", t.table, t.id);
    // Only "internal training by internal trainer" names a member of staff as the trainer, as on the form.
    let trainer: { staffId: number | null; name: string | null } = { staffId: null, name: trainerName.value };
    if (program.value === "INTERNAL_INTERNAL_TRAINER" && trainerName.value) {
      const found = trainerOf(trainerName.value);
      if (found.staffId) trainer = { staffId: found.staffId, name: found.name };
      else
        run.issue(
          P,
          "Internal trainer isn't a staff record by that name: kept as typed",
          t.table,
          t.id,
          "several" in found && found.several ? "more than one person has that name" : "",
        );
    }

    rows.push({
      type: "PUBLIC_INHOUSE",
      title: title.value,
      trainingCode: code,
      program: program.value,
      function: fn.value,
      platform: platform.value,
      hrdfClaimable: hrdc.value ?? false,
      cost: t.cost === null ? null : t.cost.toFixed(2),
      venue: venue.value,
      trainerName: trainer.name,
      trainerStaffId: trainer.staffId,
      startDate,
      endDate,
      startTime,
      endTime,
      legacySource: SOURCE,
      legacyId: t.id,
    });
  }

  if (!run.checkOnly) for (let i = 0; i < rows.length; i += CHUNK) await db.training.createMany({ data: rows.slice(i, i + CHUNK) });
  const trainingOf = new Map<number, number>();
  if (run.checkOnly) for (const r of rows) trainingOf.set(r.legacyId, r.legacyId);
  else for (const t of await db.training.findMany({ where: { legacySource: SOURCE }, select: { id: true, legacyId: true } })) trainingOf.set(t.legacyId!, t.id);

  // ---- attendance and feedback
  const oldById = new Map(oldTrainings.map((t) => [t.id, t]));
  const rowByOldId = new Map(rows.map((r) => [r.legacyId, r]));
  const yearOf = (oldTrainingId: number) =>
    rowByOldId.get(oldTrainingId)?.startDate.getUTCFullYear() ?? Number(oldById.get(oldTrainingId)?.startdate?.slice(0, 4));
  const attendance = [...archiveRows, ...liveRows];
  const groups = new Map<string, (OldAttendance & { completed: boolean; hasFeedback: boolean })[]>();
  for (const a of attendance) {
    const trainingGone = a.trainingid === null || !oldById.has(a.trainingid);
    const staffGone = a.userid === null || !staffOf.has(a.userid);
    if (trainingGone) {
      run.issue(P, "Not imported: its training is no longer in the old database", a.table, a.id, staffGone ? "the staff member is gone too" : "");
      continue;
    }
    if (staffGone) {
      run.issue(P, "Not imported: its staff member is no longer in the old database", a.table, a.id, `training ${a.trainingid}`);
      continue;
    }
    if (!trainingOf.has(a.trainingid!)) {
      run.issue(P, "Not imported: its training was not imported", a.table, a.id, `training ${a.trainingid}`);
      continue;
    }
    const k = `${a.trainingid}:${a.userid}`;
    const row = { ...a, completed: mapAttendance(a.attendance, 0)?.attendance === "COMPLETED", hasFeedback: mapFeedback(a).answers !== null };
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }

  type Planned = { data: Prisma.ParticipantCreateManyInput; oldTrainingId: number; oldUserId: number };
  const planned: Planned[] = [];
  const dropped: OldAttendance[] = [];
  for (const group of groups.values()) {
    const kept = group.length > 1 ? keptDuplicate(group) : group[0];
    for (const other of group)
      if (other !== kept) {
        dropped.push(other);
        run.issue(P, "Not imported: the same person is on this training more than once (one row kept)", other.table, other.id, `kept ${kept.table} ${kept.id}`);
      }

    const year = yearOf(kept.trainingid!);
    const mapped = mapAttendance(kept.attendance, year);
    if (!mapped) {
      run.issue(P, "Not imported: an attendance word v2 doesn't know", kept.table, kept.id, String(kept.attendance));
      continue;
    }
    if (mapped.blank && mapped.attendance === "ABSENT")
      run.issue(P, `Attendance blank on a training before ${PENDING_FROM_YEAR}: imported as Absent ("${mapped.reason}")`, kept.table, kept.id);
    const feedback = mapFeedback(kept);
    if (feedback.odd.length) run.issue(P, "A feedback answer that doesn't fit its question: left blank", kept.table, kept.id, feedback.odd.join(", "));
    if (feedback.answers && mapped.attendance !== "COMPLETED")
      run.issue(P, "Has feedback answers but wasn't completed: answers kept", kept.table, kept.id, mapped.attendance.toLowerCase());

    const training = rowByOldId.get(kept.trainingid!)!;
    planned.push({
      oldTrainingId: kept.trainingid!,
      oldUserId: kept.userid!,
      data: {
        trainingId: trainingOf.get(kept.trainingid!)!,
        staffId: staffOf.get(kept.userid!)!,
        attendance: mapped.attendance,
        attendanceReason: mapped.reason,
        source: "ADMIN",
        legacyId: kept.id,
        // The old system kept no date for feedback: the training's last day, when its form opened, stands in.
        ...(feedback.answers ? { feedback: feedback.answers, feedbackVersion: 1, submittedAt: training.endDate } : {}),
      },
    });
  }
  if (!run.checkOnly) for (let i = 0; i < planned.length; i += CHUNK) await db.participant.createMany({ data: planned.slice(i, i + CHUNK).map((p) => p.data) });

  // ---- old against v2. The old side is what the old system's own pages and reports count: attendance
  // whose training and staff member still exist. The v2 side is read back from the database that was filled.
  const kept = attendance.filter((a) => a.trainingid !== null && trainingOf.has(a.trainingid) && a.userid !== null && staffOf.has(a.userid));
  const droppedIds = new Set(dropped.map((a) => `${a.table}:${a.id}`));
  const badTime = new Set(rows.filter((r) => r.endTime <= r.startTime).map((r) => r.legacyId));
  const oldDepartment = new Map(users.map((u) => [u.id, u.department_id]));
  const departmentName = new Map(departments.map((d) => [d.id, d.name ?? `department ${d.id}`]));
  // The department a person is counted under: their own, or the holding department as the staff part decided.
  const departmentKey = (oldUserId: number) => {
    const d = oldDepartment.get(oldUserId);
    return d != null && departmentName.has(d) && !isDeletedDepartment(departmentName.get(d)) ? String(d) : HOLDING;
  };

  type Line = { year: number; attendance: string; feedback: boolean; department: string; hours: number };
  let v2Lines: Line[];
  if (run.checkOnly)
    v2Lines = planned.map((p) => {
      const t = rowByOldId.get(p.oldTrainingId)!;
      return {
        year: t.startDate.getUTCFullYear(),
        attendance: p.data.attendance!,
        feedback: !!p.data.feedbackVersion,
        department: departmentKey(p.oldUserId),
        hours: trainingHours(t) ?? 0,
      };
    });
  else
    v2Lines = (
      await db.participant.findMany({
        where: { training: { legacySource: SOURCE } },
        select: {
          attendance: true,
          feedbackVersion: true,
          staff: { select: { department: { select: { legacyId: true } } } },
          training: { select: { startDate: true, endDate: true, startTime: true, endTime: true } },
        },
      })
    ).map((p) => ({
      year: p.training.startDate.getUTCFullYear(),
      attendance: p.attendance,
      feedback: p.feedbackVersion !== null,
      department: p.staff.department.legacyId === null ? HOLDING : String(p.staff.department.legacyId),
      hours: trainingHours(p.training) ?? 0,
    }));

  const oldLines = kept.map((a) => {
    const t = oldById.get(a.trainingid!)!;
    return {
      year: yearOf(a.trainingid!),
      attendance: (a.attendance ?? "").trim().toUpperCase(),
      feedback: mapFeedback(a).answers !== null,
      department: departmentKey(a.userid!),
      hours: Number(t.oldhours ?? 0),
      duplicate: droppedIds.has(`${a.table}:${a.id}`),
      badTime: badTime.has(a.trainingid!),
    };
  });

  const v2Trainings = run.checkOnly ? rows.length : await db.training.count({ where: { legacySource: SOURCE } });
  run.count(P, "Trainings", oldTrainings.length, v2Trainings, "public and in-house");
  run.count(
    P,
    "Attendance rows",
    attendance.length,
    v2Lines.length,
    `left out: ${attendance.length - kept.length} whose training or staff member is gone, ${plural(dropped.length, "duplicate")}`,
  );
  run.count(
    P,
    "With feedback answers",
    oldLines.filter((l) => l.feedback).length,
    v2Lines.filter((l) => l.feedback).length,
    oldLines.some((l) => l.feedback && l.duplicate) ? `${oldLines.filter((l) => l.feedback && l.duplicate).length} on a duplicate row` : "",
  );

  const years = [...new Set(oldTrainings.map((t) => Number(t.startdate?.slice(0, 4))))].sort();
  for (const year of years) {
    const v2Count = run.checkOnly
      ? rows.filter((r) => r.startDate.getUTCFullYear() === year).length
      : await db.training.count({
          where: { legacySource: SOURCE, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
        });
    run.count(P, `Trainings in ${year}`, oldTrainings.filter((t) => Number(t.startdate?.slice(0, 4)) === year).length, v2Count);
  }

  // Attendance by year and status. Blank attendance is counted where decision 8 puts it.
  const statusOf = (l: (typeof oldLines)[number]) =>
    l.attendance === "COMPLETED" ? "COMPLETED" : l.attendance === "ABSENT" ? "ABSENT" : l.year >= PENDING_FROM_YEAR ? "PENDING" : "ABSENT";
  for (const year of years)
    for (const [status, label] of [
      ["COMPLETED", "Completed"],
      ["ABSENT", "Absent"],
      ["PENDING", "Pending"],
    ] as const) {
      const old = oldLines.filter((l) => l.year === year && statusOf(l) === status);
      const v2 = v2Lines.filter((l) => l.year === year && l.attendance === status).length;
      if (!old.length && !v2) continue;
      const blank = old.filter((l) => !l.attendance).length;
      const duplicates = old.filter((l) => l.duplicate).length;
      const notes = [
        blank && status === "ABSENT" ? `${blank} left blank, imported as absent` : "",
        blank && status === "PENDING" ? "left blank in the old system" : "",
        duplicates ? `${plural(duplicates, "duplicate")} left out` : "",
      ];
      run.count(P, `${label}, ${year}`, old.length, v2, notes.filter(Boolean).join("; "));
    }

  // Training hours, the old dashboard's way against v2's. The old figure counts duplicates, and a day that ends
  // before it starts as negative hours; v2 counts neither. What is left is rounding: the old system rounds each day.
  const hoursNote = (old: typeof oldLines) => {
    const done = old.filter((l) => l.attendance === "COMPLETED");
    const dup = round2(done.filter((l) => l.duplicate).reduce((a, l) => a + l.hours, 0));
    const bad = round2(done.filter((l) => l.badTime && !l.duplicate).reduce((a, l) => a + l.hours, 0));
    return { dup, bad, total: round2(done.reduce((a, l) => a + l.hours, 0)) };
  };
  const v2Hours = (lines: Line[]) => round2(lines.filter((l) => l.attendance === "COMPLETED").reduce((a, l) => a + l.hours, 0));
  const describe = (n: { dup: number; bad: number; total: number }, v2: number) => {
    const rest = round2(v2 - (n.total - n.dup - n.bad));
    return [n.dup ? `duplicates ${n.dup} h` : "", n.bad ? `ends before it starts ${n.bad} h` : "", rest ? `rounding ${rest > 0 ? "+" : ""}${rest} h` : ""]
      .filter(Boolean)
      .join("; ");
  };
  for (const year of years) {
    const n = hoursNote(oldLines.filter((l) => l.year === year));
    const v2 = v2Hours(v2Lines.filter((l) => l.year === year));
    run.count(P, `Training hours, ${year}`, n.total, v2, describe(n, v2));
  }

  // By department, all years together: each one in the report, and a line here for those that agree.
  const departmentKeys = [...new Set([...oldLines, ...v2Lines].filter((l) => l.attendance === "COMPLETED").map((l) => l.department))];
  let agree = 0;
  for (const d of departmentKeys) {
    const n = hoursNote(oldLines.filter((l) => l.department === d));
    const v2 = v2Hours(v2Lines.filter((l) => l.department === d));
    const explained = Math.abs(v2 - (n.total - n.dup - n.bad)) < 0.1;
    if (explained) agree++;
    const name = d === HOLDING ? "No department (old system)" : departmentName.get(Number(d))!;
    run.detail(P, `Training hours: ${name}`, n.total, v2, describe(n, v2));
  }
  run.count(
    P,
    "Departments whose hours agree",
    departmentKeys.length,
    agree,
    "once duplicates, days that end before they start and rounding (under 0.1 h) are set aside; each is in the report",
  );
}
