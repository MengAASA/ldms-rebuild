import "server-only";
import type { Prisma } from "@prisma/client";
import { formatDateRange, formatTime, plural } from "@/lib/format";
import type { OjtEntryDetails } from "@/lib/validation/ojt";
import { db } from "../db";
import { UserError } from "../errors";
import { isAdmin, ojtStaffScope, type SessionUser } from "../permissions";
import { ojtDateBlock } from "../rules/myTraining";
import { ojtAttendanceAfterEdit, ojtChangeBlock, ojtEntryAttendance, ojtStaffBlock } from "../rules/ojt";
import { countsTowardHours, trainingHours } from "../rules/training";
import { diffFields, recordAudit } from "./audit";
import { discardCertificateFile } from "./certificate";
import { ensure } from "./org";
import { newTrainingCode } from "./training";

// OJT that clerks and L&D record for staff (module 4). Clerks see and record
// contract staff only; see ojtStaffScope and ojtStaffBlock. Each OJT is a
// Training of type OJT with one Participant per staff member.

export const OJT_PAGE_SIZE = 50;

export type OjtFilters = {
  q?: string;
  departmentId?: number;
  /** YYYY-MM-DD: OJT starting on or after this day. */
  from?: string;
  /** YYYY-MM-DD: OJT ending on or before this day. */
  to?: string;
  page?: number;
};

function scopeOf(user: SessionUser): Prisma.StaffWhereInput {
  ensure(user, "ojt.manage");
  const scope = ojtStaffScope(user);
  if (!scope) throw new UserError("You don't have access to do that.");
  return scope;
}

/** Which rows the list and its export show: the user's staff, and the filters. */
function ojtWhere(user: SessionUser, f: OjtFilters): Prisma.ParticipantWhereInput {
  const scope = scopeOf(user);
  const q = f.q?.trim();
  return {
    training: {
      type: "OJT",
      ...(f.from ? { startDate: { gte: new Date(`${f.from}T00:00:00Z`) } } : {}),
      ...(f.to ? { endDate: { lte: new Date(`${f.to}T00:00:00Z`) } } : {}),
    },
    staff: { ...scope, ...(f.departmentId ? { departmentId: f.departmentId } : {}) },
    ...(q
      ? {
          OR: [
            { training: { title: { contains: q } } },
            { training: { trainingCode: { contains: q } } },
            { staff: { staffNo: { contains: q } } },
            { staff: { name: { contains: q } } },
          ],
        }
      : {}),
  };
}

const ojtOrder: Prisma.ParticipantOrderByWithRelationInput[] = [{ training: { startDate: "desc" } }, { training: { id: "desc" } }, { staff: { name: "asc" } }];

const ojtRowSelect = {
  id: true,
  attendance: true,
  source: true,
  submittedAt: true,
  staff: { select: { id: true, staffNo: true, name: true, department: { select: { name: true } }, section: { select: { name: true } } } },
  training: {
    select: {
      id: true,
      trainingCode: true,
      title: true,
      ojtMethod: true,
      venue: true,
      program: true,
      trainerName: true,
      status: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      sessions: { select: { date: true, startTime: true, endTime: true } },
    },
  },
} satisfies Prisma.ParticipantSelect;

const withHours = <P extends Prisma.ParticipantGetPayload<{ select: typeof ojtRowSelect }>>(p: P) => ({
  ...p,
  hours: trainingHours(p.training) ?? 0,
  counts: countsTowardHours(p),
});

/** One row per person per OJT, newest first, for the staff the user looks after. */
export async function listOjt(user: SessionUser, f: OjtFilters) {
  const where = ojtWhere(user, f);
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.participant.findMany({ where, orderBy: ojtOrder, skip: (page - 1) * OJT_PAGE_SIZE, take: OJT_PAGE_SIZE, select: ojtRowSelect }),
    db.participant.count({ where }),
  ]);
  return { rows: rows.map(withHours), total, page, pages: Math.max(1, Math.ceil(total / OJT_PAGE_SIZE)) };
}

/** Every row the filters match (not just one page), for the Excel export. */
export async function listOjtForExport(user: SessionUser, f: OjtFilters) {
  // With each person's answers, which the old OJT audit report listed.
  const rows = await db.participant.findMany({
    where: ojtWhere(user, f),
    orderBy: ojtOrder,
    take: 20_000,
    select: { ...ojtRowSelect, staff: { select: { ...ojtRowSelect.staff.select, gender: true } }, feedback: true, feedbackVersion: true },
  });
  return rows.map((r) => ({ ...withHours(r), gender: r.staff.gender, feedback: r.feedback, feedbackVersion: r.feedbackVersion }));
}

export type OjtListRow = Awaited<ReturnType<typeof listOjt>>["rows"][number];

/**
 * One person's OJT record, with the others on the same OJT the user may see.
 * Null when it isn't an OJT, or it's for someone outside the user's staff
 * (a clerk opening an executive's record gets "not found").
 */
export async function getOjtRecord(user: SessionUser, participantId: number) {
  const scope = scopeOf(user);
  const p = await db.participant.findFirst({
    where: { id: participantId, training: { type: "OJT" }, staff: scope },
    select: {
      ...ojtRowSelect,
      attendanceReason: true,
      feedback: true,
      feedbackVersion: true,
      createdAt: true,
      recordedById: true,
      staff: {
        select: {
          id: true,
          staffNo: true,
          name: true,
          position: true,
          designation: true,
          department: { select: { name: true } },
          section: { select: { name: true } },
        },
      },
    },
  });
  if (!p) return null;
  const [others, recorder] = await Promise.all([
    db.participant.findMany({
      where: { trainingId: p.training.id, staff: scope },
      orderBy: { staff: { name: "asc" } },
      select: { id: true, attendance: true, staff: { select: { staffNo: true, name: true } } },
    }),
    p.recordedById ? db.staff.findUnique({ where: { id: p.recordedById }, select: { name: true, staffNo: true } }) : null,
  ]);
  return { ...withHours(p), others, recorder };
}

export type OjtRecord = NonNullable<Awaited<ReturnType<typeof getOjtRecord>>>;

/** Departments for the list's filter: those with staff the user looks after. */
export async function ojtDepartments(user: SessionUser) {
  const scope = scopeOf(user);
  return db.department.findMany({
    where: { staff: { some: { ...scope, status: "ACTIVE" } } },
    orderBy: [{ division: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, division: { select: { name: true } }, sections: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
}

/** Active staff the user may record OJT for, with their departments, for the picker. */
export async function ojtCandidates(user: SessionUser) {
  const scope = scopeOf(user);
  const [staff, departments] = await Promise.all([
    db.staff.findMany({
      where: { ...scope, status: "ACTIVE" },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        staffNo: true,
        name: true,
        status: true,
        designation: true,
        departmentId: true,
        sectionId: true,
        department: { select: { name: true } },
        roles: { select: { role: true } },
        hodOf: { select: { id: true } },
        headOf: { select: { id: true } },
      },
    }),
    ojtDepartments(user),
  ]);
  return {
    staff: staff
      .filter((s) => !ojtStaffBlock(user, s))
      .map((s) => ({
        id: s.id,
        staffNo: s.staffNo,
        name: s.name,
        designation: s.designation,
        departmentId: s.departmentId,
        sectionId: s.sectionId,
        departmentName: s.department.name,
      })),
    departments: departments.map((d) => ({ id: d.id, name: d.name, division: d.division.name, sections: d.sections })),
  };
}

const who = (s: { name: string; staffNo: string }) => `${s.name} (${s.staffNo})`;

/**
 * Records one OJT for several staff. Short OJT (4 hours or less) is completed
 * for everyone; a longer one waits for each person's answers on My Training.
 * Returns the training's id and how many staff it was recorded for.
 */
export async function recordOjtForStaff(user: SessionUser, details: OjtEntryDetails, staffIds: number[], today: Date) {
  scopeOf(user);
  const late = ojtDateBlock(details.endDate, today);
  if (late) throw new UserError(late, { endDate: ["Pick today or an earlier date"] });

  return db.$transaction(async (tx) => {
    const staff = await tx.staff.findMany({
      where: { id: { in: staffIds } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        staffNo: true,
        name: true,
        status: true,
        designation: true,
        departmentId: true,
        roles: { select: { role: true } },
        hodOf: { select: { id: true } },
        headOf: { select: { id: true } },
      },
    });
    if (staff.length < staffIds.length)
      throw new UserError(`${plural(staffIds.length - staff.length, "staff member")} chosen are no longer in the staff list. Choose again.`);
    const refused = staff.flatMap((s) => ojtStaffBlock(user, s) ?? []);
    if (refused.length)
      throw new UserError(`${refused.slice(0, 3).join("; ")}${refused.length > 3 ? `; and ${refused.length - 3} more` : ""}.`, {
        staffIds: ["Remove these staff"],
      });

    const attendance = ojtEntryAttendance(trainingHours(details), false);
    // The organising department, when everyone is from the same one.
    const departments = new Set(staff.map((s) => s.departmentId));
    const training = await tx.training.create({
      data: {
        type: "OJT",
        trainingCode: await newTrainingCode(tx, "OJT"),
        ...details,
        departmentId: departments.size === 1 ? staff[0].departmentId : null,
        createdById: user.id,
      },
    });
    await tx.participant.createMany({
      data: staff.map((s) => ({
        trainingId: training.id,
        staffId: s.id,
        attendance,
        source: isAdmin(user) ? ("ADMIN" as const) : ("CLERK" as const),
        recordedById: user.id,
      })),
    });
    await recordAudit(tx, {
      actorId: user.id,
      action: "CREATE",
      entity: "Training",
      entityId: training.id,
      summary: `Recorded OJT ${training.title} (${formatDateRange(training.startDate, training.endDate)}) for ${staff.length === 1 ? who(staff[0]) : plural(staff.length, "staff member")}`,
      changes: staff.length === 1 ? undefined : { staff: [null, staff.map(who).join(", ")] },
    });
    return { trainingId: training.id, count: staff.length, attendance };
  });
}

// ---------- Editing and deleting ----------

const changeSelect = {
  id: true,
  title: true,
  ojtMethod: true,
  startDate: true,
  endDate: true,
  startTime: true,
  endTime: true,
  venue: true,
  program: true,
  trainerName: true,
  certificateFile: true,
  sessions: { select: { date: true, startTime: true, endTime: true } },
  participants: {
    orderBy: { staff: { name: "asc" } },
    select: {
      id: true,
      attendance: true,
      source: true,
      feedback: true,
      staff: {
        select: {
          id: true,
          staffNo: true,
          name: true,
          designation: true,
          departmentId: true,
          sectionId: true,
          department: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.TrainingSelect;

type Client = Prisma.TransactionClient | typeof db;

/** The OJT a record belongs to, with everyone on it, when the user may see that record; null otherwise. */
async function ojtWithPeople(client: Client, user: SessionUser, participantId: number) {
  const p = await client.participant.findFirst({
    where: { id: participantId, training: { type: "OJT" }, staff: scopeOf(user) },
    select: { trainingId: true },
  });
  if (!p) return null;
  const training = await client.training.findUniqueOrThrow({ where: { id: p.trainingId }, select: changeSelect });
  const blocked = ojtChangeBlock(
    user,
    training.participants.map((x) => ({ source: x.source, ...x.staff })),
  );
  return { training, blocked };
}

/** Why the user can't edit or delete the OJT this record belongs to, or null when they can. */
export async function ojtRecordChangeBlock(user: SessionUser, participantId: number) {
  return (await ojtWithPeople(db, user, participantId))?.blocked ?? null;
}

/**
 * The OJT form, filled in, for editing the OJT a record belongs to. The staff
 * list offers the usual staff plus whoever is on it already (someone who has
 * since resigned stays on unless they're unticked). Null when not found.
 */
export async function getOjtForEdit(user: SessionUser, participantId: number) {
  const found = await ojtWithPeople(db, user, participantId);
  if (!found) return null;
  const { staff, departments } = await ojtCandidates(user);
  const offered = new Set(staff.map((s) => s.id));
  const onIt = found.training.participants.map((x) => x.staff);
  return {
    training: found.training,
    blocked: found.blocked,
    staffIds: onIt.map((s) => s.id),
    staff: [
      ...staff,
      ...onIt
        .filter((s) => !offered.has(s.id))
        .map((s) => ({
          id: s.id,
          staffNo: s.staffNo,
          name: s.name,
          designation: s.designation,
          departmentId: s.departmentId,
          sectionId: s.sectionId,
          departmentName: s.department.name,
        })),
    ].sort((a, b) => a.name.localeCompare(b.name)),
    departments,
  };
}

type OjtColumns = { title: string; ojtMethod: string | null; venue: string | null; program: string | null; trainerName: string | null };
type OjtTimes = { startDate: Date; endDate: Date; startTime: Date | null; endTime: Date | null };

/** Plain values for the audit diff: dates as YYYY-MM-DD, times as HH:MM. */
const auditView = (t: OjtColumns & OjtTimes) => ({
  title: t.title,
  ojtMethod: t.ojtMethod,
  startDate: t.startDate.toISOString().slice(0, 10),
  endDate: t.endDate.toISOString().slice(0, 10),
  startTime: formatTime(t.startTime),
  endTime: formatTime(t.endTime),
  venue: t.venue,
  program: t.program,
  trainerName: t.trainerName,
});

/**
 * Saves the OJT form for the OJT a record belongs to: its details for
 * everyone on it, plus staff added or unticked. Where the hours decided
 * whether someone is completed, a change of hours is carried through (see
 * ojtAttendanceAfterEdit). Returns whether the record's own person is still on it.
 */
export async function updateOjtEntry(user: SessionUser, participantId: number, details: OjtEntryDetails, staffIds: number[], today: Date) {
  const late = ojtDateBlock(details.endDate, today);
  if (late) throw new UserError(late, { endDate: ["Pick today or an earlier date"] });

  return db.$transaction(async (tx) => {
    const found = await ojtWithPeople(tx, user, participantId);
    if (!found) throw new UserError("This OJT record no longer exists.");
    if (found.blocked) throw new UserError(found.blocked);
    const { training } = found;

    const current = new Set(training.participants.map((x) => x.staff.id));
    const wanted = new Set(staffIds);
    const removed = training.participants.filter((x) => !wanted.has(x.staff.id));
    const kept = training.participants.filter((x) => wanted.has(x.staff.id));
    const addedIds = staffIds.filter((id) => !current.has(id));
    const added = await tx.staff.findMany({
      where: { id: { in: addedIds } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        staffNo: true,
        name: true,
        status: true,
        designation: true,
        departmentId: true,
        roles: { select: { role: true } },
        hodOf: { select: { id: true } },
        headOf: { select: { id: true } },
      },
    });
    if (added.length < addedIds.length)
      throw new UserError(`${plural(addedIds.length - added.length, "staff member")} chosen are no longer in the staff list. Choose again.`);
    const refused = added.flatMap((s) => ojtStaffBlock(user, s) ?? []);
    if (refused.length)
      throw new UserError(`${refused.slice(0, 3).join("; ")}${refused.length > 3 ? `; and ${refused.length - 3} more` : ""}.`, {
        staffIds: ["Remove these staff"],
      });

    const oldHours = trainingHours(training);
    const newHours = trainingHours(details);
    const departments = new Set([...kept.map((x) => x.staff.departmentId), ...added.map((s) => s.departmentId)]);

    // Saving the form replaces any sessions, as the training form does.
    await tx.trainingSession.deleteMany({ where: { trainingId: training.id } });
    await tx.training.update({
      where: { id: training.id },
      data: { ...details, departmentId: departments.size === 1 ? [...departments][0] : null },
    });
    if (removed.length) await tx.participant.deleteMany({ where: { id: { in: removed.map((x) => x.id) } } });
    if (added.length)
      await tx.participant.createMany({
        data: added.map((s) => ({
          trainingId: training.id,
          staffId: s.id,
          attendance: ojtEntryAttendance(newHours, false),
          source: isAdmin(user) ? ("ADMIN" as const) : ("CLERK" as const),
          recordedById: user.id,
        })),
      });
    for (const x of kept) {
      const attendance = ojtAttendanceAfterEdit({ attendance: x.attendance, hasAnswers: x.feedback !== null }, oldHours, newHours);
      if (attendance !== x.attendance) await tx.participant.update({ where: { id: x.id }, data: { attendance } });
    }

    const changes = diffFields(auditView(training), auditView(details), [
      "title",
      "ojtMethod",
      "startDate",
      "endDate",
      "startTime",
      "endTime",
      "venue",
      "program",
      "trainerName",
    ]);
    if (added.length) changes.staffAdded = [null, added.map(who).join(", ")];
    if (removed.length) changes.staffRemoved = [removed.map((x) => who(x.staff)).join(", "), null];
    if (Object.keys(changes).length)
      await recordAudit(tx, {
        actorId: user.id,
        action: "UPDATE",
        entity: "Training",
        entityId: training.id,
        summary: `Updated OJT ${details.title} (${formatDateRange(details.startDate, details.endDate)})`,
        changes,
      });

    return { stillOn: removed.every((x) => x.id !== participantId) };
  });
}

/** Deletes the OJT a record belongs to, for everyone on it. */
export async function deleteOjtEntry(user: SessionUser, participantId: number) {
  const certificate = await db.$transaction(async (tx) => {
    const found = await ojtWithPeople(tx, user, participantId);
    if (!found) throw new UserError("This OJT record no longer exists.");
    if (found.blocked) throw new UserError(found.blocked);
    const { training } = found;
    await tx.participant.deleteMany({ where: { trainingId: training.id } });
    await tx.training.delete({ where: { id: training.id } }); // sessions cascade
    const people = training.participants.map((x) => x.staff);
    await recordAudit(tx, {
      actorId: user.id,
      action: "DELETE",
      entity: "Training",
      entityId: training.id,
      summary: `Deleted OJT ${training.title} (${formatDateRange(training.startDate, training.endDate)}) for ${people.length === 1 ? who(people[0]) : plural(people.length, "staff member")}`,
      changes: people.length === 1 ? undefined : { staff: [people.map(who).join(", "), null] },
    });
    return training.certificateFile;
  });
  await discardCertificateFile(certificate);
}
