import type { Attendance, ParticipantSource, Prisma } from "@prisma/client";
import {
  COMPARED_YEARS,
  HOLDING_DEPARTMENT,
  PENDING_FROM_YEAR,
  isDeletedDepartment,
  keptDuplicate,
  mapAttendance,
  yearBucket,
  type ImportPart,
  type MappedAnswers,
} from "../rules/import";
import { trainingHours } from "../rules/training";
import type { ImportRun } from "./run";

// What the trainings part and the OJT part share: putting the old trainings
// and their attendance into v2, and comparing the result with the old
// system, row counts and training hours, the old dashboard's way.

const CHUNK = 1000;
/** The department key of staff counted under the holding department. */
export const HOLDING = "holding";

export type TrainingRow = Prisma.TrainingCreateManyInput & { legacyId: number; startDate: Date; endDate: Date; startTime: Date; endTime: Date };

/** An old training (or OJT) as the import planned it. */
export type PlannedTraining = {
  oldId: number;
  table: string;
  /** The year of its old start date; 0 when it has none. */
  oldYear: number;
  /** Its days and hours as the old dashboard works them out: days × each day's hours rounded to 2 decimals. */
  oldDays: number;
  oldHours: number;
  /** What goes into v2; null when it can't be imported, and `skipped` says why. */
  row: TrainingRow | null;
  skipped?: string;
};

/** The columns, in the old query, that give `oldDays` and `oldHours` (fetch_dash.php's formula). */
export const OLD_HOURS_COLUMNS =
  "DATEDIFF(enddate, startdate) + 1 AS olddays, (DATEDIFF(enddate, startdate) + 1) * ROUND(TIME_TO_SEC(TIMEDIFF(endtime, starttime)) / 3600, 2) AS oldhours";

export type OldAttendanceRow = { id: number; table: string; trainingId: number | null; userId: number | null; attendance: string | null };

export type AttendanceConfig<R extends OldAttendanceRow> = {
  part: ImportPart;
  /** Training.legacySource of these trainings. */
  legacySource: string;
  /** "training" or "OJT", as the report says it. */
  noun: string;
  trainings: Map<number, PlannedTraining>;
  rows: R[];
  /** v2 staff by old user id (checking only: the old records themselves). */
  staff: Map<number, { id: number; departmentId: number }>;
  answers: (r: R) => MappedAnswers;
  /** Who the row was recorded by in v2. */
  source: (r: R) => { source: ParticipantSource; recordedById: number | null };
  /** How many people the old system counts the row as (the old OJT `totalman`); 1 when not given. */
  people?: (r: R) => number;
  /** The department an old user is counted under in the comparison: an old department id, or HOLDING. */
  departmentKey: (oldUserId: number) => string;
  departmentName: (key: string) => string;
};

type Status = Attendance;

/** One old attendance row the old system's pages count (its training and staff member still exist), and what v2 should make of it. */
type OldLine = {
  year: string;
  status: Status;
  blank: boolean;
  feedback: boolean;
  department: string;
  /** Hours as the old dashboard counts them, and as v2 should; `why` names the difference. */
  hours: number;
  expected: number;
  days: number;
  why: string | null;
  /** Why the row isn't in v2 at all. */
  missing: string | null;
};

export type PlannedParticipant = { oldTrainingId: number; oldUserId: number; data: Omit<Prisma.ParticipantCreateManyInput, "trainingId"> };

/** Trainings by department or year, as the comparison groups them. */
type V2Line = { year: string; status: Status; feedback: boolean; department: string; hours: number };

export type OldUser = { id: number; staffname: string | null; status: string | null; department_id: number | null };

/**
 * The staff the staff part brought across, by old id, and the department each
 * old record is counted under in the comparison (the holding department for
 * none, or one marked deleted, as the staff part decided).
 */
export async function loadPeople(run: ImportRun) {
  const [users, departments] = await Promise.all([
    run.read<OldUser>("SELECT id, staffname, status, department_id FROM user"),
    run.read<{ id: number; name: string | null }>("SELECT id, name FROM departments"),
  ]);
  const staff = new Map<number, { id: number; departmentId: number }>();
  if (run.checkOnly) for (const u of users) staff.set(u.id, { id: u.id, departmentId: u.department_id ?? 0 });
  else
    for (const s of await run.target.staff.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true, departmentId: true } }))
      staff.set(s.legacyId!, { id: s.id, departmentId: s.departmentId });
  const names = new Map(departments.map((d) => [d.id, d.name ?? `department ${d.id}`]));
  const departmentOf = new Map(users.map((u) => [u.id, u.department_id]));
  const departmentKey = (oldUserId: number) => {
    const d = departmentOf.get(oldUserId);
    return d != null && names.has(d) && !isDeletedDepartment(names.get(d)) ? String(d) : HOLDING;
  };
  const departmentName = (key: string) => (key === HOLDING ? HOLDING_DEPARTMENT : (names.get(Number(key)) ?? key));
  return { users, staff, departmentKey, departmentName };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const sum = (ns: number[]) => round2(ns.reduce((a, b) => a + b, 0));
const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * Decides, row by row, what of the old attendance goes into v2: rows whose
 * training or staff member is gone are listed, the same person twice on one
 * training is kept once (decision 7), blank attendance follows decision 8.
 */
export function planAttendance<R extends OldAttendanceRow>(run: ImportRun, cfg: AttendanceConfig<R>) {
  const P = cfg.part;
  const groups = new Map<string, R[]>();
  const inScope: R[] = []; // what the old pages count: training and staff member still there
  for (const a of cfg.rows) {
    const t = a.trainingId === null ? undefined : cfg.trainings.get(a.trainingId);
    const staffGone = a.userId === null || !cfg.staff.has(a.userId);
    if (!t) run.issue(P, `Not imported: its ${cfg.noun} is no longer in the old database`, a.table, a.id, staffGone ? "the staff member is gone too" : "");
    else if (staffGone) run.issue(P, "Not imported: its staff member is no longer in the old database", a.table, a.id, `${cfg.noun} ${a.trainingId}`);
    if (!t || staffGone) continue;
    inScope.push(a);
    if (!t.row) run.issue(P, `Not imported: its ${cfg.noun} was not imported`, a.table, a.id, `${cfg.noun} ${a.trainingId}: ${t.skipped}`);
    else push(groups, `${a.trainingId}:${a.userId}`, a);
  }

  const missing = new Map<R, string>();
  const planned: PlannedParticipant[] = [];
  for (const group of groups.values()) {
    const ranked = group.map((r) => ({
      id: r.id,
      row: r,
      completed: mapAttendance(r.attendance, 0)?.attendance === "COMPLETED",
      hasFeedback: cfg.answers(r).answers !== null,
    }));
    const kept = group.length > 1 ? keptDuplicate(ranked).row : group[0];
    for (const other of group)
      if (other !== kept) {
        missing.set(other, "duplicates");
        run.issue(
          P,
          `Not imported: the same person is on this ${cfg.noun} more than once (one row kept)`,
          other.table,
          other.id,
          `kept ${kept.table} ${kept.id}`,
        );
      }

    const t = cfg.trainings.get(kept.trainingId!)!;
    const mapped = mapAttendance(kept.attendance, t.row!.startDate.getUTCFullYear());
    if (!mapped) {
      missing.set(kept, "an attendance word v2 doesn't know");
      run.issue(P, "Not imported: an attendance word v2 doesn't know", kept.table, kept.id, String(kept.attendance));
      continue;
    }
    if (mapped.blank && mapped.attendance === "ABSENT")
      run.issue(P, `Attendance blank before ${PENDING_FROM_YEAR}: imported as Absent ("${mapped.reason}")`, kept.table, kept.id);
    const answers = cfg.answers(kept);
    if (answers.odd.length) run.issue(P, "An answer that doesn't fit its question: left blank", kept.table, kept.id, answers.odd.join(", "));
    if (answers.answers && mapped.attendance !== "COMPLETED")
      run.issue(P, "Has answers but wasn't completed: answers kept", kept.table, kept.id, mapped.attendance.toLowerCase());
    const people = cfg.people?.(kept) ?? 1;
    if (people !== 1) run.issue(P, "Counted as more or fewer than one person in the old system: one person in v2", kept.table, kept.id, `counted as ${people}`);

    planned.push({
      oldTrainingId: kept.trainingId!,
      oldUserId: kept.userId!,
      data: {
        staffId: cfg.staff.get(kept.userId!)!.id,
        attendance: mapped.attendance,
        attendanceReason: mapped.reason,
        ...cfg.source(kept),
        legacyId: kept.id,
        // The old system kept no date for answers: the training's last day, when its form opened, stands in.
        ...(answers.answers ? { feedback: answers.answers, feedbackVersion: 1, submittedAt: t.row!.endDate } : {}),
      },
    });
  }

  // The old side of the comparison, row by row.
  const oldLines: OldLine[] = inScope.map((a) => {
    const t = cfg.trainings.get(a.trainingId!)!;
    const word = (a.attendance ?? "").trim().toUpperCase();
    const completed = word === "COMPLETED" || word === "COMPLETEDOJT";
    const status: Status = completed ? "COMPLETED" : word === "ABSENT" ? "ABSENT" : t.oldYear >= PENDING_FROM_YEAR ? "PENDING" : "ABSENT";
    const people = cfg.people?.(a) ?? 1;
    const hours = completed ? t.oldHours * people : 0;
    const gone = t.row ? (missing.get(a) ?? null) : (t.skipped ?? "not imported");
    let expected = hours;
    let why: string | null = null;
    if (completed && gone) [expected, why] = [0, gone];
    else if (completed && trainingHours(t.row!) === null) [expected, why] = [0, `${cfg.noun}s that end before they start`];
    else if (completed && people !== 1) [expected, why] = [t.oldHours, "rows counted as more or fewer than one person"];
    return {
      year: yearBucket(t.oldYear),
      status,
      blank: !word,
      feedback: cfg.answers(a).answers !== null,
      department: cfg.departmentKey(a.userId!),
      hours,
      expected,
      days: completed ? t.oldDays : 0,
      why,
      missing: gone,
    };
  });

  return { planned, oldLines, inScope: inScope.length };
}

/** Puts the planned trainings into v2 and gives their v2 ids by old id (checking only: the old ids). */
export async function insertTrainings(run: ImportRun, legacySource: string, rows: TrainingRow[]): Promise<Map<number, number>> {
  const trainingOf = new Map<number, number>();
  if (run.checkOnly) {
    for (const r of rows) trainingOf.set(r.legacyId, r.legacyId);
    return trainingOf;
  }
  for (let i = 0; i < rows.length; i += CHUNK) await run.target.training.createMany({ data: rows.slice(i, i + CHUNK) });
  for (const t of await run.target.training.findMany({ where: { legacySource }, select: { id: true, legacyId: true } })) trainingOf.set(t.legacyId!, t.id);
  return trainingOf;
}

export async function insertParticipants(run: ImportRun, planned: PlannedParticipant[], trainingOf: Map<number, number>) {
  if (run.checkOnly) return;
  for (let i = 0; i < planned.length; i += CHUNK)
    await run.target.participant.createMany({
      data: planned.slice(i, i + CHUNK).map((p) => ({ ...p.data, trainingId: trainingOf.get(p.oldTrainingId)! })),
    });
}

/**
 * Old against v2, written to the comparison: trainings and attendance rows by
 * year and status, answers, and training hours by year and by department.
 * Every hour of difference is put down to a reason; what is left is rounding.
 */
export async function compareAttendance<R extends OldAttendanceRow>(
  run: ImportRun,
  cfg: AttendanceConfig<R>,
  plan: ReturnType<typeof planAttendance<R>>,
  label: { trainings: string; note?: string },
) {
  const P = cfg.part;
  const planned = [...cfg.trainings.values()];

  // The v2 side: read back from the database that was filled, or (checking only) from the plan.
  let v2Trainings: { year: string }[];
  let v2Lines: V2Line[];
  if (run.checkOnly) {
    v2Trainings = planned.flatMap((t) => (t.row ? [{ year: yearBucket(t.row.startDate.getUTCFullYear()) }] : []));
    v2Lines = plan.planned.map((p) => {
      const row = cfg.trainings.get(p.oldTrainingId)!.row!;
      return {
        year: yearBucket(row.startDate.getUTCFullYear()),
        status: p.data.attendance!,
        feedback: !!p.data.feedbackVersion,
        department: cfg.departmentKey(p.oldUserId),
        hours: trainingHours(row) ?? 0,
      };
    });
  } else {
    const trainings = await run.target.training.findMany({
      where: { legacySource: cfg.legacySource },
      select: { id: true, startDate: true, endDate: true, startTime: true, endTime: true },
    });
    const byId = new Map(trainings.map((t) => [t.id, { year: yearBucket(t.startDate.getUTCFullYear()), hours: trainingHours(t) ?? 0 }]));
    v2Trainings = [...byId.values()];
    const rows = await run.target.$queryRaw<{ trainingId: number; attendance: Status; answered: bigint | number; department: number | null }[]>`
      SELECT p.trainingId, p.attendance, p.feedbackVersion IS NOT NULL AS answered, d.legacyId AS department
      FROM Participant p JOIN Training t ON t.id = p.trainingId JOIN Staff s ON s.id = p.staffId JOIN Department d ON d.id = s.departmentId
      WHERE t.legacySource = ${cfg.legacySource}`;
    v2Lines = rows.map((r) => {
      const t = byId.get(r.trainingId)!;
      return {
        year: t.year,
        status: r.attendance,
        feedback: Number(r.answered) === 1,
        department: r.department === null ? HOLDING : String(r.department),
        hours: t.hours,
      };
    });
  }

  const old = plan.oldLines;
  const reasons = (list: OldLine[]) => {
    const by = new Map<string, number>();
    for (const l of list) if (l.missing) by.set(l.missing, (by.get(l.missing) ?? 0) + 1);
    return [...by].map(([why, n]) => `${why} ${n.toLocaleString("en-GB")}`).join("; ");
  };

  // Trainings and attendance rows.
  run.count(P, label.trainings, planned.length, v2Trainings.length, label.note ?? "");
  const gone = cfg.rows.length - plan.inScope;
  const leftOut = reasons(old);
  run.count(
    P,
    "Attendance rows",
    cfg.rows.length,
    v2Lines.length,
    [gone ? `${plural(gone, "row")} whose ${cfg.noun} or staff member is gone` : "", leftOut ? `left out: ${leftOut}` : ""].filter(Boolean).join("; "),
  );
  run.count(P, "With answers", old.filter((l) => l.feedback).length, v2Lines.filter((l) => l.feedback).length, reasons(old.filter((l) => l.feedback)));

  const years = [...COMPARED_YEARS.map(String), "other years"];
  for (const year of years) {
    const o = planned.filter((t) => yearBucket(t.oldYear) === year);
    const v = v2Trainings.filter((t) => t.year === year).length;
    const notImported = o.filter((t) => !t.row).length;
    if (o.length || v) run.count(P, `${label.trainings} in ${year}`, o.length, v, notImported ? `${notImported} not imported` : "");
  }

  for (const year of years)
    for (const [status, word] of [
      ["COMPLETED", "Completed"],
      ["ABSENT", "Absent"],
      ["PENDING", "Pending"],
    ] as const) {
      const o = old.filter((l) => l.year === year && l.status === status);
      const v = v2Lines.filter((l) => l.year === year && l.status === status).length;
      if (!o.length && !v) continue;
      const blank = o.filter((l) => l.blank).length;
      const notes = [
        blank && status === "ABSENT" ? `${blank.toLocaleString("en-GB")} left blank, imported as absent` : "",
        blank && status === "PENDING" ? "left blank in the old system" : "",
        reasons(o) ? `left out: ${reasons(o)}` : "",
      ];
      run.count(P, `${word}, ${year}`, o.length, v, notes.filter(Boolean).join("; "));
    }

  // Hours. Rounding: the old system rounds each day to 2 decimals (up to 0.005 h a day), v2 only the total.
  const explain = (o: OldLine[], v2: number) => {
    const total = sum(o.map((l) => l.hours));
    const by = new Map<string, number>();
    for (const l of o) if (l.why) by.set(l.why, (by.get(l.why) ?? 0) + l.hours - l.expected);
    const rounding = round2(v2 - sum(o.map((l) => l.expected)));
    const bound = sum(o.map((l) => (l.why ? 0 : l.days * 0.005))) + 0.01;
    const note = [
      ...[...by].filter(([, h]) => Math.abs(h) >= 0.005).map(([why, h]) => `${why} ${round2(h)} h`),
      rounding ? `rounding ${rounding > 0 ? "+" : ""}${rounding} h` : "",
    ]
      .filter(Boolean)
      .join("; ");
    return { total, note, explained: Math.abs(rounding) <= bound };
  };
  const v2Hours = (lines: V2Line[]) => sum(lines.filter((l) => l.status === "COMPLETED").map((l) => l.hours));
  for (const year of years) {
    const o = old.filter((l) => l.year === year);
    const v = v2Lines.filter((l) => l.year === year);
    if (!o.length && !v.length) continue;
    const e = explain(o, v2Hours(v));
    run.count(P, `Hours, ${year}`, e.total, v2Hours(v), e.note);
  }

  // By department, all years together: each in the report, and here how many agree once the reasons are set aside.
  const departments = [...new Set([...old, ...v2Lines].filter((l) => l.status === "COMPLETED").map((l) => l.department))];
  let agree = 0;
  for (const d of departments) {
    const v = v2Hours(v2Lines.filter((l) => l.department === d));
    const e = explain(
      old.filter((l) => l.department === d),
      v,
    );
    if (e.explained) agree++;
    run.detail(P, `Hours: ${cfg.departmentName(d)}`, e.total, v, e.note);
  }
  run.count(
    P,
    "Departments whose hours agree",
    departments.length,
    agree,
    "once the reasons above and the old system's rounding of each day are set aside; each is in the report",
  );
}
