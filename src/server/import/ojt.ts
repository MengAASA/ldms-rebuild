import { COMPARED_YEARS, cleanDate, cleanText, cleanTime, mapOjtAnswers, mapOjtTrainer, oldOjtCode, type OldFeedback } from "../rules/import";
import { MAX_CONSECUTIVE_DAYS } from "../rules/training";
import {
  OLD_HOURS_COLUMNS,
  compareAttendance,
  insertParticipants,
  insertTrainings,
  loadPeople,
  planAttendance,
  type AttendanceConfig,
  type OldAttendanceRow,
  type PlannedTraining,
} from "./attendance";
import type { ImportRun } from "./run";

// OJT: the old `ojt` and `ojt_archive` tables, then who attended and their
// answers from `participateojt` and `participateojt_archive`. The live tables
// hold 2026, the archives the years before; their ids don't overlap, but they
// do overlap with the old trainings' (Training.legacySource tells them apart).
//
// Not in the old tables: how the OJT was given (OJT, coaching or mentoring).
// The old form asks for it but never saves it, so it is left blank.

type OldOjt = {
  id: number;
  trainingcode: string | null;
  title: string | null;
  startdate: string | null;
  enddate: string | null;
  starttime: string | null;
  endtime: string | null;
  venue: string | null;
  trainertype: string | null;
  trainername: string | null;
  olddays: unknown;
  oldhours: unknown;
};

type OldOjtAttendance = OldFeedback & OldAttendanceRow & { totalman: number | null; clerkid: number | null };

const P = "ojt" as const;
const SOURCE = "ojt";
const UNTITLED = "Untitled OJT (old system)";
const OJT_COLUMNS =
  "id, trainingcode, title, CAST(startdate AS CHAR) AS startdate, CAST(enddate AS CHAR) AS enddate, CAST(starttime AS CHAR) AS starttime, " +
  `CAST(endtime AS CHAR) AS endtime, venue, trainertype, trainername, ${OLD_HOURS_COLUMNS}`;
const ATTENDANCE_COLUMNS = "id, ojtid AS trainingId, userid AS userId, attendance, q1, q2, q3, totalman, clerkid";

export async function importOjt(run: ImportRun) {
  const [live, archive, liveRows, archiveRows, people] = await Promise.all([
    run.read<OldOjt>(`SELECT ${OJT_COLUMNS} FROM ojt ORDER BY id`),
    run.read<OldOjt>(`SELECT ${OJT_COLUMNS} FROM ojt_archive ORDER BY id`),
    run.read<OldOjtAttendance>(`SELECT ${ATTENDANCE_COLUMNS}, 'participateojt' AS \`table\` FROM participateojt ORDER BY id`),
    run.read<OldOjtAttendance>(`SELECT ${ATTENDANCE_COLUMNS}, 'participateojt_archive' AS \`table\` FROM participateojt_archive ORDER BY id`),
    loadPeople(run),
  ]);

  const trainings = new Map<number, PlannedTraining>();
  const seenCode = new Set<string>();
  for (const t of [...archive.map((t) => ({ ...t, table: "ojt_archive" })), ...live.map((t) => ({ ...t, table: "ojt" }))]) {
    const plan: PlannedTraining = {
      oldId: t.id,
      table: t.table,
      oldYear: Number(t.startdate?.slice(0, 4) ?? 0),
      oldDays: Number(t.olddays ?? 0),
      oldHours: Number(t.oldhours ?? 0),
      row: null,
    };
    trainings.set(t.id, plan);
    const startDate = cleanDate(t.startdate);
    const endDate = cleanDate(t.enddate);
    const startTime = cleanTime(t.starttime);
    const endTime = cleanTime(t.endtime);
    // An OJT with no real date can't be placed in any period: it waits for L&D to give one (§3.1).
    if (!startDate) plan.skipped = "no start date: L&D to give one";
    else if (!endDate) plan.skipped = "no end date: L&D to give one";
    else if (!startTime || !endTime) plan.skipped = "no start or end time";
    if (plan.skipped || !startDate || !endDate || !startTime || !endTime) {
      run.issue(P, `Not imported: ${plan.skipped}`, t.table, t.id, `${t.startdate} to ${t.enddate}`);
      continue;
    }

    // Wrong dates come across as they are, for a clerk to correct (decision 6).
    const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
    const outside = [startDate, endDate].some((d) => !(COMPARED_YEARS as readonly number[]).includes(d.getUTCFullYear()));
    if (outside) run.issue(P, "A date outside 2023 to 2026: imported as it is, for a clerk to correct", t.table, t.id, `${t.startdate} to ${t.enddate}`);
    if (days < 1) run.issue(P, "Ends before it starts: imported as it is, no hours until a clerk corrects it", t.table, t.id, `${t.startdate} to ${t.enddate}`);
    else if (days > MAX_CONSECUTIVE_DAYS)
      run.issue(P, `Runs for more than ${MAX_CONSECUTIVE_DAYS} days: imported as it is`, t.table, t.id, `${days} days, ${t.startdate} to ${t.enddate}`);
    if (endTime <= startTime)
      run.issue(P, "Ends at or before its start time: no hours until a clerk corrects the time", t.table, t.id, `${t.starttime} to ${t.endtime}`);

    const title = cleanText(t.title, 200);
    if (!title.value) run.issue(P, `No title in the old system: imported as "${UNTITLED}"`, t.table, t.id);
    if (title.cut) run.issue(P, "Title cut to 200 characters", t.table, t.id);

    let code = cleanText(t.trainingcode, 20).value?.toUpperCase() ?? null;
    if (!code || seenCode.has(code)) {
      const given = oldOjtCode(startDate, t.id);
      if (code) run.issue(P, "A training code another OJT has: given a new one", t.table, t.id, `${code} → ${given}`);
      code = given;
    }
    seenCode.add(code);

    const program = mapOjtTrainer(t.trainertype);
    if (!program.known) run.issue(P, "A trainer type v2 doesn't have: left blank", t.table, t.id, String(t.trainertype));
    const venue = cleanText(t.venue, 160);
    const trainerName = cleanText(t.trainername, 160);

    plan.row = {
      type: "OJT",
      title: title.value ?? UNTITLED,
      trainingCode: code,
      program: program.value,
      ojtMethod: null,
      venue: venue.value,
      trainerName: trainerName.value,
      startDate,
      endDate,
      startTime,
      endTime,
      legacySource: SOURCE,
      legacyId: t.id,
    };
  }
  const noCode = [...archive, ...live].filter((t) => !cleanText(t.trainingcode, 20).value && trainings.get(t.id)?.row).length;

  const cfg: AttendanceConfig<OldOjtAttendance> = {
    part: P,
    legacySource: SOURCE,
    noun: "OJT",
    trainings,
    rows: [...archiveRows, ...liveRows],
    staff: people.staff,
    answers: mapOjtAnswers,
    // A clerk's id is on what a clerk recorded; the rest L&D or the staff member recorded, and the old rows don't say which.
    source: (r) => (r.clerkid ? { source: "CLERK", recordedById: people.staff.get(r.clerkid)?.id ?? null } : { source: "ADMIN", recordedById: null }),
    people: (r) => r.totalman ?? 1,
    departmentKey: people.departmentKey,
    departmentName: people.departmentName,
  };
  const plan = planAttendance(run, cfg);

  // The organising department, when everyone on it is from the same one (as when a clerk records an OJT in v2).
  const departments = new Map<number, Set<number>>();
  for (const p of plan.planned) {
    const set = departments.get(p.oldTrainingId) ?? new Set<number>();
    set.add(people.staff.get(p.oldUserId)!.departmentId);
    departments.set(p.oldTrainingId, set);
  }
  let empty = 0;
  for (const t of trainings.values()) {
    if (!t.row) continue;
    const set = departments.get(t.oldId);
    if (set?.size === 1 && !run.checkOnly) t.row.departmentId = [...set][0];
    if (!set) {
      empty++;
      run.issue(P, "No one on this OJT in v2: nobody in the old system, or only staff who are gone", t.table, t.oldId);
    }
  }

  const trainingOf = await insertTrainings(
    run,
    SOURCE,
    [...trainings.values()].flatMap((t) => t.row ?? []),
  );
  await insertParticipants(run, plan.planned, trainingOf);
  await compareAttendance(run, cfg, plan, {
    trainings: "OJTs",
    note: `${noCode.toLocaleString("en-GB")} given a training code; ${empty.toLocaleString("en-GB")} with no one on them`,
  });
}
