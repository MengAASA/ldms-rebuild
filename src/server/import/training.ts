import { cleanDate, cleanText, cleanTime, mapFeedback, mapFunction, mapHrdc, mapPlatform, mapProgram, nameKey, type OldFeedback } from "../rules/import";
import {
  OLD_HOURS_COLUMNS,
  compareAttendance,
  insertParticipants,
  insertTrainings,
  loadPeople,
  planAttendance,
  type AttendanceConfig,
  type OldAttendanceRow,
  type OldUser,
  type PlannedTraining,
} from "./attendance";
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
  olddays: unknown;
  oldhours: unknown;
};

type OldAttendance = OldFeedback & OldAttendanceRow;

const P = "training" as const;
const SOURCE = "training"; // Training.legacySource: the old OJT table reuses the same ids
const TRAINING_COLUMNS =
  "id, trainingcode, title, program, cost, platform, `function` AS func, CAST(startdate AS CHAR) AS startdate, CAST(enddate AS CHAR) AS enddate, " +
  `CAST(starttime AS CHAR) AS starttime, CAST(endtime AS CHAR) AS endtime, venue, trainer, hadc, ${OLD_HOURS_COLUMNS}`;
const ATTENDANCE_COLUMNS = "id, trainingid AS trainingId, userid AS userId, attendance, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, q13, q14, q15, q16";

/** An internal trainer is the one staff record with that name, the working one if several share it. */
function trainerFinder(users: OldUser[], staff: Map<number, { id: number }>) {
  const byName = new Map<string, OldUser[]>();
  for (const u of users) if (staff.has(u.id)) byName.set(nameKey(u.staffname), [...(byName.get(nameKey(u.staffname)) ?? []), u]);
  return (raw: unknown) => {
    const same = byName.get(nameKey(raw)) ?? [];
    const working = same.filter((u) => nameKey(u.status) !== "RESIGN");
    const one = same.length === 1 ? same[0] : working.length === 1 ? working[0] : null;
    return one ? { staffId: staff.get(one.id)!.id, name: cleanText(one.staffname, 160).value } : { staffId: null, name: null, several: same.length > 1 };
  };
}

export async function importTrainings(run: ImportRun) {
  const [live, archive, liveRows, archiveRows, people] = await Promise.all([
    run.read<OldTraining>(`SELECT ${TRAINING_COLUMNS} FROM training ORDER BY id`),
    run.read<OldTraining>(`SELECT ${TRAINING_COLUMNS} FROM training_archive ORDER BY id`),
    run.read<OldAttendance>(`SELECT ${ATTENDANCE_COLUMNS}, 'participation' AS \`table\` FROM participation ORDER BY id`),
    run.read<OldAttendance>(`SELECT ${ATTENDANCE_COLUMNS}, 'participation_archive' AS \`table\` FROM participation_archive ORDER BY id`),
    loadPeople(run),
  ]);
  const trainerOf = trainerFinder(people.users, people.staff);

  const trainings = new Map<number, PlannedTraining>();
  const seenCode = new Set<string>();
  for (const t of [...archive.map((t) => ({ ...t, table: "training_archive" })), ...live.map((t) => ({ ...t, table: "training" }))]) {
    const plan: PlannedTraining = {
      oldId: t.id,
      table: t.table,
      oldYear: Number(t.startdate?.slice(0, 4) ?? 0),
      oldDays: Number(t.olddays ?? 0),
      oldHours: Number(t.oldhours ?? 0),
      row: null,
    };
    trainings.set(t.id, plan);
    const title = cleanText(t.title, 200);
    const startDate = cleanDate(t.startdate);
    const endDate = cleanDate(t.enddate);
    const startTime = cleanTime(t.starttime);
    const endTime = cleanTime(t.endtime);
    // Without these there is no training to make. None is expected; each is listed if it happens.
    if (!title.value) plan.skipped = "no title";
    else if (!startDate || !endDate || endDate < startDate) plan.skipped = "no dates, or it ends before it starts";
    else if (!startTime || !endTime) plan.skipped = "no start or end time";
    if (plan.skipped || !title.value || !startDate || !endDate || !startTime || !endTime) {
      run.issue(P, `Not imported: ${plan.skipped}`, t.table, t.id, `${t.startdate} to ${t.enddate}, ${t.starttime} to ${t.endtime}`);
      continue;
    }

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

    plan.row = {
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
    };
  }

  const cfg: AttendanceConfig<OldAttendance> = {
    part: P,
    legacySource: SOURCE,
    noun: "training",
    trainings,
    rows: [...archiveRows, ...liveRows],
    staff: people.staff,
    answers: mapFeedback,
    source: () => ({ source: "ADMIN", recordedById: null }), // L&D added everyone in the old system
    departmentKey: people.departmentKey,
    departmentName: people.departmentName,
  };
  const plan = planAttendance(run, cfg);
  const trainingOf = await insertTrainings(
    run,
    SOURCE,
    [...trainings.values()].flatMap((t) => t.row ?? []),
  );
  await insertParticipants(run, plan.planned, trainingOf);
  await compareAttendance(run, cfg, plan, { trainings: "Trainings", note: "public and in-house" });
}
