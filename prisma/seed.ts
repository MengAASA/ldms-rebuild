// Development seed: settings, a demo org chart and staff list, and demo trainings.
// Real data comes from scripts/legacy-import in phase 5; this is only so the
// screens have something realistic to show. Each part runs only while its
// table is empty, so later phases can add demo data to an existing database.

import { PrismaClient, type Designation, type Prisma, type RoleCode, type TrainingFunction, type TrainingPlatform, type TrainingProgram } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { createHash, randomInt } from "node:crypto";
import { trainingCode } from "../src/server/rules/training";
import { syncPmes } from "../src/server/services/pmeSync";

const db = new PrismaClient();

// Deterministic PRNG so every developer gets the same demo data.
let seed = 20260924;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

const MALAY_M = ["Mohd Faizal", "Ahmad Zulkifli", "Muhammad Hafiz", "Mohd Azrul", "Khairul Anuar", "Shahrul Nizam", "Mohd Firdaus", "Amirul Hakim", "Syed Hazwan", "Mohd Rizal", "Azman", "Hairi"];
const MALAY_F = ["Nurul Aina", "Siti Hajar", "Nor Azlina", "Farah Wahida", "Nurul Izzah", "Aisyah", "Rohana", "Nur Syafiqah"];
const MALAY_FATHER = ["Ahmad", "Rosli", "Hassan", "Kamarudin", "Ismail", "Othman", "Abdullah", "Yusof", "Hamid", "Jaafar", "Salleh", "Mat Isa"];
const CHINESE = ["Tan Wei Liang", "Lim Chee Keong", "Wong Mei Ling", "Ng Kah Hoe", "Chong Siew Yin", "Lee Jun Hao", "Ooi Boon Kiat", "Teh Pei Shan", "Goh Chin Wei", "Yap Soon Huat", "Low Kai Xuan"];
const INDIAN_M = ["Muthu", "Saravanan", "Rajesh", "Kumaresan", "Vinod", "Ganesan"];
const INDIAN_F = ["Kavitha", "Thilagavathy", "Priya", "Sharmila"];
const INDIAN_FATHER = ["Ramasamy", "Subramaniam", "Krishnan", "Muniandy", "Arumugam", "Raman"];
const FOREIGN = ["Rahim Uddin", "Min Thant Zaw", "Bishnu Tamang", "Aung Ko Ko", "Md Shohel Rana", "Hari Bahadur Gurung"];

function personName(contract: boolean): string {
  if (contract && rand() < 0.6) return pick(FOREIGN);
  const r = rand();
  if (r < 0.34) return `${pick(MALAY_M)} bin ${pick(MALAY_FATHER)}`;
  if (r < 0.52) return `${pick(MALAY_F)} binti ${pick(MALAY_FATHER)}`;
  if (r < 0.8) return pick(CHINESE);
  if (r < 0.92) return `${pick(INDIAN_M)} a/l ${pick(INDIAN_FATHER)}`;
  return `${pick(INDIAN_F)} a/p ${pick(INDIAN_FATHER)}`;
}

function emailFor(name: string, staffNo: string): string {
  const base = name
    .replace(/\b(bin|binti|a\/l|a\/p|mohd|muhammad|md)\b/gi, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(".")
    .toLowerCase()
    .replace(/[^a-z.]/g, "");
  return `${base || staffNo}@phn.com.my`;
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const POSITIONS: Record<Designation, string[]> = {
  MANAGER: ["Manager", "Assistant Manager", "Senior Manager"],
  EXECUTIVE: ["Engineer", "Senior Engineer", "Executive", "Senior Executive"],
  NON_EXECUTIVE: ["Technician", "Production Operator", "Line Leader", "Clerk", "Inspector", "Senior Technician"],
  CONTRACT: ["Production Operator"],
  TRAINEE: ["Graduate Trainee", "Industrial Trainee"],
};

type DeptSpec = {
  name: string;
  short: string;
  sections: string[];
  mix: Partial<Record<Designation, number>>;
  noHod?: boolean;
};

const ORG: { name: string; short: string; departments: DeptSpec[] }[] = [
  {
    name: "Manufacturing",
    short: "MFG",
    departments: [
      { name: "Stamping", short: "STP", sections: ["Press Line A", "Press Line B", "Die Setting"], mix: { MANAGER: 1, EXECUTIVE: 3, NON_EXECUTIVE: 12, CONTRACT: 9 } },
      { name: "Welding & Assembly", short: "WLD", sections: ["Robotic Welding", "Spot Welding", "Sub-Assembly"], mix: { MANAGER: 1, EXECUTIVE: 3, NON_EXECUTIVE: 10, CONTRACT: 8 } },
      { name: "Production Planning & Control", short: "PPC", sections: ["Planning", "Store & Logistics"], mix: { MANAGER: 1, EXECUTIVE: 2, NON_EXECUTIVE: 5 } },
      { name: "Maintenance", short: "MTN", sections: ["Mechanical", "Electrical"], mix: { MANAGER: 1, EXECUTIVE: 2, NON_EXECUTIVE: 6 } },
    ],
  },
  {
    name: "Engineering",
    short: "ENG",
    departments: [
      { name: "Die Engineering", short: "DIE", sections: ["Die Design", "Tryout"], mix: { MANAGER: 1, EXECUTIVE: 4, NON_EXECUTIVE: 3, TRAINEE: 2 } },
      { name: "Product Engineering", short: "PED", sections: [], mix: { MANAGER: 1, EXECUTIVE: 4, TRAINEE: 1 } },
      { name: "Tooling Workshop", short: "TWS", sections: [], mix: { EXECUTIVE: 1, NON_EXECUTIVE: 5 }, noHod: true },
    ],
  },
  {
    name: "Quality",
    short: "QLT",
    departments: [
      { name: "Quality Assurance", short: "QA", sections: ["Supplier Quality", "Customer Quality"], mix: { MANAGER: 1, EXECUTIVE: 4, NON_EXECUTIVE: 2 } },
      { name: "Quality Control", short: "QC", sections: ["Incoming Inspection", "In-Process", "Final Inspection"], mix: { MANAGER: 1, EXECUTIVE: 2, NON_EXECUTIVE: 8, CONTRACT: 3 } },
    ],
  },
  {
    name: "Corporate Services",
    short: "CSV",
    departments: [
      { name: "Human Resources & Administration", short: "HRA", sections: ["Human Resources", "Learning & Development", "General Affairs"], mix: { MANAGER: 1, EXECUTIVE: 4, NON_EXECUTIVE: 3 } },
      { name: "Finance & Accounts", short: "FIN", sections: [], mix: { MANAGER: 1, EXECUTIVE: 3, NON_EXECUTIVE: 2 } },
      { name: "Purchasing", short: "PUR", sections: [], mix: { MANAGER: 1, EXECUTIVE: 2, NON_EXECUTIVE: 1 } },
      { name: "Information Technology", short: "IT", sections: [], mix: { MANAGER: 1, EXECUTIVE: 2 } },
    ],
  },
];

const DEMO_PASSWORD = "Ldms@2026";

async function main() {
  await db.setting.upsert({
    where: { key: "tna.year" },
    update: {},
    create: { key: "tna.year", value: 2026 },
  });
  await db.setting.upsert({
    where: { key: "mail.testMode" },
    update: {},
    create: { key: "mail.testMode", value: { enabled: true, address: "ldms-test@phn.com.my" } },
  });

  if ((await db.staff.count()) > 0) console.log("Staff table is not empty, skipping demo staff.");
  else await seedStaff();

  if ((await db.training.count()) > 0) console.log("Training table is not empty, skipping demo trainings.");
  else await seedTrainings();
  await classifyDemoTrainings();

  if ((await db.participant.count()) > 0) console.log("Participant table is not empty, skipping demo participants.");
  else await seedParticipants();
  await answerDemoFeedback();

  // PMEs for the executives and managers who completed a training (phase 3). Adds only what is missing.
  const pmes = await db.$transaction((tx) => syncPmes(tx, { training: { type: { not: "OJT" } } }), { timeout: 120_000 });
  if (pmes.created) console.log(`Made ${pmes.created} PMEs.`);
}

// Demo answers for seeded feedback: participants with a feedback date but no
// answers (as the participant seed made them before My Training existed) get
// a plausible set, so a submitted form can be seen. So do seeded OJT answers
// in the draft shape used before the old OJT form's wording was confirmed on
// 1 Oct 2026 (a written a2 instead of a rating), and course answers to the
// placeholder questions used before the real form was taken from the old
// system on 12 Oct 2026. Rows with answers in the current shape are left
// alone, so this can run on every seed.
async function answerDemoFeedback() {
  seed = 20261001;
  const submitted = await db.participant.findMany({
    where: { submittedAt: { not: null } },
    select: { id: true, feedback: true, training: { select: { type: true } } },
  });
  const rows = submitted.filter((r) => {
    if (r.feedback === null) return true;
    const given = r.feedback as Record<string, unknown>;
    if (r.training.type === "OJT") return typeof given.a2 !== "number";
    // Answers to the placeholder course questions used until 12 Oct 2026: a rating where the real form has yes/no.
    return typeof given.q12 === "number";
  });
  const BENEFIT = ["The hands-on part", "Real examples from our line", "Clear checklists to take back"];
  const SHORT = ["Apply the checklist on my line this month", "Brief my team on what I learned", "Update our work instruction"];
  const LONG = ["Train a second person in the section", "Reduce rework on our line", "Take the next level of this course"];
  const SUGGEST = ["More time for practice", "Smaller groups", "None"];
  const LEARNED = ["The steps and the safety checks for the task", "Setting the machine up on my own", "Reading the work instruction and checking the first piece"];
  for (const r of rows) {
    const score = () => 3 + Math.floor(rand() * 3); // 3–5
    const before = 1 + Math.floor(rand() * 3); // 1–3
    const answers =
      r.training.type === "OJT"
        ? { a1: pick(LEARNED), a2: before, a3: Math.min(5, before + 1 + Math.floor(rand() * 2)) }
        : {
            ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i + 1}`, score()])),
            q12: rand() < 0.85 ? "YES" : "NO",
            q13: pick(BENEFIT),
            q14: pick(SHORT),
            q15: pick(LONG),
            q16: pick(SUGGEST),
          };
    await db.participant.update({ where: { id: r.id }, data: { feedback: answers, feedbackVersion: 1 } });
  }
  if (rows.length) console.log(`Added demo answers to ${rows.length} seeded feedback forms.`);
}

async function seedStaff() {
  const demoHash = await hash(DEMO_PASSWORD);
  let permanentNo = 10231;
  let contractNo = 2041;
  let traineeNo = 311;

  for (const div of ORG) {
    const division = await db.division.create({ data: { name: div.name, shortName: div.short } });

    for (const spec of div.departments) {
      const department = await db.department.create({
        data: { name: spec.name, shortName: spec.short, divisionId: division.id },
      });
      const sections = await Promise.all(
        spec.sections.map((name) => db.section.create({ data: { name, departmentId: department.id } })),
      );

      let hodId: number | null = null;
      for (const [designation, count] of Object.entries(spec.mix) as [Designation, number][]) {
        for (let i = 0; i < count; i++) {
          const contract = designation === "CONTRACT";
          const staffNo = contract
            ? `C${contractNo++}`
            : designation === "TRAINEE"
              ? `T0${traineeNo++}`
              : String(permanentNo++);
          const name = personName(contract);
          const resigned = rand() < 0.07 && designation !== "MANAGER";
          const joinedYear = designation === "TRAINEE" ? 2026 : 2008 + Math.floor(rand() * 18);
          const dateJoined = new Date(Date.UTC(joinedYear, Math.floor(rand() * 12), 1 + Math.floor(rand() * 27)));
          const hasEmail = designation === "MANAGER" || designation === "EXECUTIVE" || (designation === "NON_EXECUTIVE" && rand() < 0.25);

          const staff = await db.staff.create({
            data: {
              staffNo,
              name,
              email: hasEmail ? emailFor(name, staffNo) : null,
              position: designation === "MANAGER" && i === 0 ? `Manager, ${spec.name}` : pick(POSITIONS[designation]),
              designation,
              status: resigned ? "RESIGNED" : "ACTIVE",
              dateJoined,
              dateResigned: resigned ? new Date(Date.UTC(2026, Math.floor(rand() * 8), 1 + Math.floor(rand() * 27))) : null,
              departmentId: department.id,
              sectionId: sections.length && designation !== "MANAGER" ? pick(sections).id : null,
              // Everyone else signs in with a migrated MD5 password, as they will after cutover.
              legacyMd5: md5("phn12345"),
            },
          });
          if (designation === "MANAGER" && hodId === null && !spec.noHod) hodId = staff.id;
        }
      }
      if (hodId) await db.department.update({ where: { id: department.id }, data: { hodId } });
    }

    // Division head: a senior manager placed in the first department of the division.
    const firstDept = await db.department.findFirstOrThrow({ where: { divisionId: division.id }, orderBy: { id: "asc" } });
    const head = await db.staff.create({
      data: {
        staffNo: String(permanentNo++),
        name: personName(false),
        position: `General Manager, ${div.name}`,
        designation: "MANAGER",
        departmentId: firstDept.id,
        dateJoined: new Date(Date.UTC(2004 + Math.floor(rand() * 6), 2, 1)),
        legacyMd5: md5("phn12345"),
      },
    });
    await db.staff.update({ where: { id: head.id }, data: { email: emailFor(head.name, head.staffNo) } });
    await db.division.update({ where: { id: division.id }, data: { headId: head.id } });
  }

  // Demo sign-ins with known passwords.
  const hra = await db.department.findFirstOrThrow({ where: { shortName: "HRA" }, include: { sections: true } });
  const ldSection = hra.sections.find((s) => s.name === "Learning & Development")!;
  const stamping = await db.department.findFirstOrThrow({ where: { shortName: "STP" } });

  const accounts: { staffNo: string; name: string; position: string; designation: Designation; departmentId: number; sectionId?: number; roles: RoleCode[] }[] = [
    { staffNo: "10001", name: "Nor Azlina binti Hamid", position: "Senior Executive, Learning & Development", designation: "EXECUTIVE", departmentId: hra.id, sectionId: ldSection.id, roles: ["LD_ADMIN"] },
    { staffNo: "10002", name: "Farah Wahida binti Yusof", position: "Clerk, Learning & Development", designation: "NON_EXECUTIVE", departmentId: hra.id, sectionId: ldSection.id, roles: ["MAIN_CLERK"] },
    { staffNo: "10003", name: "Ooi Boon Kiat", position: "Clerk, Production", designation: "NON_EXECUTIVE", departmentId: stamping.id, roles: ["CLERK"] },
  ];
  for (const a of accounts) {
    await db.staff.create({
      data: {
        staffNo: a.staffNo,
        name: a.name,
        email: emailFor(a.name, a.staffNo),
        position: a.position,
        designation: a.designation,
        departmentId: a.departmentId,
        sectionId: a.sectionId,
        dateJoined: new Date(Date.UTC(2017, 3, 3)),
        passwordHash: demoHash,
        roles: { create: a.roles.map((role) => ({ role })) },
      },
    });
  }
  // The Stamping HOD also gets the demo password so the HOD view can be tried.
  if (stamping.hodId) await db.staff.update({ where: { id: stamping.hodId }, data: { passwordHash: demoHash, legacyMd5: null } });

  const count = await db.staff.count();
  const hod = stamping.hodId ? await db.staff.findUnique({ where: { id: stamping.hodId } }) : null;
  console.log(`Seeded ${count} staff.`);
  console.log(`Sign in with password ${DEMO_PASSWORD}: 10001 (L&D admin), 10002 (main clerk), 10003 (clerk)${hod ? `, ${hod.staffNo} (HOD Stamping)` : ""}.`);
  console.log(`Everyone else has the migrated MD5 password "phn12345", upgraded to argon2 on first sign-in.`);
}

// ---------- Trainings ----------

// Program, function and platform of each demo training, by title. Also fills
// them in on demo trainings seeded before these fields existed.
const DEMO_CLASSIFICATION: Record<string, [TrainingProgram, TrainingFunction, TrainingPlatform]> = {
  "ISO 9001:2015 Internal Auditor": ["EXTERNAL_PUBLIC", "BUSINESS", "PHYSICAL"],
  "Power Press Safety": ["INTERNAL_INTERNAL_TRAINER", "BUSINESS", "PHYSICAL"],
  "5S Workplace Organisation": ["INTERNAL_INTERNAL_TRAINER", "PERSONAL_EFFECTIVENESS", "PHYSICAL"],
  "Forklift Operation Licence": ["EXTERNAL_PUBLIC", "BUSINESS", "PHYSICAL"],
  "Spot Welding Parameter Setting": ["INTERNAL_INTERNAL_TRAINER", "BUSINESS", "PHYSICAL"],
  "IATF 16949 Awareness": ["INTERNAL_INTERNAL_TRAINER", "BUSINESS", "PHYSICAL"],
  "Die Maintenance Basics": ["INTERNAL_INTERNAL_TRAINER", "BUSINESS", "PHYSICAL"],
  "Excel for Production Reporting": ["INTERNAL_INTERNAL_TRAINER", "DIGITAL", "PHYSICAL"],
  "Industrial Energy Management": ["EXTERNAL_PUBLIC", "BUSINESS", "PHYSICAL"],
  "Chemical Handling and SDS": ["INTERNAL_EXTERNAL_TRAINER", "BUSINESS", "PHYSICAL"],
  "Advanced Product Quality Planning (APQP) and PPAP": ["EXTERNAL_PUBLIC", "BUSINESS", "ONLINE"],
  "Lockout Tagout (LOTO)": ["INTERNAL_INTERNAL_TRAINER", "BUSINESS", "PHYSICAL"],
};

async function classifyDemoTrainings() {
  let n = 0;
  for (const [title, [program, fn, platform]] of Object.entries(DEMO_CLASSIFICATION)) {
    const r = await db.training.updateMany({ where: { title, program: null }, data: { program, function: fn, platform } });
    n += r.count;
  }
  if (n) console.log(`Set program, function and platform on ${n} demo trainings.`);

  // Internal-trainer trainings name a real executive or manager: the staff
  // member with the same name if there is one, otherwise the most senior
  // person in the organising department (or L&D for company-wide ones).
  const unlinked = await db.training.findMany({ where: { program: "INTERNAL_INTERNAL_TRAINER", trainerStaffId: null } });
  const eligible: Prisma.StaffWhereInput = { status: "ACTIVE", designation: { in: ["EXECUTIVE", "MANAGER"] } };
  const hra = await db.department.findFirst({ where: { shortName: "HRA" } });
  for (const t of unlinked) {
    const trainer =
      (t.trainerName ? await db.staff.findFirst({ where: { ...eligible, name: t.trainerName } }) : null) ??
      (await db.staff.findFirst({ where: { ...eligible, departmentId: t.departmentId ?? hra?.id }, orderBy: [{ designation: "desc" }, { staffNo: "asc" }] }));
    if (trainer) await db.training.update({ where: { id: t.id }, data: { trainerStaffId: trainer.id, trainerName: trainer.name } });
  }
  if (unlinked.length) console.log(`Linked ${unlinked.length} internal-trainer demo trainings to staff.`);
}

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const time = (s: string) => new Date(`1970-01-01T${s}:00Z`);

async function seedTrainings() {
  const admin = await db.staff.findUnique({ where: { staffNo: "10001" } });
  const dept = async (short: string) => (await db.department.findFirst({ where: { shortName: short } }))?.id ?? null;
  const [hra, stp, wld, mtn, qa] = await Promise.all(["HRA", "STP", "WLD", "MTN", "QA"].map(dept));

  type Spec = Omit<Prisma.TrainingCreateInput, "startDate" | "endDate" | "startTime" | "endTime" | "department" | "sessions" | "trainingCode"> & {
    dates: [string, string];
    times: [string, string];
    departmentId?: number | null;
    sessions?: [string, string, string][];
  };
  const specs: Spec[] = [
    { type: "PUBLIC_INHOUSE", title: "ISO 9001:2015 Internal Auditor", code: "QMS-IA-01", provider: "SIRIM QAS International", trainerName: "Ir. Lim Boon Huat", venue: "SIRIM, Shah Alam", category: "Quality", hrdfClaimable: true, cost: "3800.00", dates: ["2025-03-11", "2025-03-12"], times: ["09:00", "17:00"], description: "Planning, conducting and reporting internal audits against ISO 9001:2015." },
    { type: "PUBLIC_INHOUSE", title: "Power Press Safety", provider: "PHN Safety & Health Committee", trainerName: "Mohd Rizal bin Hassan", venue: "Training Room 2", category: "Safety", dates: ["2025-05-20", "2025-05-20"], times: ["08:30", "17:30"], departmentId: stp },
    { type: "PUBLIC_INHOUSE", title: "5S Workplace Organisation", provider: "PHN Industry", trainerName: "Tan Wei Liang", venue: "Training Room 1", category: "Productivity", dates: ["2025-08-14", "2025-08-14"], times: ["08:30", "12:30"] },
    { type: "PUBLIC_INHOUSE", title: "Forklift Operation Licence", code: "DOSH-FL", provider: "Safety Pro Training Sdn Bhd", venue: "Klang", category: "Safety", hrdfClaimable: true, cost: "1450.00", dates: ["2025-10-07", "2025-10-08"], times: ["08:30", "17:30"] },
    { type: "OJT", ojtMethod: "OJT", title: "Spot Welding Parameter Setting", trainerName: "Chong Siew Yin", venue: "Spot Welding cell 3", category: "Technical", dates: ["2025-11-18", "2025-11-18"], times: ["09:00", "12:00"], departmentId: wld },
    { type: "PUBLIC_INHOUSE", title: "IATF 16949 Awareness", code: "IATF-AW", provider: "PHN Quality Assurance", trainerName: "Wong Mei Ling", venue: "Training Room 1", category: "Quality", dates: ["2026-01-21", "2026-01-21"], times: ["08:30", "12:30"], departmentId: qa },
    { type: "OJT", ojtMethod: "OJT", title: "Die Maintenance Basics", trainerName: "Muthu a/l Ramasamy", venue: "Tooling Workshop", category: "Technical", dates: ["2026-02-10", "2026-02-12"], times: ["14:00", "17:00"], departmentId: mtn },
    { type: "PUBLIC_INHOUSE", title: "Excel for Production Reporting", provider: "HRA, Learning & Development", trainerName: "Nor Azlina binti Hamid", venue: "Computer Lab", category: "IT skills", dates: ["2026-03-04", "2026-03-06"], times: ["09:00", "12:00"], departmentId: hra },
    { type: "PUBLIC_INHOUSE", title: "Industrial Energy Management", provider: "Malaysian Green Technology Corporation", venue: "Bangi", category: "Engineering", hrdfClaimable: true, cost: "2200.00", dates: ["2026-06-16", "2026-06-17"], times: ["09:00", "17:00"], status: "CANCELLED" },
    { type: "PUBLIC_INHOUSE", title: "Chemical Handling and SDS", provider: "PHN Safety & Health Committee", trainerName: "Siti Hajar binti Ismail", venue: "Training Room 2", category: "Safety", dates: ["2026-09-08", "2026-09-08"], times: ["08:30", "12:30"] },
    { type: "PUBLIC_INHOUSE", title: "Advanced Product Quality Planning (APQP) and PPAP", code: "AIAG-APQP", provider: "Automotive Quality Academy", venue: "Online", category: "Quality", hrdfClaimable: true, cost: "2650.00", dates: ["2026-10-20", "2026-10-21"], times: ["09:00", "17:00"] },
    { type: "PUBLIC_INHOUSE", title: "Lockout Tagout (LOTO)", provider: "PHN Safety & Health Committee", trainerName: "Mohd Rizal bin Hassan", venue: "Training Room 2", category: "Safety", dates: ["2026-11-12", "2026-11-12"], times: ["08:30", "17:30"] },
  ];

  for (const { dates, times, departmentId, sessions, ...rest } of specs) {
    await db.training.create({
      data: {
        ...rest,
        trainingCode: trainingCode(rest.type, new Date(Date.now() + 8 * 3600_000), randomInt(1_000_000)),
        startDate: day(dates[0]),
        endDate: day(dates[1]),
        startTime: time(times[0]),
        endTime: time(times[1]),
        createdById: admin?.id,
        department: departmentId ? { connect: { id: departmentId } } : undefined,
        sessions: sessions ? { create: sessions.map(([date, start, end]) => ({ date: day(date), startTime: time(start), endTime: time(end) })) } : undefined,
      },
    });
  }
  console.log(`Seeded ${specs.length} trainings.`);
}

// Participants for the demo trainings: trainings that have ended are mostly
// completed (some absent, one or two marked completed by L&D), upcoming ones
// pending. Staff come from the organising department when there is one.
async function seedParticipants() {
  seed = 20260930; // independent of how many staff the staff seed drew
  const admin = await db.staff.findUnique({ where: { staffNo: "10001" } });
  const today = new Date(Date.now() + 8 * 3600 * 1000);
  const trainings = await db.training.findMany({ orderBy: { startDate: "asc" } });
  const active = await db.staff.findMany({ where: { status: "ACTIVE" }, select: { id: true, departmentId: true }, orderBy: { id: "asc" } });
  // The Stamping HOD is a demo sign-in; give them some history to look at.
  const hod = await db.department.findFirst({ where: { shortName: "STP" }, select: { hodId: true } });
  const ABSENT_REASONS = ["Medical leave", "Emergency leave", "Production urgent order", null];
  let n = 0;
  for (const t of trainings) {
    const pool = t.departmentId ? active.filter((s) => s.departmentId === t.departmentId) : active;
    const size = Math.min(pool.length, 5 + Math.floor(rand() * 10));
    const chosen = new Set<number>();
    while (chosen.size < size) chosen.add(pick(pool).id);
    if (hod?.hodId && rand() < 0.5) chosen.add(hod.hodId);
    const ended = t.endDate.getTime() <= today.getTime();
    for (const staffId of chosen) {
      const r = rand();
      let data: Prisma.ParticipantCreateManyInput = { trainingId: t.id, staffId, recordedById: admin?.id, source: t.type === "OJT" ? "CLERK" : "ADMIN" };
      if (ended && t.status !== "CANCELLED") {
        if (r < 0.12) data = { ...data, attendance: "ABSENT", attendanceReason: pick(ABSENT_REASONS) };
        else if (r < 0.2) data = { ...data, attendance: "PENDING" }; // feedback not given yet
        else if (r < 0.26) data = { ...data, attendance: "COMPLETED", attendanceReason: "No computer access; marked by L&D" };
        else {
          const submitted = new Date(t.endDate.getTime() + Math.floor(rand() * 10) * 86_400_000 + 9 * 3600 * 1000);
          data = { ...data, attendance: "COMPLETED", submittedAt: submitted };
        }
      }
      await db.participant.create({ data });
      n++;
    }
  }
  console.log(`Seeded ${n} participants.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
