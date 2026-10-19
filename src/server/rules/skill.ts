// Skill matrix rules. Pure functions: the skill matrix service enforces them
// and the pages use the same ones to say what each person can do and why not.
//
// One matrix per non-executive or contract staff member per quarter, filled in
// by an evaluator in their department and approved by its HOD.
//
//   DRAFT       being filled in, or sent back by the HOD
//   SUBMITTED   waiting for the HOD, who approves it or sends it back
//   APPROVED    locked
//
// The quarter being filled in is the one that has just ended ("the open
// quarter"): on 6 Oct 2026 that is Q3 2026, and Q4 2026 opens on 1 Jan 2027.
// When the next quarter opens, the earlier one closes: no new matrix, no
// edit, no submit and no send-back. A matrix already submitted stays with the
// HOD, who can still approve it. Any quarter can be viewed, and its matrices
// duplicated into the open one.
//
// Decisions 8 to 10 in docs/phase-3-plan.md §3, and module 2 in §8.

import type { Designation, Prisma, SkillStatus, StaffStatus } from "@prisma/client";
import type { SkillLine } from "@/lib/forms/skill";
import { formatDate } from "@/lib/format";
import { isAdmin, isDivisionHead, isHod, type SessionUser } from "../permissions";

// ---------- Quarters ----------

export type Quarter = { year: number; quarter: number };

export const quarterLabel = (q: Quarter) => `Q${q.quarter} ${q.year}`;
export const sameQuarter = (a: Quarter, b: Quarter) => a.year === b.year && a.quarter === b.quarter;
const order = (q: Quarter) => q.year * 4 + (q.quarter - 1);
const fromOrder = (n: number): Quarter => ({ year: Math.floor(n / 4), quarter: (n % 4) + 1 });
export const nextQuarter = (q: Quarter) => fromOrder(order(q) + 1);
export const previousQuarter = (q: Quarter) => fromOrder(order(q) - 1);

/** The calendar quarter a day falls in. */
export const quarterOf = (day: Date): Quarter => ({ year: day.getUTCFullYear(), quarter: Math.floor(day.getUTCMonth() / 3) + 1 });

/** First and last day of a quarter. */
export function quarterDates(q: Quarter): { start: Date; end: Date } {
  const month = (q.quarter - 1) * 3;
  return { start: new Date(Date.UTC(q.year, month, 1)), end: new Date(Date.UTC(q.year, month + 3, 0)) };
}

/** "Jul to Sep 2026". */
export function quarterMonths(q: Quarter): string {
  const { start, end } = quarterDates(q);
  return `${formatDate(start).split(" ")[1]} to ${formatDate(end).split(" ")[1]} ${q.year}`;
}

/**
 * The quarter being filled in: the last one to have ended (today in Malaysia
 * time). 6 Oct 2026 → Q3 2026; 31 Dec 2026 → Q3 2026; 1 Jan 2027 → Q4 2026.
 */
export const skillOpenQuarter = (today: Date): Quarter => previousQuarter(quarterOf(today));

/** The last day a quarter can be filled in: the last day of the quarter after it. */
export const skillQuarterCloses = (q: Quarter): Date => quarterDates(nextQuarter(q)).end;

/** A quarter from the URL ("2026-3"), or null when it isn't one. */
export function parseQuarter(value: string | undefined): Quarter | null {
  const m = /^(\d{4})-([1-4])$/.exec(value ?? "");
  return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null;
}
export const quarterParam = (q: Quarter) => `${q.year}-${q.quarter}`;

/** Why a quarter can't take a new matrix, an edit or a submit, or null when it is the open one. */
export function skillQuarterBlock(q: Quarter, today: Date): string | null {
  const open = skillOpenQuarter(today);
  if (sameQuarter(q, open)) return null;
  if (order(q) > order(open)) {
    const opens = new Date(quarterDates(q).end.getTime() + 86_400_000);
    return `${quarterLabel(q)} hasn't ended yet. Its matrices are filled in from ${formatDate(opens)}.`;
  }
  return `${quarterLabel(q)} closed on ${formatDate(skillQuarterCloses(q))}, so its matrices can only be viewed. Duplicate one to carry it into ${quarterLabel(open)}.`;
}

// ---------- Who ----------

/** Skill matrices are for non-executive and contract staff. */
export const SKILL_DESIGNATIONS = ["NON_EXECUTIVE", "CONTRACT"] as const satisfies readonly Designation[];

/**
 * The departments whose staff the user may fill in matrices for. L&D: all.
 * In their own department: a manager, the main clerk, and anyone given the
 * Skill matrix evaluator role, unless they are that department's HOD (who
 * approves, so doesn't fill in). Empty: none.
 */
export function skillEvaluatorDepartments(user: SessionUser): "ALL" | number[] {
  if (isAdmin(user)) return "ALL";
  const named = user.designation === "MANAGER" || user.roles.includes("MAIN_CLERK") || user.roles.includes("SKILL_EVALUATOR");
  return named && !user.hodOfDepartmentIds.includes(user.departmentId) ? [user.departmentId] : [];
}

export const fillsInSkillMatrices = (user: SessionUser) => skillEvaluatorDepartments(user) === "ALL" || skillEvaluatorDepartments(user).length > 0;

/**
 * Whose matrices the user may see. Evaluators: their department. HODs: their
 * departments (they approve these). Division heads: their divisions, to look
 * at. L&D: everyone. Null: no one.
 */
export function skillStaffScope(user: SessionUser): Prisma.StaffWhereInput | null {
  if (isAdmin(user)) return {};
  const or: Prisma.StaffWhereInput[] = [];
  const fills = skillEvaluatorDepartments(user) as number[];
  const departments = [...new Set([...fills, ...user.hodOfDepartmentIds])];
  if (departments.length) or.push({ departmentId: { in: departments } });
  if (isDivisionHead(user)) or.push({ department: { divisionId: { in: user.headOfDivisionIds } } });
  return or.length ? { OR: or } : null;
}

/** The departments those staff belong to: what the department filter offers. */
export function skillDepartmentScope(user: SessionUser): Prisma.DepartmentWhereInput | null {
  if (isAdmin(user)) return {};
  const or: Prisma.DepartmentWhereInput[] = [];
  const departments = [...new Set([...(skillEvaluatorDepartments(user) as number[]), ...user.hodOfDepartmentIds])];
  if (departments.length) or.push({ id: { in: departments } });
  if (isDivisionHead(user)) or.push({ divisionId: { in: user.headOfDivisionIds } });
  return or.length ? { OR: or } : null;
}

export const seesSkillMatrices = (user: SessionUser) => skillStaffScope(user) !== null;
/** HODs and L&D see the matrix chart; division heads too. Evaluators see it for their department. */
export const approvesSkillMatrices = (user: SessionUser) => isHod(user);

export type SkillSubject = { id: number; name: string; status: StaffStatus; designation: Designation; departmentId: number };

/** What the signed-in person is to a staff member's matrix. Both can't be true: a HOD doesn't fill in their own department's. */
export type SkillViewer = {
  /** May fill in this person's matrix. */
  canEvaluate: boolean;
  /** HOD of this person's department: approves or sends back. */
  isApprover: boolean;
};

export function skillViewer(user: SessionUser, staff: Pick<SkillSubject, "id" | "departmentId">): SkillViewer {
  const fills = skillEvaluatorDepartments(user);
  return {
    canEvaluate: staff.id !== user.id && (fills === "ALL" || fills.includes(staff.departmentId)),
    isApprover: user.hodOfDepartmentIds.includes(staff.departmentId),
  };
}

/** Why this person can't have a matrix, or null when they can. */
export function skillSubjectBlock(staff: Pick<SkillSubject, "name" | "status" | "designation">): string | null {
  if (staff.status !== "ACTIVE") return `${staff.name} has resigned.`;
  if (!(SKILL_DESIGNATIONS as readonly Designation[]).includes(staff.designation))
    return `Skill matrices are for non-executive and contract staff, and ${staff.name} is neither.`;
  return null;
}

/** Why the user can't start a matrix for this person in this quarter, or null when they can. */
export function skillStartBlock(staff: SkillSubject, viewer: SkillViewer, hasMatrix: boolean, q: Quarter, today: Date): string | null {
  if (!viewer.canEvaluate) return `You don't fill in skill matrices for ${staff.name}.`;
  const subject = skillSubjectBlock(staff);
  if (subject) return subject;
  const closed = skillQuarterBlock(q, today);
  if (closed) return closed;
  if (hasMatrix) return `${staff.name} already has a matrix for ${quarterLabel(q)}. There is one per person per quarter.`;
  return null;
}

// ---------- The steps ----------

export const SKILL_ACTIONS = ["EDIT", "SUBMIT", "DELETE", "APPROVE", "SEND_BACK"] as const;
export type SkillAction = (typeof SKILL_ACTIONS)[number];

export type SkillState = Quarter & { status: SkillStatus; staff: { name: string } };

/** Why the person can't take this step on a matrix, or null when they can. */
export function skillActionBlock(action: SkillAction, m: SkillState, viewer: SkillViewer, today: Date): string | null {
  const name = m.staff.name;
  const closed = skillQuarterBlock(m, today);
  switch (action) {
    case "EDIT":
    case "SUBMIT":
    case "DELETE":
      if (!viewer.canEvaluate) return `You don't fill in skill matrices for ${name}.`;
      if (m.status === "APPROVED") return "The HOD has approved this matrix, so it can't be changed.";
      if (m.status === "SUBMITTED")
        return action === "DELETE"
          ? "This matrix has been sent to the HOD, so it stays on record."
          : "This matrix is with the HOD for approval. It can be changed only if they send it back.";
      return closed;
    case "APPROVE":
      if (!viewer.isApprover) return `Only ${name}'s HOD can approve their matrix.`;
      if (m.status === "APPROVED") return "This matrix is already approved.";
      if (m.status === "DRAFT") return "This matrix hasn't been sent for approval yet.";
      // A closed quarter's matrix can still be approved: it waits for the HOD until it is.
      return null;
    case "SEND_BACK":
      if (!viewer.isApprover) return `Only ${name}'s HOD can send their matrix back.`;
      if (m.status === "APPROVED") return "This matrix is already approved.";
      if (m.status === "DRAFT") return "This matrix is already with the evaluator.";
      if (closed)
        return `${quarterLabel(m)} closed on ${formatDate(skillQuarterCloses(m))}, so the evaluator can no longer change this matrix. You can still approve it.`;
      return null;
  }
}

// ---------- Where a matrix stands ----------

export const SKILL_STAGES = ["NOT_STARTED", "DRAFT", "RETURNED", "SUBMITTED", "APPROVED"] as const;
export type SkillStage = (typeof SKILL_STAGES)[number];

export const SKILL_STAGE_LABELS: Record<SkillStage, string> = {
  NOT_STARTED: "Not started",
  DRAFT: "Draft",
  RETURNED: "Sent back",
  SUBMITTED: "Waiting for HOD",
  APPROVED: "Approved",
};
export const SKILL_STAGE_TONE: Record<SkillStage, "ok" | "wait" | "bad" | "na"> = {
  NOT_STARTED: "na",
  DRAFT: "na",
  RETURNED: "bad",
  SUBMITTED: "wait",
  APPROVED: "ok",
};

export function skillStage(m: { status: SkillStatus; returnReason: string | null } | null | undefined): SkillStage {
  if (!m) return "NOT_STARTED";
  if (m.status === "DRAFT") return m.returnReason ? "RETURNED" : "DRAFT";
  return m.status;
}

// ---------- Scores ----------

/** A topic's score: its ratings added up, over the most they could be, as a whole percentage. Null with nothing rated. */
export function skillTopicScore(items: Pick<SkillLine, "rating">[]): number | null {
  const rated = items.filter((i) => i.rating !== null);
  if (!rated.length) return null;
  return Math.round((rated.reduce((sum, i) => sum + i.rating!, 0) / (rated.length * 5)) * 100);
}

/** A topic as the chart matches it across people: its section and its name, ignoring case and spacing (topics are typed in). */
export const skillTopicKey = (section: string, name: string) => `${section}|${name.trim().toLowerCase().replace(/\s+/g, " ")}`;

/**
 * One matrix's scores for the chart, by topic key. A topic named twice in a
 * section counts once, its lines pooled, as the old chart did; a topic with
 * nothing rated has no score.
 */
export function skillMatrixScores(topics: { section: string; name: string; items: Pick<SkillLine, "rating">[] }[]): Map<string, number> {
  const pooled = new Map<string, Pick<SkillLine, "rating">[]>();
  for (const t of topics) {
    const k = skillTopicKey(t.section, t.name);
    pooled.set(k, [...(pooled.get(k) ?? []), ...t.items]);
  }
  const scores = new Map<string, number>();
  for (const [k, items] of pooled) {
    const score = skillTopicScore(items);
    if (score !== null) scores.set(k, score);
  }
  return scores;
}

/** The five levels the chart shows, highest first. `level` is the score it starts at. */
export const SKILL_LEVELS = [
  { level: 100, label: "Highly skilled", hint: "Able to supervise others" },
  { level: 75, label: "Competent", hint: "" },
  { level: 50, label: "Medium competency", hint: "" },
  { level: 25, label: "Novice", hint: "Basic knowledge" },
  { level: 0, label: "Minimal competency", hint: "" },
] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number]["level"];

/** The level a score falls in: 100, or 75 and above, 50 and above, 25 and above, or below that. */
export function skillLevel(score: number): SkillLevel {
  return SKILL_LEVELS.find((l) => score >= l.level)!.level;
}
