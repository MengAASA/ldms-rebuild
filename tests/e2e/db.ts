import { rm } from "node:fs/promises";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import { type Attendance, PrismaClient, type RoleCode, type SkillStatus, type TnaStatus } from "@prisma/client";
import { syncPmes } from "../../src/server/services/pmeSync";

/** Where the app keeps certificates (src/server/services/certificate.ts). */
export const CERTIFICATE_DIR = path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"), "certificates");

/**
 * Test-only clean-up for a training the app deliberately never lets anyone
 * delete: once a participant has given feedback they stay on record. Tests
 * that submit feedback create their own training (with a unique title) and
 * remove it here, with its certificate file if it has one. It talks to the
 * database directly, so it only works when the tests run on the same machine
 * as the dev server (not E2E_BASE_URL against another one). Audit entries are
 * left in place.
 */
export async function deleteTestTraining(title: string) {
  const db = new PrismaClient();
  try {
    const found = await db.training.findMany({ where: { title }, select: { id: true, certificateFile: true } });
    if (!found.length) return;
    const ids = found.map((t) => t.id);
    const pmes = await db.pme.findMany({ where: { participant: { trainingId: { in: ids } } }, select: { id: true } });
    await db.notification.deleteMany({ where: { entity: "Pme", entityId: { in: pmes.map((p) => p.id) } } });
    await db.participant.deleteMany({ where: { trainingId: { in: ids } } });
    await db.training.deleteMany({ where: { id: { in: ids } } }); // sessions cascade
    for (const t of found) if (t.certificateFile) await rm(path.join(CERTIFICATE_DIR, t.certificateFile), { force: true });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Test-only set-up: a one-day public training on `day` (YYYY-MM-DD; by
 * default 1 Sep 2026, already held), from 08:30 to `endTime` (9 hours by
 * default), with the given staff on it. Returns its id. Remove it with deleteTestTraining.
 */
export async function createTestTraining(title: string, people: { staffNo: string; attendance: Attendance }[], day = "2026-09-01", endTime = "17:30") {
  const db = new PrismaClient();
  try {
    const staff = await db.staff.findMany({ where: { staffNo: { in: people.map((p) => p.staffNo) } }, select: { id: true, staffNo: true } });
    const training = await db.training.create({
      data: {
        type: "PUBLIC_INHOUSE",
        title,
        trainingCode: `TR${day.replaceAll("-", "")}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`,
        venue: "Training Room 1",
        startDate: new Date(`${day}T00:00:00Z`),
        endDate: new Date(`${day}T00:00:00Z`),
        startTime: new Date("1970-01-01T08:30:00Z"),
        endTime: new Date(`1970-01-01T${endTime}:00Z`),
      },
    });
    await db.participant.createMany({
      data: people.map((p) => ({ trainingId: training.id, staffId: staff.find((s) => s.staffNo === p.staffNo)!.id, attendance: p.attendance })),
    });
    return training.id;
  } finally {
    await db.$disconnect();
  }
}

/** The stored name of a training's certificate, to check its file on disk. */
export async function storedCertificate(trainingId: number) {
  const db = new PrismaClient();
  try {
    return (await db.training.findUnique({ where: { id: trainingId }, select: { certificateFile: true } }))?.certificateFile ?? null;
  } finally {
    await db.$disconnect();
  }
}

/**
 * Test-only: makes the PMEs a test training's completed participants should
 * have, as the app does when attendance is completed on screen.
 */
export async function makeTestPmes(trainingId: number) {
  const db = new PrismaClient();
  try {
    await db.$transaction((tx) => syncPmes(tx, { trainingId }));
    return await db.pme.findMany({ where: { participant: { trainingId } }, select: { id: true, status: true, participant: { select: { staff: { select: { staffNo: true } } } } } });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Test-only: lets a demo staff member who has no password sign in with the
 * demo one. Returns a function that puts their record back as it was.
 */
export async function giveDemoPassword(staffNo: string, password: string) {
  const db = new PrismaClient();
  try {
    const before = await db.staff.findUniqueOrThrow({ where: { staffNo }, select: { id: true, passwordHash: true, legacyMd5: true, mustChangePassword: true } });
    await db.staff.update({ where: { id: before.id }, data: { passwordHash: await hash(password), legacyMd5: null, mustChangePassword: false } });
    return async () => {
      const again = new PrismaClient();
      try {
        await again.staff.update({ where: { id: before.id }, data: { passwordHash: before.passwordHash, legacyMd5: before.legacyMd5, mustChangePassword: before.mustChangePassword } });
      } finally {
        await again.$disconnect();
      }
    };
  } finally {
    await db.$disconnect();
  }
}

/** Test-only: gives a staff member a role for the run. Returns a function that takes it away again (if they didn't have it). */
export async function giveRole(staffNo: string, role: RoleCode) {
  const db = new PrismaClient();
  try {
    const staff = await db.staff.findUniqueOrThrow({ where: { staffNo }, select: { id: true, roles: { select: { role: true } } } });
    const had = staff.roles.some((r) => r.role === role);
    if (!had) await db.staffRole.create({ data: { staffId: staff.id, role } });
    return async () => {
      if (had) return;
      const again = new PrismaClient();
      try {
        await again.staffRole.deleteMany({ where: { staffId: staff.id, role } });
      } finally {
        await again.$disconnect();
      }
    };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Test-only: a skill matrix put straight into a quarter (the app only lets
 * the open quarter be filled in), with one rated topic in each section.
 * Returns its id.
 */
export async function createTestSkillMatrix(staffNo: string, quarter: { year: number; quarter: number }, status: SkillStatus, evaluatorStaffNo: string) {
  const db = new PrismaClient();
  try {
    const [staff, evaluator] = await Promise.all([
      db.staff.findUniqueOrThrow({ where: { staffNo }, select: { id: true } }),
      db.staff.findUniqueOrThrow({ where: { staffNo: evaluatorStaffNo }, select: { id: true } }),
    ]);
    const m = await db.skillEvaluation.create({
      data: {
        staffId: staff.id,
        ...quarter,
        status,
        createdById: evaluator.id,
        submittedAt: status === "DRAFT" ? null : new Date(),
        topics: {
          create: (["KNOWLEDGE", "SKILL", "ABILITY"] as const).map((section, i) => ({
            section,
            name: `Test ${section.toLowerCase()} topic`,
            sortOrder: i,
            items: { create: [{ text: "Does it without help", rating: 4, sortOrder: 0 }] },
          })),
        },
      },
    });
    return m.id;
  } finally {
    await db.$disconnect();
  }
}

/** Test-only clean-up: every skill matrix of these staff, in any quarter. */
export async function deleteTestSkillMatrices(staffNos: string[]) {
  const db = new PrismaClient();
  try {
    const where = { staff: { staffNo: { in: staffNos } } };
    const found = await db.skillEvaluation.findMany({ where, select: { id: true } });
    await db.notification.deleteMany({ where: { entity: "SkillEvaluation", entityId: { in: found.map((m) => m.id) } } });
    await db.skillEvaluation.deleteMany({ where }); // topics and lines cascade
  } finally {
    await db.$disconnect();
  }
}

/**
 * Test-only: gives staff a job grade for the run, so their department has a
 * job grade's TNA to fill in. Returns a function that puts each one's back.
 */
export async function setJobGrade(staffNos: string[], jobGrade: number) {
  const db = new PrismaClient();
  try {
    const before = await db.staff.findMany({ where: { staffNo: { in: staffNos } }, select: { id: true, jobGrade: true } });
    await db.staff.updateMany({ where: { id: { in: before.map((s) => s.id) } }, data: { jobGrade } });
    return async () => {
      const again = new PrismaClient();
      try {
        for (const s of before) await again.staff.update({ where: { id: s.id }, data: { jobGrade: s.jobGrade } });
      } finally {
        await again.$disconnect();
      }
    };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Test-only: a person's TNA put straight into a year (the app only lets this
 * year's be filled in), with one complete typed-in row under Special project.
 * Returns its id.
 */
export async function createTestTna(staffNo: string, year: number, status: TnaStatus, training = "Test kaizen project") {
  const db = new PrismaClient();
  try {
    const staff = await db.staff.findUniqueOrThrow({ where: { staffNo }, select: { id: true } });
    const t = await db.tna.create({
      data: {
        year,
        staffId: staff.id,
        status,
        createdById: staff.id,
        submittedById: status === "DRAFT" ? null : staff.id,
        submittedAt: status === "DRAFT" ? null : new Date(),
        items: {
          create: [{ section: "SPECIAL_PROJECT", sortOrder: 0, problem: "Changeovers take too long", trainingName: training, targetSkill: 4, currentSkill: 2, method: "COACHING", month: 6 }],
        },
      },
    });
    return t.id;
  } finally {
    await db.$disconnect();
  }
}

/** Test-only clean-up: every TNA of these staff and of this department's job grades, in any year, and training options by name. */
export async function deleteTestTnas(staffNos: string[], departmentName: string, optionNames: string[] = []) {
  const db = new PrismaClient();
  try {
    const where = { OR: [{ staff: { staffNo: { in: staffNos } } }, { department: { name: departmentName } }] };
    const found = await db.tna.findMany({ where, select: { id: true } });
    await db.notification.deleteMany({ where: { entity: "Tna", entityId: { in: found.map((t) => t.id) } } });
    await db.tna.deleteMany({ where }); // rows cascade
    if (optionNames.length) await db.tnaTrainingOption.deleteMany({ where: { name: { in: optionNames } } });
  } finally {
    await db.$disconnect();
  }
}

/** Test-only: a department's TNI put straight into a year (the app only lets this year's be filled in), with one row. */
export async function createTestTni(departmentName: string, year: number) {
  const db = new PrismaClient();
  try {
    const department = await db.department.findFirstOrThrow({ where: { name: departmentName }, select: { id: true, hodId: true } });
    await db.tni.create({
      data: {
        year,
        departmentId: department.id,
        updatedById: department.hodId,
        items: {
          create: [{ sortOrder: 0, indicator: "Test changeover time", expected: 4, actual: 2, causes: "No standard work", ask: "Skill", method: "OJT", evaluation: "Changeover under 20 minutes" }],
        },
      },
    });
  } finally {
    await db.$disconnect();
  }
}

/** Test-only clean-up: every TNI of this department, in any year. */
export async function deleteTestTnis(departmentName: string) {
  const db = new PrismaClient();
  try {
    await db.tni.deleteMany({ where: { department: { name: departmentName } } }); // rows cascade
  } finally {
    await db.$disconnect();
  }
}

/** Test-only: puts the TNA year setting (which year L&D have opened) to a value. Returns a function that puts it back as it was. */
export async function setTnaYearSetting(year: number) {
  const db = new PrismaClient();
  try {
    const before = await db.setting.findUnique({ where: { key: "tna.year" }, select: { value: true } });
    await db.setting.upsert({ where: { key: "tna.year" }, update: { value: year }, create: { key: "tna.year", value: year } });
    return async () => {
      const again = new PrismaClient();
      try {
        if (before) await again.setting.update({ where: { key: "tna.year" }, data: { value: before.value ?? year } });
        else await again.setting.deleteMany({ where: { key: "tna.year" } });
      } finally {
        await again.$disconnect();
      }
    };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Test-only: switches Sending off (so no test ever really sends an email),
 * puts email test mode to a known state and removes the test emails and
 * daily job runs a staff member made, and every reminder email (the daily
 * job writes one per person per day, so a test needs a clean day). Returns a
 * function that removes them again and puts both switches back as they were.
 */
export async function resetMail(staffNo: string, testMode: { enabled: boolean; address: string }) {
  const clear = async (db: PrismaClient) => {
    const staff = await db.staff.findUniqueOrThrow({ where: { staffNo }, select: { id: true } });
    await db.emailMessage.deleteMany({ where: { OR: [{ staffId: staff.id, kind: { in: ["test", "copy"] } }, { kind: "digest" }] } });
    await db.jobRun.deleteMany({ where: { startedById: staff.id } });
  };
  const db = new PrismaClient();
  try {
    const before = await db.setting.findUnique({ where: { key: "mail.testMode" }, select: { value: true } });
    const sending = await db.setting.findUnique({ where: { key: "mail.sending" }, select: { value: true } });
    await db.setting.upsert({ where: { key: "mail.sending" }, update: { value: false }, create: { key: "mail.sending", value: false } });
    await clear(db);
    await db.setting.upsert({ where: { key: "mail.testMode" }, update: { value: testMode }, create: { key: "mail.testMode", value: testMode } });
    return async () => {
      const again = new PrismaClient();
      try {
        await clear(again);
        await again.setting.update({ where: { key: "mail.testMode" }, data: { value: before?.value ?? testMode } });
        await again.setting.update({ where: { key: "mail.sending" }, data: { value: sending?.value === true } });
      } finally {
        await again.$disconnect();
      }
    };
  } finally {
    await db.$disconnect();
  }
}

/** Test-only clean-up: every notification written for these staff. */
export async function deleteTestNotifications(staffNos: string[]) {
  const db = new PrismaClient();
  try {
    await db.notification.deleteMany({ where: { staff: { staffNo: { in: staffNos } } } });
  } finally {
    await db.$disconnect();
  }
}

/** Test-only: remembers these settings and returns a function that puts each back as it was (or removes it, if it wasn't there). */
export async function keepSettings(keys: string[]) {
  const db = new PrismaClient();
  try {
    const before = await db.setting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    return async () => {
      const again = new PrismaClient();
      try {
        for (const key of keys) {
          const was = before.find((s) => s.key === key);
          if (was) await again.setting.upsert({ where: { key }, update: { value: was.value ?? {} }, create: { key, value: was.value ?? {} } });
          else await again.setting.deleteMany({ where: { key } });
        }
      } finally {
        await again.$disconnect();
      }
    };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Test-only clean-up: removes staff a test added (by staff no.), so each run
 * leaves the headcount as it found it. Their roles and notifications go with
 * them; audit entries they made stay, without an actor.
 */
export async function deleteTestStaff(staffNos: string[]) {
  const db = new PrismaClient();
  try {
    await db.staff.deleteMany({ where: { staffNo: { in: staffNos } } });
  } finally {
    await db.$disconnect();
  }
}
