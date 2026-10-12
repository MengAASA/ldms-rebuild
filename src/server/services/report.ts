import "server-only";
import type { Prisma, TrainingType } from "@prisma/client";
import { db } from "../db";
import { UserError } from "../errors";
import { isAdmin, reportDepartmentScope, reportStaffScope, staffViewScope, type SessionUser } from "../permissions";
import { departmentTotals, grandTotal, hoursByYear, inStaffReport, reportPeriod, round2, staffTotals } from "../rules/report";
import { pmeStage } from "../rules/pme";
import { countsTowardHours, manHours, trainingHours, trainingPhase } from "../rules/training";
import { ensure } from "./org";

// Training reports (module 6): read-only. Every figure comes from the rules in
// rules/report.ts and rules/training.ts, so the screens, their Excel exports
// and the overview agree. Everyone sees only the staff reportStaffScope allows:
// L&D all, HODs their departments, division heads their divisions.

export type ReportFilters = {
  /** YYYY-MM-DD: trainings starting on or after this day (default: 1 January this year). */
  from?: string;
  /** YYYY-MM-DD: trainings starting on or before this day (default: 31 December this year). */
  to?: string;
  divisionId?: number;
  departmentId?: number;
  q?: string;
  type?: TrainingType;
  /** Staff hours only: those with completed training in the period, or those without. */
  show?: "trained" | "untrained";
  page?: number;
};

export const AUDIT_PAGE_SIZE = 100;

function scopes(user: SessionUser) {
  ensure(user, "report.view");
  const staff = reportStaffScope(user);
  const department = reportDepartmentScope(user);
  if (!staff || !department) throw new UserError("You don't have access to do that.");
  return { staff, department };
}

const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** Trainings that start within the period. */
export const startsIn = (period: { from: string; to: string }): Prisma.TrainingWhereInput => ({ startDate: { gte: day(period.from), lte: day(period.to) } });

/** The user's staff, narrowed by the division, department and search filters. */
export function staffWhere(user: SessionUser, f: ReportFilters, search = true): Prisma.StaffWhereInput {
  const and: Prisma.StaffWhereInput[] = [scopes(user).staff];
  if (f.departmentId) and.push({ departmentId: f.departmentId });
  if (f.divisionId) and.push({ department: { divisionId: f.divisionId } });
  const q = search ? f.q?.trim() : undefined;
  if (q) and.push({ OR: [{ name: { contains: q } }, { staffNo: { contains: q } }] });
  return { AND: and };
}

export const hoursSelect = {
  startDate: true,
  endDate: true,
  startTime: true,
  endTime: true,
  status: true,
  sessions: { select: { date: true, startTime: true, endTime: true } },
} satisfies Prisma.TrainingSelect;

/** Departments (with their divisions) the user's reports cover, for the filters. */
export async function reportDepartments(user: SessionUser) {
  return db.department.findMany({
    where: scopes(user).department,
    orderBy: [{ division: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, shortName: true, division: { select: { id: true, name: true } }, hod: { select: { name: true } } },
  });
}

// ---------- Staff hours ----------

async function staffRows(user: SessionUser, f: ReportFilters, period: { from: string; to: string }, search: boolean) {
  const where = staffWhere(user, f, search);
  const [staff, done] = await Promise.all([
    db.staff.findMany({
      where,
      orderBy: [{ department: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        staffNo: true,
        name: true,
        designation: true,
        status: true,
        departmentId: true,
        department: { select: { name: true, division: { select: { id: true, name: true } } } },
        section: { select: { name: true } },
      },
    }),
    db.participant.findMany({
      where: { attendance: "COMPLETED", staff: where, training: { status: "SCHEDULED", ...startsIn(period) } },
      select: { staffId: true, training: { select: hoursSelect } },
    }),
  ]);
  const totals = staffTotals(done.map((p) => ({ staffId: p.staffId, hours: trainingHours(p.training) ?? 0 })));
  return staff.filter((s) => inStaffReport(s, totals.get(s.id))).map((s) => ({ ...s, ...(totals.get(s.id) ?? { completed: 0, hours: 0 }) }));
}

/** Each staff member's completed trainings and hours in the period. */
export async function staffHoursReport(user: SessionUser, f: ReportFilters, today: Date) {
  const period = reportPeriod(f.from, f.to, today);
  const all = await staffRows(user, f, period, true);
  const rows = all
    .filter((r) => !f.show || (f.show === "trained") === r.completed > 0)
    // Most hours first, so who has trained is at the top and who hasn't is together below, by department.
    .sort((a, b) => b.hours - a.hours || b.completed - a.completed);
  return {
    period,
    rows,
    total: {
      staff: rows.length,
      trained: rows.filter((r) => r.completed > 0).length,
      completed: rows.reduce((a, r) => a + r.completed, 0),
      hours: round2(rows.reduce((a, r) => a + r.hours, 0)),
    },
  };
}

// ---------- Department hours ----------

/** Each department's headcount, hours and average hours per head in the period. */
export async function departmentHoursReport(user: SessionUser, f: ReportFilters, today: Date) {
  const period = reportPeriod(f.from, f.to, today);
  const [departments, staff] = await Promise.all([reportDepartments(user), staffRows(user, { divisionId: f.divisionId }, period, false)]);
  const totals = departmentTotals(staff);
  const rows = departments
    .filter((d) => !f.divisionId || d.division.id === f.divisionId)
    .map((d) => ({ ...d, ...(totals.get(d.id) ?? { headcount: 0, trained: 0, completed: 0, hours: 0, average: null }) }));
  return { period, rows, total: grandTotal(rows) };
}

// ---------- Training attendance ----------

const attendanceCounts = (people: { attendance: string }[]) => ({
  total: people.length,
  completed: people.filter((p) => p.attendance === "COMPLETED").length,
  pending: people.filter((p) => p.attendance === "PENDING").length,
  absent: people.filter((p) => p.attendance === "ABSENT").length,
});

/**
 * Each training that started in the period, with how the user's staff did on
 * it. L&D see every training; a HOD or division head sees those with at least
 * one of their staff, and counts only their staff.
 */
export async function trainingAttendanceReport(user: SessionUser, f: ReportFilters, today: Date) {
  const period = reportPeriod(f.from, f.to, today);
  const staff = staffWhere(user, f, false);
  const q = f.q?.trim();
  const narrowed = !isAdmin(user) || !!f.departmentId || !!f.divisionId;
  const trainings = await db.training.findMany({
    where: {
      ...startsIn(period),
      ...(f.type ? { type: f.type } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { trainingCode: { contains: q } }] } : {}),
      ...(narrowed ? { participants: { some: { staff } } } : {}),
    },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take: 2000,
    select: {
      id: true,
      trainingCode: true,
      title: true,
      type: true,
      certificateFile: true,
      ...hoursSelect,
      participants: { where: { staff }, select: { attendance: true } },
    },
  });
  const rows = trainings.map(({ participants, certificateFile, ...t }) => {
    const hours = trainingHours(t);
    const counts = attendanceCounts(participants);
    return {
      ...t,
      hours,
      phase: trainingPhase(t, today),
      ...counts,
      manHours: manHours({ hours, completedCount: counts.completed, status: t.status }),
      hasCertificate: certificateFile !== null,
    };
  });
  const sum = (key: "total" | "completed" | "pending" | "absent" | "manHours") => round2(rows.reduce((a, r) => a + r[key], 0));
  return {
    period,
    rows,
    total: {
      trainings: rows.length,
      total: sum("total"),
      completed: sum("completed"),
      pending: sum("pending"),
      absent: sum("absent"),
      manHours: sum("manHours"),
    },
  };
}

/** One training's participants (the user's staff only), with attendance and hours. Null when there's nothing for them to see. */
export async function trainingAttendanceDetail(user: SessionUser, trainingId: number, today: Date) {
  const { staff } = scopes(user);
  const training = await db.training.findUnique({
    where: { id: trainingId },
    select: {
      id: true,
      trainingCode: true,
      title: true,
      type: true,
      venue: true,
      trainerName: true,
      certificateFile: true,
      ...hoursSelect,
      participants: {
        where: { staff },
        orderBy: [{ staff: { name: "asc" } }, { id: "asc" }],
        select: {
          id: true,
          attendance: true,
          attendanceReason: true,
          submittedAt: true,
          pme: { select: { id: true, status: true, periodEnd: true } },
          staff: {
            select: { id: true, staffNo: true, name: true, designation: true, department: { select: { name: true } }, section: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!training || (!isAdmin(user) && !training.participants.length)) return null;
  const { participants, certificateFile, ...t } = training;
  const hours = trainingHours(t) ?? 0;
  const rows = participants.map((p) => ({
    ...p,
    hours: countsTowardHours({ attendance: p.attendance, training: t }) ? hours : 0,
    /** Where their PME stands, when they have one (executives and managers, once completed). */
    pme: p.pme ? { id: p.pme.id, stage: pmeStage(p.pme, today) } : null,
  }));
  return {
    training: { ...t, hours, phase: trainingPhase(t, today), hasCertificate: certificateFile !== null },
    rows,
    total: { ...attendanceCounts(rows), hours: round2(rows.reduce((a, r) => a + r.hours, 0)) },
  };
}

// ---------- Audit report ----------

function auditWhere(user: SessionUser, f: ReportFilters, period: { from: string; to: string }): Prisma.ParticipantWhereInput {
  const q = f.q?.trim();
  return {
    staff: staffWhere(user, f, false),
    training: { ...startsIn(period), ...(f.type ? { type: f.type } : {}) },
    ...(q
      ? {
          OR: [
            { training: { title: { contains: q } } },
            { training: { trainingCode: { contains: q } } },
            { staff: { name: { contains: q } } },
            { staff: { staffNo: { contains: q } } },
          ],
        }
      : {}),
  };
}

const auditOrder: Prisma.ParticipantOrderByWithRelationInput[] = [
  { training: { startDate: "asc" } },
  { trainingId: "asc" },
  { staff: { name: "asc" } },
  { id: "asc" },
];

const auditSelect = {
  id: true,
  attendance: true,
  attendanceReason: true,
  submittedAt: true,
  // The answers and the gender are for the export: the old audit reports listed them.
  feedback: true,
  feedbackVersion: true,
  staff: { select: { id: true, staffNo: true, name: true, gender: true, designation: true, department: { select: { name: true } } } },
  training: { select: { id: true, trainingCode: true, title: true, type: true, venue: true, program: true, trainerName: true, certificateFile: true, ...hoursSelect } },
} satisfies Prisma.ParticipantSelect;

function auditRow(p: Prisma.ParticipantGetPayload<{ select: typeof auditSelect }>, today: Date) {
  const { certificateFile, ...training } = p.training;
  const counts = countsTowardHours(p);
  return {
    ...p,
    training: { ...training, phase: trainingPhase(training, today) },
    /** Hours on the person's record from this training: its hours when completed and not cancelled. */
    hours: counts ? (trainingHours(training) ?? 0) : 0,
    /** The training has a certificate and this person completed it. */
    certificate: certificateFile !== null && p.attendance === "COMPLETED",
  };
}

/** One line per person per training that started in the period: what an ISO audit asks for. */
export async function auditReport(user: SessionUser, f: ReportFilters, today: Date) {
  const period = reportPeriod(f.from, f.to, today);
  const where = auditWhere(user, f, period);
  const page = Math.max(1, f.page ?? 1);
  const [rows, total, trainings] = await Promise.all([
    db.participant.findMany({ where, orderBy: auditOrder, skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE, select: auditSelect }),
    db.participant.count({ where }),
    db.participant.findMany({ where, distinct: ["trainingId"], select: { trainingId: true } }),
  ]);
  return {
    period,
    rows: rows.map((p) => auditRow(p, today)),
    total,
    trainings: trainings.length,
    page,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

/** Every line the filters match, for the Excel export. */
export async function auditReportForExport(user: SessionUser, f: ReportFilters, today: Date) {
  const period = reportPeriod(f.from, f.to, today);
  const rows = await db.participant.findMany({ where: auditWhere(user, f, period), orderBy: auditOrder, take: 50_000, select: auditSelect });
  return { period, rows: rows.map((p) => auditRow(p, today)) };
}

// ---------- One person's history (the staff record) ----------

/**
 * Every training a staff member has been on, latest first, and their hours per
 * year. For whoever may open that person's record (staffViewScope); null otherwise.
 */
export async function staffTrainingHistory(user: SessionUser, staffId: number, today: Date) {
  const scope = staffViewScope(user);
  if (!scope) return null;
  const person = await db.staff.findFirst({ where: { AND: [{ id: staffId }, scope] }, select: { id: true } });
  if (!person) return null;
  const participants = await db.participant.findMany({
    where: { staffId },
    orderBy: [{ training: { startDate: "desc" } }, { id: "desc" }],
    select: {
      id: true,
      attendance: true,
      attendanceReason: true,
      training: { select: { id: true, trainingCode: true, title: true, type: true, ...hoursSelect } },
    },
  });
  const rows = participants.map((p) => {
    const counts = countsTowardHours(p);
    return { ...p, counts, hours: counts ? (trainingHours(p.training) ?? 0) : 0, phase: trainingPhase(p.training, today) };
  });
  const counted = rows.filter((r) => r.counts);
  return {
    rows,
    years: hoursByYear(counted.map((r) => ({ year: r.training.startDate.getUTCFullYear(), hours: r.hours }))),
    total: { completed: counted.length, hours: round2(counted.reduce((a, r) => a + r.hours, 0)) },
  };
}
