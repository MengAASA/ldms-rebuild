import "server-only";
import type { Prisma } from "@prisma/client";
import { parseSkillContent, skillContentProblems, type SkillContent, type SkillProblem } from "@/lib/forms/skill";
import { plural } from "@/lib/format";
import { db } from "../db";
import { UserError } from "../errors";
import type { SessionUser } from "../permissions";
import {
  quarterLabel,
  SKILL_ACTIONS,
  SKILL_DESIGNATIONS,
  skillActionBlock,
  skillDepartmentScope,
  skillEvaluatorDepartments,
  skillOpenQuarter,
  skillStaffScope,
  skillStage,
  skillStartBlock,
  skillMatrixScores,
  skillTopicKey,
  skillTopicScore,
  skillViewer,
  type Quarter,
  type SkillAction,
  type SkillStage,
} from "../rules/skill";
import { skillNotification } from "../rules/notification";
import { recordAudit } from "./audit";
import { forgetNotifications, notify } from "./notification";

// Skill matrix: one per non-executive or contract staff member per quarter
// (see rules/skill.ts for who fills it in, who approves, and when a quarter
// is open). A matrix outside the user's scope is treated as not found.
//
// Audit entries use entity "SkillEvaluation" with the matrix's id. The topics
// and lines themselves aren't diffed into the log: the entry says what
// happened and how many topics the matrix has.

export const MAX_SKILL_REASON = 255;
export const SKILL_PAGE_SIZE = 100;

const who = (s: { name: string; staffNo: string }) => `${s.name} (${s.staffNo})`;
const noAccess = () => new UserError("You don't have access to skill matrices.");
const gone = () => new UserError("This skill matrix no longer exists.");

function scopeOf(user: SessionUser): Prisma.StaffWhereInput {
  const scope = skillStaffScope(user);
  if (!scope) throw noAccess();
  return scope;
}

const staffSelect = {
  id: true,
  staffNo: true,
  name: true,
  position: true,
  designation: true,
  status: true,
  jobGrade: true,
  departmentId: true,
  department: { select: { name: true, hod: { select: { id: true, name: true, status: true } } } },
  section: { select: { name: true } },
} satisfies Prisma.StaffSelect;

const matrixSelect = {
  id: true,
  year: true,
  quarter: true,
  status: true,
  submittedAt: true,
  approvedAt: true,
  returnReason: true,
  returnedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true, staffNo: true } },
  approvedBy: { select: { name: true, staffNo: true } },
  copiedFrom: { select: { id: true, year: true, quarter: true, staff: { select: { name: true } } } },
  staff: { select: staffSelect },
  topics: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, section: true, name: true, items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { text: true, rating: true } } },
  },
} satisfies Prisma.SkillEvaluationSelect;

type MatrixRow = Prisma.SkillEvaluationGetPayload<{ select: typeof matrixSelect }>;

/** A matrix with what the pages need worked out: where it stands, its scores, and what this user can do. */
function view(m: MatrixRow, user: SessionUser, today: Date) {
  const viewer = skillViewer(user, m.staff);
  const state = { year: m.year, quarter: m.quarter, status: m.status, staff: m.staff };
  const hod = m.staff.department.hod;
  return {
    ...m,
    stage: skillStage(m),
    /** The HOD who approves, today. Null when the department has no active HOD. */
    approver: hod && hod.status === "ACTIVE" ? { id: hod.id, name: hod.name } : null,
    topics: m.topics.map((t) => ({ ...t, score: skillTopicScore(t.items) })),
    content: m.topics.map((t) => ({ section: t.section, name: t.name, items: t.items })) as SkillContent,
    viewer,
    /** Why this user can't take each step, or null when they can. */
    blocked: Object.fromEntries(SKILL_ACTIONS.map((a) => [a, skillActionBlock(a, state, viewer, today)])) as Record<SkillAction, string | null>,
  };
}

export type SkillMatrixView = ReturnType<typeof view>;

// ---------- The list: a department's staff and their matrix for a quarter ----------

export type SkillFilters = { q?: string; departmentId?: number; stage?: SkillStage; page?: number };

/** Staff who can have a matrix in the quarter: active, or with one already on record for it. */
function listWhere(user: SessionUser, quarter: Quarter, f: SkillFilters): Prisma.StaffWhereInput {
  const inQuarter = { year: quarter.year, quarter: quarter.quarter };
  const q = f.q?.trim();
  const and: Prisma.StaffWhereInput[] = [
    scopeOf(user),
    { designation: { in: [...SKILL_DESIGNATIONS] } },
    { OR: [{ status: "ACTIVE" }, { skillEvaluations: { some: inQuarter } }] },
  ];
  if (f.departmentId) and.push({ departmentId: f.departmentId });
  if (q) and.push({ OR: [{ name: { contains: q } }, { staffNo: { contains: q } }] });
  if (f.stage === "NOT_STARTED") and.push({ status: "ACTIVE", skillEvaluations: { none: inQuarter } });
  else if (f.stage === "DRAFT") and.push({ skillEvaluations: { some: { ...inQuarter, status: "DRAFT", returnReason: null } } });
  else if (f.stage === "RETURNED") and.push({ skillEvaluations: { some: { ...inQuarter, status: "DRAFT", returnReason: { not: null } } } });
  else if (f.stage) and.push({ skillEvaluations: { some: { ...inQuarter, status: f.stage } } });
  return { AND: and };
}

/** The user's staff with each one's matrix for the quarter (or none yet), by department then name, a page at a time. */
export async function skillList(user: SessionUser, quarter: Quarter, f: SkillFilters, today: Date) {
  const where = listWhere(user, quarter, f);
  const total = await db.staff.count({ where });
  const pages = Math.max(1, Math.ceil(total / SKILL_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  const staff = await db.staff.findMany({
    where,
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
    skip: (page - 1) * SKILL_PAGE_SIZE,
    take: SKILL_PAGE_SIZE,
    select: {
      ...staffSelect,
      skillEvaluations: {
        where: { year: quarter.year, quarter: quarter.quarter },
        select: { id: true, status: true, returnReason: true, updatedAt: true, createdBy: { select: { name: true } }, _count: { select: { topics: true } } },
      },
    },
  });
  const rows = staff.map(({ skillEvaluations, ...s }) => {
    const matrix = skillEvaluations[0] ?? null;
    const viewer = skillViewer(user, s);
    return {
      staff: s,
      matrix,
      stage: skillStage(matrix),
      viewer,
      /** Why the user can't start this person's matrix, or null when they can. */
      startBlock: skillStartBlock(s, viewer, matrix !== null, quarter, today),
      canEdit: matrix !== null && skillActionBlock("EDIT", { ...quarter, status: matrix.status, staff: s }, viewer, today) === null,
      canApprove: matrix !== null && skillActionBlock("APPROVE", { ...quarter, status: matrix.status, staff: s }, viewer, today) === null,
    };
  });
  return { rows, total, page, pages };
}

/** How many of the user's staff stand at each stage in the quarter: the list's summary line. */
export async function skillStageCounts(user: SessionUser, quarter: Quarter, departmentId?: number): Promise<Record<SkillStage, number>> {
  const stages: SkillStage[] = ["NOT_STARTED", "DRAFT", "RETURNED", "SUBMITTED", "APPROVED"];
  const counts = await Promise.all(stages.map((stage) => db.staff.count({ where: listWhere(user, quarter, { stage, departmentId }) })));
  return Object.fromEntries(stages.map((s, i) => [s, counts[i]])) as Record<SkillStage, number>;
}

/** The departments the user's staff belong to, for the department filter and the chart. */
export async function skillDepartments(user: SessionUser) {
  const scope = skillDepartmentScope(user);
  if (!scope) return [];
  return db.department.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** The quarters the picker offers: the open one, and every earlier one with a matrix the user can see. Newest first. */
export async function skillQuarters(user: SessionUser, today: Date): Promise<Quarter[]> {
  const open = skillOpenQuarter(today);
  const found = await db.skillEvaluation.findMany({
    where: { staff: scopeOf(user) },
    distinct: ["year", "quarter"],
    select: { year: true, quarter: true },
  });
  const all = [open, ...found.filter((q) => !(q.year === open.year && q.quarter === open.quarter))];
  return all.sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}

// ---------- One matrix ----------

/** Whether the matrix is one of the user's staff's. */
async function inScope(user: SessionUser, staffId: number): Promise<boolean> {
  const scope = skillStaffScope(user);
  if (!scope) return false;
  return (await db.staff.count({ where: { AND: [{ id: staffId }, scope] } })) > 0;
}

/** One matrix, or null (also when it isn't one of the user's staff's). */
export async function getSkillMatrix(user: SessionUser, id: number, today: Date): Promise<SkillMatrixView | null> {
  const m = await db.skillEvaluation.findUnique({ where: { id }, select: matrixSelect });
  if (!m || !(await inScope(user, m.staff.id))) return null;
  return view(m, user, today);
}

/** The person a new matrix would be for, with why it can't be started (or null). Null when they aren't one of the user's staff. */
export async function skillStartFor(user: SessionUser, staffId: number, today: Date) {
  const quarter = skillOpenQuarter(today);
  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { ...staffSelect, skillEvaluations: { where: { year: quarter.year, quarter: quarter.quarter }, select: { id: true } } },
  });
  if (!staff || !(await inScope(user, staff.id))) return null;
  const { skillEvaluations, ...s } = staff;
  const existing = skillEvaluations[0]?.id ?? null;
  return { staff: s, quarter, existingId: existing, blocked: skillStartBlock(s, skillViewer(user, s), existing !== null, quarter, today) };
}

/** The matrices on record for one person, newest quarter first: their history on the staff record. Empty when the user can't see them. */
export async function staffSkillHistory(user: SessionUser, staffId: number) {
  if (!(await inScope(user, staffId))) return [];
  const rows = await db.skillEvaluation.findMany({
    where: { staffId },
    orderBy: [{ year: "desc" }, { quarter: "desc" }],
    select: {
      id: true,
      year: true,
      quarter: true,
      status: true,
      returnReason: true,
      approvedAt: true,
      createdBy: { select: { name: true } },
      topics: { select: { section: true, name: true, items: { select: { rating: true } } } },
    },
  });
  return rows.map(({ topics, ...m }) => {
    // The same average as the chart's.
    const scores = [...skillMatrixScores(topics).values()];
    return {
      ...m,
      stage: skillStage(m),
      topicCount: topics.length,
      average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  });
}

// ---------- Saving ----------

/** The content problems as a user error the form can place: each tied to its section or topic. */
export class SkillContentError extends UserError {
  constructor(public problems: SkillProblem[]) {
    // Each problem is shown in its place in the form, so the message at the top only points there.
    super("Check the highlighted sections and topics.");
  }
}

function checked(json: string, mode: "draft" | "submit"): SkillContent {
  const content = parseSkillContent(json);
  if (!content) throw new UserError("The form didn't arrive in one piece. Reload the page and try again.");
  const problems = skillContentProblems(content, mode);
  if (problems.length) throw new SkillContentError(problems);
  return content;
}

async function writeTopics(tx: Prisma.TransactionClient, evaluationId: number, content: SkillContent) {
  await tx.skillTopic.deleteMany({ where: { evaluationId } }); // lines cascade
  for (const [i, t] of content.entries()) {
    await tx.skillTopic.create({
      data: {
        evaluationId,
        section: t.section,
        name: t.name,
        sortOrder: i,
        items: { create: t.items.map((line, j) => ({ text: line.text, rating: line.rating, sortOrder: j })) },
      },
    });
  }
}

const sent = (mode: "draft" | "submit") =>
  mode === "submit" ? { status: "SUBMITTED" as const, submittedAt: new Date(), returnReason: null, returnedAt: null } : {};

/** Starts a person's matrix for the open quarter, as a draft or sent straight to the HOD. Returns its id. */
export async function createSkillMatrix(user: SessionUser, staffId: number, json: string, mode: "draft" | "submit", today: Date): Promise<number> {
  const content = checked(json, mode);
  const quarter = skillOpenQuarter(today);
  return db.$transaction(async (tx) => {
    const staff = await tx.staff.findUnique({
      where: { id: staffId },
      select: { ...staffSelect, skillEvaluations: { where: { year: quarter.year, quarter: quarter.quarter }, select: { id: true } } },
    });
    if (!staff) throw new UserError("That staff member is no longer in the staff list.");
    const blocked = skillStartBlock(staff, skillViewer(user, staff), staff.skillEvaluations.length > 0, quarter, today);
    if (blocked) throw new UserError(blocked);
    const m = await tx.skillEvaluation.create({ data: { staffId, ...quarter, createdById: user.id, ...sent(mode) } });
    await writeTopics(tx, m.id, content);
    await recordAudit(tx, {
      actorId: user.id,
      action: "CREATE",
      entity: "SkillEvaluation",
      entityId: m.id,
      summary: `${mode === "submit" ? "Submitted" : "Started"} ${who(staff)}'s skill matrix for ${quarterLabel(quarter)}`,
      changes: { topics: [null, content.length] },
    });
    return m.id;
  });
}

/** Loads a matrix inside a transaction and checks the user may take this step. */
async function forStep(tx: Prisma.TransactionClient, user: SessionUser, id: number, action: SkillAction, today: Date) {
  const m = await tx.skillEvaluation.findUnique({ where: { id }, select: matrixSelect });
  if (!m || !(await inScope(user, m.staff.id))) throw gone();
  const v = view(m, user, today);
  if (v.blocked[action]) throw new UserError(v.blocked[action]);
  return v;
}

/** Saves the form again for a draft (or one sent back): kept as a draft, or sent to the HOD. */
export async function updateSkillMatrix(user: SessionUser, id: number, json: string, mode: "draft" | "submit", today: Date) {
  const content = checked(json, mode);
  return db.$transaction(async (tx) => {
    const m = await forStep(tx, user, id, mode === "submit" ? "SUBMIT" : "EDIT", today);
    await tx.skillEvaluation.update({ where: { id }, data: sent(mode) });
    await writeTopics(tx, id, content);
    await recordAudit(tx, {
      actorId: user.id,
      action: "UPDATE",
      entity: "SkillEvaluation",
      entityId: id,
      summary: `${mode === "submit" ? (m.returnReason ? "Submitted again" : "Submitted") : "Updated"} ${who(m.staff)}'s skill matrix for ${quarterLabel(m)}`,
      changes: {
        ...(mode === "submit" ? { status: ["DRAFT", "SUBMITTED"] as [unknown, unknown] } : {}),
        ...(m.topics.length !== content.length ? { topics: [m.topics.length, content.length] as [unknown, unknown] } : {}),
      },
    });
  });
}

/** Sends a draft to the HOD as it stands, from its page. It must be complete. */
export async function submitSkillMatrix(user: SessionUser, id: number, today: Date) {
  return db.$transaction(async (tx) => {
    const m = await forStep(tx, user, id, "SUBMIT", today);
    const problems = skillContentProblems(m.content, "submit");
    if (problems.length) throw new UserError(`This matrix isn't complete yet: ${problems[0].message.replace(/\.$/, "")}. Open Edit to finish it.`);
    await tx.skillEvaluation.update({ where: { id }, data: sent("submit") });
    await recordAudit(tx, {
      actorId: user.id,
      action: "UPDATE",
      entity: "SkillEvaluation",
      entityId: id,
      summary: `${m.returnReason ? "Submitted again" : "Submitted"} ${who(m.staff)}'s skill matrix for ${quarterLabel(m)}`,
      changes: { status: ["DRAFT", "SUBMITTED"] },
    });
  });
}

/** Deletes a draft, e.g. one duplicated to the wrong person. */
export async function deleteSkillMatrix(user: SessionUser, id: number, today: Date) {
  return db.$transaction(async (tx) => {
    const m = await forStep(tx, user, id, "DELETE", today);
    await tx.skillEvaluation.delete({ where: { id } }); // topics and lines cascade
    await forgetNotifications(tx, "SkillEvaluation", [id]);
    await recordAudit(tx, {
      actorId: user.id,
      action: "DELETE",
      entity: "SkillEvaluation",
      entityId: id,
      summary: `Deleted the draft of ${who(m.staff)}'s skill matrix for ${quarterLabel(m)}`,
    });
    return { year: m.year, quarter: m.quarter };
  });
}

// ---------- The HOD's steps ----------

export type ApproveResult = { approved: number; skipped: string[] };

/** Approves one or more matrices. Those the user can't approve are skipped with the reason; if none can be, the first reason is the error. */
export async function approveSkillMatrices(user: SessionUser, ids: number[], today: Date): Promise<ApproveResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.skillEvaluation.findMany({ where: { id: { in: ids } }, select: matrixSelect, orderBy: { id: "asc" } });
    const skipped: string[] = [];
    if (rows.length < ids.length) skipped.push(`${plural(ids.length - rows.length, "matrix", "matrices")} no longer on record.`);
    const approving = rows
      .map((m) => view(m, user, today))
      .filter((m) => {
        if (m.blocked.APPROVE) skipped.push(m.blocked.APPROVE);
        return !m.blocked.APPROVE;
      });
    if (!approving.length) throw new UserError(skipped[0] ?? "Nothing to approve.");
    const now = new Date();
    await tx.skillEvaluation.updateMany({
      where: { id: { in: approving.map((m) => m.id) } },
      data: { status: "APPROVED", approvedById: user.id, approvedAt: now },
    });
    for (const m of approving)
      await recordAudit(tx, {
        actorId: user.id,
        action: "UPDATE",
        entity: "SkillEvaluation",
        entityId: m.id,
        summary: `Approved ${who(m.staff)}'s skill matrix for ${quarterLabel(m)}`,
        changes: { status: ["SUBMITTED", "APPROVED"] },
      });
    // Whoever filled each one in is told.
    await notify(
      tx,
      user.id,
      approving.map((m) =>
        skillNotification("skill.approved", { id: m.id, staffName: m.staff.name, quarter: quarterLabel(m), evaluatorId: m.createdBy?.id ?? null }, user.name),
      ),
    );
    return { approved: approving.length, skipped };
  });
}

/** The HOD sends a matrix back to the evaluator, who changes it and submits again. */
export async function sendBackSkillMatrix(user: SessionUser, id: number, reason: string, today: Date) {
  if (!reason) throw new UserError("Check the highlighted fields.", { reason: ["Say what needs changing"] });
  if (reason.length > MAX_SKILL_REASON) throw new UserError("Check the highlighted fields.", { reason: [`At most ${MAX_SKILL_REASON} characters`] });
  return db.$transaction(async (tx) => {
    const m = await forStep(tx, user, id, "SEND_BACK", today);
    await tx.skillEvaluation.update({ where: { id }, data: { status: "DRAFT", returnReason: reason, returnedAt: new Date() } });
    await recordAudit(tx, {
      actorId: user.id,
      action: "UPDATE",
      entity: "SkillEvaluation",
      entityId: id,
      summary: `Sent ${who(m.staff)}'s skill matrix for ${quarterLabel(m)} back to the evaluator`,
      changes: { status: ["SUBMITTED", "DRAFT"], reason: [null, reason] },
    });
    await notify(tx, user.id, [
      skillNotification("skill.returned", { id: m.id, staffName: m.staff.name, quarter: quarterLabel(m), evaluatorId: m.createdBy?.id ?? null }, user.name),
    ]);
  });
}

// ---------- Duplicating ----------

/**
 * Who a matrix can be duplicated to: staff in its department the user fills
 * in matrices for, who have none yet in the open quarter. That includes the
 * same person, when the matrix is from an earlier quarter.
 */
export async function duplicateTargets(user: SessionUser, sourceId: number, today: Date) {
  const source = await getSkillMatrix(user, sourceId, today);
  if (!source) return null;
  const open = skillOpenQuarter(today);
  const staff = await db.staff.findMany({
    where: {
      departmentId: source.staff.departmentId,
      status: "ACTIVE",
      designation: { in: [...SKILL_DESIGNATIONS] },
      skillEvaluations: { none: { year: open.year, quarter: open.quarter } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, staffNo: true, name: true, position: true, status: true, designation: true, departmentId: true },
  });
  return {
    open,
    targets: staff
      .filter((s) => skillStartBlock(s, skillViewer(user, s), false, open, today) === null)
      .map((s) => ({ id: s.id, staffNo: s.staffNo, name: s.name, position: s.position })),
  };
}

export type DuplicateResult = { created: number; skipped: string[]; firstId: number | null };

/** Copies a matrix's topics, lines and ratings to other staff as drafts in the open quarter, as a starting point. */
export async function duplicateSkillMatrix(user: SessionUser, sourceId: number, staffIds: number[], today: Date): Promise<DuplicateResult> {
  const open = skillOpenQuarter(today);
  return db.$transaction(
    async (tx) => {
      const source = await tx.skillEvaluation.findUnique({ where: { id: sourceId }, select: matrixSelect });
      if (!source || !(await inScope(user, source.staff.id))) throw gone();
      if (!source.topics.length) throw new UserError("This matrix has no topics to copy.");
      const content = source.topics.map((t) => ({ section: t.section, name: t.name, items: t.items }));
      const staff = await tx.staff.findMany({
        where: { id: { in: staffIds } },
        orderBy: { name: "asc" },
        select: { ...staffSelect, skillEvaluations: { where: { year: open.year, quarter: open.quarter }, select: { id: true } } },
      });
      const skipped: string[] = [];
      const made: number[] = [];
      for (const s of staff) {
        const blocked = skillStartBlock(s, skillViewer(user, s), s.skillEvaluations.length > 0, open, today);
        if (blocked) {
          skipped.push(blocked);
          continue;
        }
        const m = await tx.skillEvaluation.create({ data: { staffId: s.id, ...open, createdById: user.id, copiedFromId: source.id } });
        await writeTopics(tx, m.id, content);
        await recordAudit(tx, {
          actorId: user.id,
          action: "CREATE",
          entity: "SkillEvaluation",
          entityId: m.id,
          summary: `Started ${who(s)}'s skill matrix for ${quarterLabel(open)} as a copy of ${source.staff.name}'s ${quarterLabel(source)}`,
          changes: { topics: [null, content.length] },
        });
        made.push(m.id);
      }
      if (!made.length) throw new UserError(skipped[0] ?? "Choose at least one staff member.");
      return { created: made.length, skipped, firstId: made[0] };
    },
    { timeout: 30_000 },
  );
}

// ---------- What is waiting ----------

/**
 * What is waiting on the signed-in person:
 *  - toApprove: submitted matrices of their departments' staff, any quarter, the longest-waiting first (HODs)
 *  - returned: matrices they filled in that the HOD sent back, in the open quarter
 */
export async function skillWaiting(user: SessionUser, today: Date) {
  const open = skillOpenQuarter(today);
  const fills = skillEvaluatorDepartments(user);
  const [approve, returned] = await Promise.all([
    user.hodOfDepartmentIds.length
      ? db.skillEvaluation.findMany({
          where: { status: "SUBMITTED", staff: { departmentId: { in: user.hodOfDepartmentIds } } },
          orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            year: true,
            quarter: true,
            submittedAt: true,
            createdBy: { select: { name: true } },
            staff: { select: { id: true, staffNo: true, name: true, position: true, department: { select: { name: true } } } },
            _count: { select: { topics: true } },
          },
        })
      : [],
    fills === "ALL" || fills.length
      ? db.skillEvaluation.count({ where: { status: "DRAFT", returnReason: { not: null }, createdById: user.id, year: open.year, quarter: open.quarter } })
      : 0,
  ]);
  return { toApprove: approve.map((m) => ({ ...m, closed: !(m.year === open.year && m.quarter === open.quarter) })), returned, open };
}

export type SkillWaiting = Awaited<ReturnType<typeof skillWaiting>>;

// ---------- The matrix chart ----------

/**
 * A department's matrices for a quarter as a grid: staff down the side, the
 * topics across (grouped by section), each cell the topic's score. Submitted
 * and approved matrices only; drafts aren't shown. Null when the department
 * isn't one the user can see.
 */
export async function skillChart(user: SessionUser, departmentId: number, quarter: Quarter) {
  const scope = skillDepartmentScope(user);
  if (!scope) throw noAccess();
  const department = await db.department.findFirst({ where: { AND: [{ id: departmentId }, scope] }, select: { id: true, name: true } });
  if (!department) return null;
  const matrices = await db.skillEvaluation.findMany({
    where: { year: quarter.year, quarter: quarter.quarter, status: { in: ["SUBMITTED", "APPROVED"] }, staff: { departmentId } },
    orderBy: [{ staff: { name: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      approvedAt: true,
      staff: { select: { id: true, staffNo: true, name: true, position: true, designation: true, jobGrade: true, section: { select: { name: true } } } },
      topics: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { section: true, name: true, items: { select: { rating: true } } } },
    },
  });

  // Topics are typed in, so the same one may differ in case or spacing between people: match on a tidied key.
  const columns: { key: string; section: (typeof matrices)[number]["topics"][number]["section"]; name: string }[] = [];
  const seen = new Set<string>();
  for (const section of ["KNOWLEDGE", "SKILL", "ABILITY"] as const)
    for (const m of matrices)
      for (const t of m.topics) {
        const k = skillTopicKey(t.section, t.name);
        if (t.section === section && !seen.has(k)) {
          seen.add(k);
          columns.push({ key: k, section, name: t.name });
        }
      }

  const rows = matrices.map((m) => {
    const scores = skillMatrixScores(m.topics);
    const all = [...scores.values()];
    return {
      id: m.id,
      status: m.status,
      staff: m.staff,
      evaluatedBy: m.createdBy?.name ?? null,
      approvedBy: m.approvedBy?.name ?? null,
      scores: columns.map((c) => scores.get(c.key) ?? null),
      average: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null,
    };
  });
  return { department, quarter, columns, rows };
}

/** The latest audit entries for one matrix. */
export async function skillHistory(id: number) {
  return db.auditLog.findMany({
    where: { entity: "SkillEvaluation", entityId: String(id) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 25,
    include: { actor: { select: { name: true } } },
  });
}
