import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { DESIGNATIONS } from "@/lib/validation/staff";
import { TRAINING_TYPES } from "@/lib/validation/training";
import { isAdmin, type SessionUser } from "../permissions";
import {
  bucketKey,
  costSummary,
  countStages,
  periodBuckets,
  topTrainings,
  trainerTotals,
  stackHours,
  sumByBucket,
  topByHours,
  type Bucket,
  type BucketUnit,
} from "../rules/dashboard";
import { isActiveHeadcount } from "../rules/headcount";
import { pmeStage, type PmeStage } from "../rules/pme";
import { SKILL_DESIGNATIONS, SKILL_STAGES, skillOpenQuarter, skillStage } from "../rules/skill";
import { JOB_GRADES, TNA_BY_GRADE_WHERE, TNA_OWN_WHERE, TNA_STAGES, tnaStage } from "../rules/tna";
import { departmentTotals, grandTotal, inStaffReport, reportPeriod, round2, staffTotals } from "../rules/report";
import { countsTowardHours, trainingDays, trainingHours, trainingPhase } from "../rules/training";
import { ensure } from "./org";
import { tnaOpen } from "./tna";
import { hoursSelect, reportDepartments, staffWhere, startsIn, type ReportFilters } from "./report";

// Read-only figures for the overview. Hours always come from trainingHours and
// countsTowardHours, and a training belongs to the year and month it starts in
// (the same rule as the trainings list's year filter).

const trainingSelect = {
  id: true,
  type: true,
  title: true,
  function: true,
  platform: true,
  venue: true,
  trainerName: true,
  startDate: true,
  endDate: true,
  startTime: true,
  endTime: true,
  status: true,
  sessions: { select: { date: true, startTime: true, endTime: true } },
} satisfies Prisma.TrainingSelect;

type TrainingRow = Prisma.TrainingGetPayload<{ select: typeof trainingSelect }>;

const yearRange = (year: number) => ({ gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) });
const byStart = (a: { startDate: Date }, b: { startDate: Date }) => a.startDate.getTime() - b.startDate.getTime();

/** Hours per month (Jan–Dec) of a year, from rows that count toward hours. */
function monthlyHours(rows: { hours: number; startDate: Date }[]): number[] {
  const months = Array<number>(12).fill(0);
  for (const r of rows) months[r.startDate.getUTCMonth()] += r.hours;
  return months.map((h) => Math.round(h * 100) / 100);
}

const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;

/** The signed-in person's own trainings: what's next, what they've done, their hours. */
export async function myLearning(user: SessionUser, today: Date) {
  const year = today.getUTCFullYear();
  const rows = await db.participant.findMany({
    where: { staffId: user.id },
    select: { id: true, attendance: true, submittedAt: true, training: { select: trainingSelect } },
  });
  const all = rows.map((p) => ({
    ...p,
    hours: trainingHours(p.training) ?? 0,
    phase: trainingPhase(p.training, today),
    counts: countsTowardHours(p),
  }));
  const thisYear = all.filter((p) => p.training.startDate.getUTCFullYear() === year);
  const done = thisYear.filter((p) => p.counts).map((p) => ({ hours: p.hours, startDate: p.training.startDate }));

  return {
    year,
    hoursThisYear: sum(done.map((d) => d.hours)),
    completedThisYear: done.length,
    /** Trainings they're on this year that are going ahead: the "of" in "2 of 3 completed". */
    enrolledThisYear: thisYear.filter((p) => p.training.status !== "CANCELLED").length,
    monthly: monthlyHours(done),
    hoursAllTime: sum(all.filter((p) => p.counts).map((p) => p.hours)),
    completedAllTime: all.filter((p) => p.counts).length,
    /** Trainings they're on that haven't finished yet, soonest first. */
    upcoming: all
      .filter((p) => (p.phase === "UPCOMING" || p.phase === "IN_PROGRESS") && p.attendance === "PENDING")
      .sort((a, b) => byStart(a.training, b.training)),
    /** Trainings that have been held, latest first. */
    recent: all
      .filter((p) => p.phase === "HELD")
      .sort((a, b) => byStart(b.training, a.training))
      .slice(0, 5),
  };
}

export type MyLearning = Awaited<ReturnType<typeof myLearning>>;

/** Training across PHN this year, for L&D. */
export async function trainingOverview(user: SessionUser, today: Date) {
  ensure(user, "training.view");
  const year = today.getUTCFullYear();
  const trainings = await db.training.findMany({
    where: { startDate: yearRange(year) },
    select: { ...trainingSelect, cost: true, participants: { select: { attendance: true } } },
  });

  const live = trainings.filter((t) => t.status !== "CANCELLED");
  const rows = live.map((t) => ({ ...t, hours: trainingHours(t) ?? 0, phase: trainingPhase(t, today) }));
  const held = rows.filter((t) => t.phase === "HELD");

  // Participant-hours: each completed attendance at a training that went ahead.
  const delivered: { hours: number; startDate: Date }[] = [];
  for (const t of rows)
    for (const p of t.participants)
      if (countsTowardHours({ attendance: p.attendance, training: t })) delivered.push({ hours: t.hours, startDate: t.startDate });

  const attendance = { COMPLETED: 0, PENDING: 0, ABSENT: 0 };
  for (const t of held) for (const p of t.participants) attendance[p.attendance]++;

  const toRecord = held
    .map((t) => ({ ...t, pending: t.participants.filter((p) => p.attendance === "PENDING").length, total: t.participants.length }))
    .filter((t) => t.pending > 0)
    .sort((a, b) => byStart(b, a));

  const upcoming = await db.training.findMany({
    where: { status: "SCHEDULED", endDate: { gte: new Date(Date.UTC(year, today.getUTCMonth(), today.getUTCDate())) } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    take: 4,
    select: { ...trainingSelect, _count: { select: { participants: true } } },
  });

  return {
    year,
    planned: rows.length,
    heldCount: held.length,
    cancelled: trainings.length - live.length,
    deliveredHours: sum(delivered.map((d) => d.hours)),
    /** Course cost (RM) of this year's trainings that are going ahead. */
    spend: sum(live.map((t) => (t.cost === null ? 0 : Number(t.cost)))),
    monthly: monthlyHours(delivered),
    attendance,
    toRecord,
    upcoming: upcoming.map((t) => ({ ...t, hours: trainingHours(t), phase: trainingPhase(t, today), participantCount: t._count.participants })),
  };
}

export type TrainingOverview = Awaited<ReturnType<typeof trainingOverview>>;
export type { TrainingRow };

// ---------- The Dashboard screen (phase 4, module 3) ----------

/**
 * The training charts, for the staff the user's reports cover (L&D all, a HOD
 * their departments, a division head their divisions), for the period chosen.
 * Built from the same rows and rules as the staff and department reports, so
 * the totals are theirs. `costYear` draws the cost chart for one calendar
 * year instead of the period.
 */
export async function trainingDashboard(user: SessionUser, f: ReportFilters, today: Date, costYear?: number) {
  ensure(user, "report.view");
  const period = reportPeriod(f.from, f.to, today);
  const where = staffWhere(user, f, false);
  const admin = isAdmin(user);
  const [allDepartments, staff, done, trainings] = await Promise.all([
    reportDepartments(user),
    db.staff.findMany({
      where,
      select: { id: true, staffNo: true, name: true, designation: true, status: true, departmentId: true, department: { select: { name: true } } },
    }),
    db.participant.findMany({
      where: { attendance: "COMPLETED", staff: where, training: { status: "SCHEDULED", ...startsIn(period) } },
      select: { staffId: true, training: { select: { id: true, type: true, title: true, trainingCode: true, ...hoursSelect } } },
    }),
    // Trainings going ahead in the period: all of them for L&D, those with any of their staff on them for others.
    db.training.findMany({
      where: { status: { not: "CANCELLED" }, ...startsIn(period), ...(admin ? {} : { participants: { some: { staff: where } } }) },
      select: { ...hoursSelect, trainerStaff: { select: { id: true, staffNo: true, name: true, department: { select: { name: true } } } } },
    }),
  ]);

  const counted = done.map((p) => ({
    staffId: p.staffId,
    trainingId: p.training.id,
    type: p.training.type,
    date: p.training.startDate,
    hours: trainingHours(p.training) ?? 0,
    days: trainingDays(p.training) ?? 0,
  }));
  const totals = staffTotals(counted);
  const people = staff.filter((s) => inStaffReport(s, totals.get(s.id))).map((s) => ({ ...s, ...(totals.get(s.id) ?? { completed: 0, hours: 0 }) }));
  const byDepartment = departmentTotals(people);
  const departments = allDepartments
    .filter((d) => (!f.divisionId || d.division.id === f.divisionId) && (!f.departmentId || d.id === f.departmentId))
    .map((d) => ({ ...d, ...(byDepartment.get(d.id) ?? { headcount: 0, trained: 0, completed: 0, hours: 0, average: null }) }));
  const total = grandTotal(departments);

  // In-house trainers: the staff set as a training's internal trainer. Each training's own hours go to them.
  const mine = new Set(staff.map((s) => s.id));
  const taught = trainings.flatMap((t) =>
    t.trainerStaff && mine.has(t.trainerStaff.id) ? [{ trainerId: t.trainerStaff.id, trainer: t.trainerStaff, hours: trainingHours(t) ?? 0 }] : [],
  );
  const trainers = new Map(taught.map((t) => [t.trainerId, t.trainer]));
  const topTrainers = topByHours([...trainerTotals(taught).entries()].map(([id, t]) => ({ ...trainers.get(id)!, completed: t.trainings, hours: t.hours })));

  const { unit, buckets } = periodBuckets(period, today);
  const byType = stackHours(
    buckets,
    unit,
    TRAINING_TYPES,
    counted.map((c) => ({ date: c.date, series: c.type, hours: c.hours })),
  );
  const hoursOf = (type: (typeof TRAINING_TYPES)[number]) => round2(counted.filter((c) => c.type === type).reduce((a, c) => a + c.hours, 0));

  // Cost is entered per training, not per department: only L&D see it, and only for all of PHN.
  const narrowed = !admin || !!f.divisionId || !!f.departmentId;
  let cost: {
    year: number | null;
    years: number[];
    unit: BucketUnit;
    buckets: Bucket[];
    byBucket: number[];
    total: number;
    withCost: number;
    withoutCost: number;
  } | null = null;
  if (!narrowed) {
    const span = await db.training.aggregate({ _min: { startDate: true }, _max: { startDate: true } });
    const years: number[] = [];
    if (span._min.startDate && span._max.startDate)
      for (let y = span._max.startDate.getUTCFullYear(); y >= span._min.startDate.getUTCFullYear(); y--) years.push(y);
    const year = costYear && years.includes(costYear) ? costYear : null;
    const costPeriod = year ? { from: `${year}-01-01`, to: `${year}-12-31` } : period;
    const drawn = year ? periodBuckets(costPeriod, today) : { unit, buckets };
    const trainings = await db.training.findMany({
      where: { status: { not: "CANCELLED" }, ...startsIn(costPeriod) },
      select: { cost: true, type: true, startDate: true },
    });
    const rows = trainings.map((t) => ({ cost: t.cost === null ? null : Number(t.cost), type: t.type, date: t.startDate }));
    cost = {
      year,
      years,
      ...drawn,
      byBucket: sumByBucket(
        drawn.buckets,
        drawn.unit,
        rows.map((r) => ({ date: r.date, amount: r.cost ?? 0 })),
      ),
      ...costSummary(rows),
    };
  }

  return {
    period,
    unit,
    buckets,
    /** Hours for each bucket, one number per training type, in TRAINING_TYPES order. */
    byType,
    departments,
    total,
    /** The figures of the training overview. */
    overview: {
      trainings: trainings.length,
      /** People with at least one completed training in the period. */
      attended: people.filter((p) => p.completed > 0).length,
      manpower: total.headcount,
      /** The manpower by designation, largest group first; designations with no one are left out. */
      manpowerByDesignation: DESIGNATIONS.map((designation) => ({
        designation,
        count: people.filter((p) => p.designation === designation && isActiveHeadcount(p)).length,
      }))
        .filter((d) => d.count > 0)
        .sort((a, b) => b.count - a.count),
      /** A training's days, once for each person who completed it. */
      days: counted.reduce((a, c) => a + c.days, 0),
      hours: total.hours,
      hoursByType: Object.fromEntries(TRAINING_TYPES.map((t) => [t, hoursOf(t)])) as Record<(typeof TRAINING_TYPES)[number], number>,
    },
    /** The overview's counts for each bucket, to show how they are spread over the period. */
    trend: {
      trainings: sumByBucket(
        buckets,
        unit,
        trainings.map((t) => ({ date: t.startDate, amount: 1 })),
      ),
      /** People who completed at least one training that started in the bucket. */
      attended: sumByBucket(
        buckets,
        unit,
        [...new Map(counted.map((c) => [`${bucketKey(c.date, unit)}:${c.staffId}`, c.date])).values()].map((date) => ({ date, amount: 1 })),
      ),
      days: sumByBucket(
        buckets,
        unit,
        counted.map((c) => ({ date: c.date, amount: c.days })),
      ),
    },
    /** The five staff with the most completed hours. */
    top: topByHours(people),
    /** The five in-house trainers who gave the most hours, among the staff the user may see. */
    topTrainers,
    /** The five trainings that gave the most man hours. */
    topTrainings: topTrainings(
      counted,
      new Map(done.map((p) => [p.training.id, { title: p.training.title, trainingCode: p.training.trainingCode, type: p.training.type }])),
    ),
    /** Null when it can't be shown: not L&D, or narrowed to a division or department. */
    cost,
    isAdmin: admin,
  };
}

export type TrainingDashboard = Awaited<ReturnType<typeof trainingDashboard>>;

// ---------- The Dashboard's Progress tab (phase 4, module 4) ----------

/** The PME stages the Progress tab charts, in the order work moves through them. Not-required PMEs are left out. */
export const PROGRESS_PME_STAGES = ["TO_EVALUATE", "TO_ACKNOWLEDGE", "TO_VERIFY", "VERIFIED", "IN_PERIOD"] as const satisfies readonly PmeStage[];

/**
 * How far each department has got with PME, the skill matrix, TNA and TNI, for
 * the staff and departments the user's reports cover. PMEs are those of
 * trainings that started in the period; the skill matrix is the quarter being
 * filled in; TNA and TNI are the year being filled in. Each record is counted
 * under the department its staff member is in now.
 */
export async function progressDashboard(user: SessionUser, f: ReportFilters, today: Date) {
  ensure(user, "report.view");
  const period = reportPeriod(f.from, f.to, today);
  const staffScope = staffWhere(user, {}, false);
  const quarter = skillOpenQuarter(today);
  const year = await tnaOpen(today);
  const departments = await reportDepartments(user);
  const departmentIds = departments.map((d) => d.id);
  const inQuarter = { year: quarter.year, quarter: quarter.quarter };

  const [pmes, skillStaff, tnaStaff, gradeHeadcounts, gradeTnas, tnis] = await Promise.all([
    db.pme.findMany({
      where: { status: { not: "NOT_REQUIRED" }, participant: { staff: staffScope, training: { status: "SCHEDULED", ...startsIn(period) } } },
      select: { status: true, periodEnd: true, participant: { select: { staff: { select: { departmentId: true } } } } },
    }),
    // Staff who can have a matrix in the quarter: active, or with one already on record for it.
    db.staff.findMany({
      where: { AND: [staffScope, { designation: { in: [...SKILL_DESIGNATIONS] } }, { OR: [{ status: "ACTIVE" }, { skillEvaluations: { some: inQuarter } }] }] },
      select: { departmentId: true, skillEvaluations: { where: inQuarter, select: { status: true, returnReason: true } } },
    }),
    // Staff who fill in their own TNA: those who do today, or who have one on record for the year.
    db.staff.findMany({
      where: { AND: [staffScope, { OR: [TNA_OWN_WHERE, { tnas: { some: { year } } }] }] },
      select: { departmentId: true, tnas: { where: { year }, select: { status: true, returnReason: true } } },
    }),
    // A job grade's TNA covers everyone on that grade in a department: one record for each grade in use.
    db.staff.groupBy({ by: ["departmentId", "jobGrade"], where: { ...TNA_BY_GRADE_WHERE, departmentId: { in: departmentIds } }, _count: { _all: true } }),
    db.tna.findMany({ where: { year, departmentId: { in: departmentIds } }, select: { departmentId: true, jobGrade: true, status: true, returnReason: true } }),
    db.tni.findMany({
      where: { year, departmentId: { in: departmentIds } },
      select: { departmentId: true, updatedAt: true, updatedBy: { select: { name: true } }, _count: { select: { items: true } } },
    }),
  ]);

  const gradeRecords = departments.flatMap((d) =>
    JOB_GRADES.flatMap((jobGrade) => {
      const tna = gradeTnas.find((t) => t.departmentId === d.id && t.jobGrade === jobGrade) ?? null;
      const inUse = gradeHeadcounts.some((h) => h.departmentId === d.id && h.jobGrade === jobGrade && h._count._all > 0);
      return inUse || tna ? [{ departmentId: d.id, stage: tnaStage(tna) }] : [];
    }),
  );

  return {
    period,
    quarter,
    year,
    pme: countStages(
      PROGRESS_PME_STAGES,
      departments,
      pmes.map((p) => ({ departmentId: p.participant.staff.departmentId, stage: pmeStage(p, today) as (typeof PROGRESS_PME_STAGES)[number] })),
    ),
    skill: countStages(
      SKILL_STAGES,
      departments,
      skillStaff.map((s) => ({ departmentId: s.departmentId, stage: skillStage(s.skillEvaluations[0]) })),
    ),
    tna: countStages(TNA_STAGES, departments, [...tnaStaff.map((s) => ({ departmentId: s.departmentId, stage: tnaStage(s.tnas[0]) })), ...gradeRecords]),
    /** Each department with its TNI for the year, or null when none is saved. */
    tni: departments.map((department) => ({ department, tni: tnis.find((t) => t.departmentId === department.id) ?? null })),
    isAdmin: isAdmin(user),
  };
}

export type ProgressDashboard = Awaited<ReturnType<typeof progressDashboard>>;
