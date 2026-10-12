import "server-only";
import type { Designation, Prisma, RoleCode, StaffStatus } from "@prisma/client";
import { hash, verify } from "@node-rs/argon2";
import { db } from "../db";
import { UserError } from "../errors";
import {
  isAdmin,
  canManageStaffRecord,
  manageableDesignations,
  staffViewScope,
  type SessionUser,
} from "../permissions";
import { passwordProblems } from "../rules/password";
import type { StaffInput } from "@/lib/validation/staff";
import { DESIGNATION_LABELS } from "@/lib/validation/staff";
import { approverMap } from "./approver";
import { diffFields, recordAudit } from "./audit";
import { ensure } from "./org";

// ---------- Listing ----------

export const STAFF_FLAGS = {
  "no-approver": "No approver",
  "no-email": "Managers and executives without email",
  "legacy-password": "Not signed in to v2 yet",
  "no-password": "Cannot sign in (no password)",
} as const;
export type StaffFlag = keyof typeof STAFF_FLAGS;

export type StaffFilters = {
  q?: string;
  departmentId?: number;
  designation?: Designation;
  status?: StaffStatus | "ALL";
  flag?: StaffFlag;
  sort?: "staffNo" | "name" | "department" | "dateJoined";
  dir?: "asc" | "desc";
  page?: number;
};

export const PAGE_SIZE = 50;

async function staffWhere(user: SessionUser, f: StaffFilters): Promise<Prisma.StaffWhereInput | null> {
  const scope = staffViewScope(user);
  if (!scope) return null;
  const and: Prisma.StaffWhereInput[] = [scope];
  const status = f.status ?? "ACTIVE";
  if (status !== "ALL") and.push({ status });
  if (f.departmentId) and.push({ departmentId: f.departmentId });
  if (f.designation) and.push({ designation: f.designation });
  if (f.q) {
    const q = f.q.trim();
    and.push({ OR: [{ staffNo: { contains: q } }, { name: { contains: q } }, { email: { contains: q } }, { position: { contains: q } }] });
  }
  switch (f.flag) {
    case "no-email":
      and.push({ email: null, designation: { in: ["MANAGER", "EXECUTIVE"] } });
      break;
    case "legacy-password":
      and.push({ legacyMd5: { not: null } });
      break;
    case "no-password":
      and.push({ legacyMd5: null, passwordHash: null });
      break;
    case "no-approver": {
      const map = await approverMap();
      const ids = [...map].filter(([, r]) => r.basis === "NONE" && r.reason === "NO_HOD").map(([id]) => id);
      and.push({ id: { in: ids } });
      break;
    }
  }
  return { AND: and };
}

function orderBy(f: StaffFilters): Prisma.StaffOrderByWithRelationInput[] {
  const dir = f.dir ?? "asc";
  switch (f.sort) {
    case "name":
      return [{ name: dir }];
    case "department":
      return [{ department: { name: dir } }, { name: "asc" }];
    case "dateJoined":
      return [{ dateJoined: dir }, { name: "asc" }];
    default:
      return [{ staffNo: dir }];
  }
}

const listSelect = {
  id: true,
  staffNo: true,
  name: true,
  email: true,
  position: true,
  designation: true,
  gender: true,
  status: true,
  dateJoined: true,
  dateResigned: true,
  jobGrade: true,
  fillsOwnTna: true,
  department: { select: { id: true, name: true, shortName: true, divisionId: true } },
  section: { select: { name: true } },
} satisfies Prisma.StaffSelect;

export async function listStaff(user: SessionUser, f: StaffFilters) {
  const where = await staffWhere(user, f);
  if (!where) return { rows: [], total: 0, page: 1, pages: 1 };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.staff.findMany({ where, orderBy: orderBy(f), skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: listSelect }),
    db.staff.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function listStaffForExport(user: SessionUser, f: StaffFilters) {
  const where = await staffWhere(user, f);
  if (!where) return [];
  return db.staff.findMany({
    where,
    orderBy: orderBy(f),
    select: { ...listSelect, department: { select: { name: true, division: { select: { name: true } } } } },
  });
}

// ---------- One record ----------

export async function getStaffRecord(user: SessionUser, id: number) {
  const scope = staffViewScope(user);
  if (!scope && id !== user.id) return null;
  const staff = await db.staff.findFirst({
    where: id === user.id ? { id } : { AND: [{ id }, scope ?? {}] },
    include: {
      department: { include: { division: { select: { id: true, name: true } } } },
      section: true,
      roles: true,
      hodOf: { select: { id: true, name: true } },
      headOf: { select: { id: true, name: true } },
    },
  });
  return staff;
}

export async function recordHistory(id: number) {
  return db.auditLog.findMany({
    where: { entity: "Staff", entityId: String(id) },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { actor: { select: { name: true } } },
  });
}

// ---------- Changes ----------

/** Loaded with any record that is about to be changed, for canManageStaffRecord. */
const accessInclude = {
  roles: { select: { role: true } },
  hodOf: { select: { id: true, name: true } },
  headOf: { select: { id: true, name: true } },
} as const;

async function checkSection(tx: Prisma.TransactionClient, departmentId: number, sectionId: number | null) {
  if (!sectionId) return;
  const section = await tx.section.findUnique({ where: { id: sectionId } });
  if (!section || section.departmentId !== departmentId)
    throw new UserError("That section is not in the chosen department.", { sectionId: ["Not in this department"] });
}

function checkDesignation(user: SessionUser, designation: Designation) {
  if (!manageableDesignations(user).includes(designation))
    throw new UserError("You can only add or edit contract staff.", { designation: ["Clerks manage contract staff only"] });
}

export async function createStaff(user: SessionUser, input: StaffInput) {
  ensure(user, "staff.manage");
  checkDesignation(user, input.designation);
  return db.$transaction(async (tx) => {
    await checkSection(tx, input.departmentId, input.sectionId);
    // Who fills in their own TNA is L&D's to decide.
    const staff = await tx.staff.create({ data: { ...input, fillsOwnTna: isAdmin(user) && input.fillsOwnTna } });
    await recordAudit(tx, {
      actorId: user.id,
      action: "CREATE",
      entity: "Staff",
      entityId: staff.id,
      summary: `Added ${staff.name} (${staff.staffNo}) as ${DESIGNATION_LABELS[staff.designation]}`,
    });
    return staff;
  });
}

const EDITABLE: (keyof StaffInput & string)[] = [
  "staffNo",
  "name",
  "email",
  "position",
  "designation",
  "gender",
  "departmentId",
  "sectionId",
  "dateJoined",
  "jobGrade",
  "fillsOwnTna",
];

export async function updateStaff(user: SessionUser, id: number, input: StaffInput) {
  ensure(user, "staff.manage");
  return db.$transaction(async (tx) => {
    const before = await tx.staff.findUniqueOrThrow({ where: { id }, include: accessInclude });
    if (!canManageStaffRecord(user, before)) throw new UserError("You can only edit contract staff.");
    checkDesignation(user, input.designation);
    await checkSection(tx, input.departmentId, input.sectionId);

    // Who fills in their own TNA is L&D's to decide: a clerk's save leaves it as it was.
    const data = isAdmin(user) ? input : { ...input, fillsOwnTna: before.fillsOwnTna };
    const staff = await tx.staff.update({ where: { id }, data });
    const changes = diffFields(before, data, EDITABLE);
    if (before.departmentId !== input.departmentId) {
      // Same rule as Organization → Transfer: a HOD who leaves stops being HOD.
      await tx.department.updateMany({ where: { hodId: id, id: { not: input.departmentId } }, data: { hodId: null } });
    }
    if (Object.keys(changes).length)
      await recordAudit(tx, { actorId: user.id, action: "UPDATE", entity: "Staff", entityId: id, summary: `Updated ${staff.name}`, changes });
    return staff;
  });
}

/**
 * Marks a staff member as resigned. They can no longer sign in, and any HOD or
 * division-head assignment is removed so records stop routing to them.
 */
export async function resignStaff(user: SessionUser, id: number, dateResigned: Date) {
  ensure(user, "staff.manage");
  return db.$transaction(async (tx) => {
    const staff = await tx.staff.findUniqueOrThrow({ where: { id }, include: accessInclude });
    if (!canManageStaffRecord(user, staff)) throw new UserError("You can only update contract staff.");
    if (staff.status === "RESIGNED") throw new UserError(`${staff.name} is already marked as resigned.`);
    if (staff.id === user.id) throw new UserError("You can't mark your own record as resigned.");

    await tx.staff.update({ where: { id }, data: { status: "RESIGNED", dateResigned } });
    await tx.department.updateMany({ where: { hodId: id }, data: { hodId: null } });
    await tx.division.updateMany({ where: { headId: id }, data: { headId: null } });
    const cleared = [...staff.hodOf.map((d) => `HOD of ${d.name}`), ...staff.headOf.map((d) => `head of ${d.name}`)];
    await recordAudit(tx, {
      actorId: user.id,
      action: "UPDATE",
      entity: "Staff",
      entityId: id,
      summary: `Marked ${staff.name} as resigned${cleared.length ? `, removed as ${cleared.join(", ")}` : ""}`,
      changes: { status: ["ACTIVE", "RESIGNED"], dateResigned: [null, dateResigned.toISOString().slice(0, 10)] },
    });
    return { cleared };
  });
}

export async function reinstateStaff(user: SessionUser, id: number) {
  ensure(user, "staff.manage");
  return db.$transaction(async (tx) => {
    const staff = await tx.staff.findUniqueOrThrow({ where: { id }, include: accessInclude });
    if (!canManageStaffRecord(user, staff)) throw new UserError("You can only update contract staff.");
    if (staff.status === "ACTIVE") throw new UserError(`${staff.name} is already active.`);
    await tx.staff.update({ where: { id }, data: { status: "ACTIVE", dateResigned: null } });
    await recordAudit(tx, {
      actorId: user.id,
      action: "UPDATE",
      entity: "Staff",
      entityId: id,
      summary: `Reinstated ${staff.name}`,
      changes: { status: ["RESIGNED", "ACTIVE"] },
    });
  });
}

/** Sets a temporary password the staff member must change at next sign-in. */
export async function resetPassword(user: SessionUser, id: number, password: string) {
  ensure(user, "staff.manage");
  const staff = await db.staff.findUniqueOrThrow({ where: { id }, include: accessInclude });
  if (!canManageStaffRecord(user, staff)) throw new UserError("You can only reset passwords for contract staff.");
  const problems = passwordProblems(password, staff.staffNo);
  if (problems.length) throw new UserError("Choose a stronger temporary password.", { password: problems });
  const passwordHash = await hash(password);
  await db.$transaction(async (tx) => {
    await tx.staff.update({ where: { id }, data: { passwordHash, legacyMd5: null, mustChangePassword: true, sessionVersion: { increment: 1 } } });
    await recordAudit(tx, { actorId: user.id, action: "UPDATE", entity: "Staff", entityId: id, summary: `Reset the password for ${staff.name}` });
  });
}

export async function setRoles(user: SessionUser, id: number, roles: RoleCode[]) {
  ensure(user, "staff.roles");
  return db.$transaction(async (tx) => {
    const staff = await tx.staff.findUniqueOrThrow({ where: { id }, include: { roles: true } });
    const before = staff.roles.map((r) => r.role).sort();
    const after = [...new Set(roles)].sort();
    if (staff.id === user.id && before.includes("LD_ADMIN") && !after.includes("LD_ADMIN"))
      throw new UserError("You can't remove your own L&D admin role. Ask another admin to do it.");
    if (before.join() === after.join()) return;
    await tx.staffRole.deleteMany({ where: { staffId: id } });
    if (after.length) await tx.staffRole.createMany({ data: after.map((role) => ({ staffId: id, role })) });
    await recordAudit(tx, {
      actorId: user.id,
      action: "UPDATE",
      entity: "Staff",
      entityId: id,
      summary: `Changed roles for ${staff.name}`,
      changes: { roles: [before.join(", ") || "none", after.join(", ") || "none"] },
    });
  });
}

export async function changeOwnPassword(user: SessionUser, current: string, next: string) {
  const staff = await db.staff.findUniqueOrThrow({ where: { id: user.id } });
  if (!staff.passwordHash || !(await verify(staff.passwordHash, current)))
    throw new UserError("Your current password is not correct.", { current: ["Not correct"] });
  const problems = passwordProblems(next, staff.staffNo);
  if (problems.length) throw new UserError("Choose a stronger password.", { next: problems });
  if (await verify(staff.passwordHash, next)) throw new UserError("Use a password you haven't used here before.", { next: ["Same as the current password"] });
  const passwordHash = await hash(next);
  await db.$transaction(async (tx) => {
    await tx.staff.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } } });
    await recordAudit(tx, { actorId: user.id, action: "UPDATE", entity: "Staff", entityId: user.id, summary: "Changed own password" });
  });
}
