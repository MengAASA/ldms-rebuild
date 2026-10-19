import { describe, expect, it } from "vitest";
import {
  cleanDate,
  cleanMd5,
  cleanShortName,
  cleanStaffNo,
  cleanText,
  cleanTime,
  databaseAddress,
  importTargetBlock,
  isDeletedDepartment,
  isReadOnlySql,
  keptDuplicate,
  keptPme,
  mapAttendance,
  mapDesignation,
  mapFeedback,
  mapFunction,
  mapGender,
  mapHrdc,
  mapJobGrade,
  mapOjtAnswers,
  mapOjtTrainer,
  mapPmeAnswers,
  mapPmeStatus,
  mapOldRoles,
  mapPlatform,
  mapProgram,
  mapSkillRating,
  mapSkillSection,
  mapSkillStatus,
  mapStaffStatus,
  NOT_COMPLETED_REASON,
  oldOjtCode,
  oldPasswordShared,
  partsToRun,
  pmeStatusForTraining,
  yearBucket,
} from "@/server/rules/import";

const OLD = "mysql://reader:secret@localhost:3306/old_ldms";
const LIVE = "mysql://ldms:secret@localhost:3306/ldms_v2_live";
const APP = "mysql://ldms:secret@localhost:3306/ldms_v2";

describe("where the import may run", () => {
  it("reads the server and database from a connection string", () => {
    expect(databaseAddress(OLD)).toEqual({ host: "localhost", port: "3306", database: "old_ldms" });
    expect(databaseAddress('"mysql://u:p@DB.example.com/Ldms_V2?connection_limit=5"')).toEqual({ host: "db.example.com", port: "3306", database: "ldms_v2" });
    expect(databaseAddress("mysql://u:p@127.0.0.1:3307/x")).toEqual({ host: "localhost", port: "3307", database: "x" });
  });
  it("can't read a missing or foreign address", () => {
    for (const url of [undefined, "", "not a url", "postgres://u:p@localhost/x", "mysql://u:p@localhost/"]) expect(databaseAddress(url)).toBeNull();
  });
  it("starts when the old database, the one being filled and the app's are three different databases", () => {
    expect(importTargetBlock({ old: OLD, target: LIVE, app: APP })).toBeNull();
  });
  it("refuses without both addresses", () => {
    expect(importTargetBlock({ old: undefined, target: LIVE, app: APP })).toContain("OLD_DATABASE_URL");
    expect(importTargetBlock({ old: OLD, target: "", app: APP })).toContain("IMPORT_DATABASE_URL");
  });
  it("never fills the old database", () => {
    expect(importTargetBlock({ old: OLD, target: OLD, app: APP })).toContain("same database");
    // The same database under another sign-in or spelling is still the same database.
    expect(importTargetBlock({ old: OLD, target: "mysql://root:x@127.0.0.1/OLD_LDMS", app: APP })).toContain("same database");
  });
  it("never fills the database the app and the tests use", () => {
    expect(importTargetBlock({ old: OLD, target: APP, app: APP })).toContain("DATABASE_URL");
  });
  it("refuses when the app itself points at the old database", () => {
    expect(importTargetBlock({ old: OLD, target: LIVE, app: OLD })).toContain("must have its own");
  });
  it("is fine on another server with the same database name", () => {
    expect(importTargetBlock({ old: "mysql://u:p@old-server/ldms", target: "mysql://u:p@new-server/ldms", app: APP })).toBeNull();
  });
});

describe("the old database is only read", () => {
  it("lets a single SELECT through", () => {
    expect(isReadOnlySql("SELECT id, name FROM divisions ORDER BY id")).toBe(true);
    expect(isReadOnlySql("  select count(*) n from user;  ")).toBe(true);
  });
  it("refuses anything that writes, locks or runs a second statement", () => {
    for (const sql of [
      "UPDATE user SET status = 'RESIGN'",
      "DELETE FROM ojt",
      "TRUNCATE tna",
      "DROP TABLE user",
      "INSERT INTO user (id) VALUES (1)",
      "SELECT 1; DELETE FROM ojt",
      "SELECT * FROM user INTO OUTFILE '/tmp/x'",
      "SELECT * FROM user FOR UPDATE",
      "CALL something()",
      "SET FOREIGN_KEY_CHECKS = 0",
    ])
      expect(isReadOnlySql(sql)).toBe(false);
  });
});

describe("the parts of the import", () => {
  it("runs every part when none is named", () => {
    expect(partsToRun(undefined)).toEqual(["org", "staff", "training", "ojt", "pme", "skill"]);
  });
  it("runs the named part and those that depend on it", () => {
    expect(partsToRun("org")).toEqual(["org", "staff", "training", "ojt", "pme", "skill"]);
    expect(partsToRun("staff")).toEqual(["staff", "training", "ojt", "pme", "skill"]);
    expect(partsToRun("training")).toEqual(["training", "ojt", "pme", "skill"]);
    expect(partsToRun("ojt")).toEqual(["ojt", "pme", "skill"]);
    expect(partsToRun("pme")).toEqual(["pme", "skill"]);
    expect(partsToRun("skill")).toEqual(["skill"]);
  });
  it("doesn't know a made-up part", () => {
    expect(partsToRun("everything")).toBeNull();
  });
});

describe("old text", () => {
  it("trims it and makes runs of spaces one", () => {
    expect(cleanText("  Press   Line\tA \n", 120)).toEqual({ value: "Press Line A", cut: false });
  });
  it("treats blank as nothing", () => {
    for (const v of [null, undefined, "", "   "]) expect(cleanText(v, 120)).toEqual({ value: null, cut: false });
  });
  it("says when it had to cut", () => {
    expect(cleanText("abcdefgh", 5)).toEqual({ value: "abcde", cut: true });
    expect(cleanText("abcde", 5)).toEqual({ value: "abcde", cut: false });
  });
  it("puts a short name in capitals", () => {
    expect(cleanShortName(" stp ")).toEqual({ value: "STP", cut: false });
    expect(cleanShortName("")).toEqual({ value: null, cut: false });
  });
});

describe("departments the old system marks as deleted", () => {
  it("knows one by the (DELETED) in front of its name", () => {
    expect(isDeletedDepartment("(DELETED) OPERATION RASA & SERENDAH")).toBe(true);
    expect(isDeletedDepartment(" (deleted) Old Store")).toBe(true);
  });
  it("leaves every other department alone", () => {
    for (const name of ["HOP RASA", "DELETED RECORDS", "ARCHIVE (DELETED)", "", null, undefined]) expect(isDeletedDepartment(name)).toBe(false);
  });
});

describe("old staff records", () => {
  it("maps the five designations", () => {
    expect(mapDesignation("NON EXECUTIVE")).toBe("NON_EXECUTIVE");
    expect(mapDesignation("EXECUTIVE")).toBe("EXECUTIVE");
    expect(mapDesignation("MANAGER (AM/HOS & ABOVE)")).toBe("MANAGER");
    expect(mapDesignation(" contract ")).toBe("CONTRACT");
    expect(mapDesignation("TRAINEE")).toBe("TRAINEE");
  });
  it("doesn't guess a designation it doesn't know", () => {
    for (const v of ["SUPERVISOR", "", null, undefined, 3]) expect(mapDesignation(v)).toBeNull();
  });
  it("counts a blank status as active, as the old system does, and says it was blank", () => {
    expect(mapStaffStatus("ACTIVE")).toEqual({ status: "ACTIVE", blank: false });
    expect(mapStaffStatus("RESIGN")).toEqual({ status: "RESIGNED", blank: false });
    expect(mapStaffStatus("")).toEqual({ status: "ACTIVE", blank: true });
    expect(mapStaffStatus(null)).toEqual({ status: "ACTIVE", blank: true });
  });
  it("doesn't guess a status it doesn't know", () => {
    expect(mapStaffStatus("SUSPENDED")).toBeNull();
  });
  it("reads gender, and leaves it out when it isn't given", () => {
    expect(mapGender("MALE")).toBe("MALE");
    expect(mapGender("female")).toBe("FEMALE");
    for (const v of ["", null, "M", "OTHER"]) expect(mapGender(v)).toBeNull();
  });
  it("keeps job grades 1 to 5 and drops the old 0", () => {
    expect([1, 3, 5].map(mapJobGrade)).toEqual([1, 3, 5]);
    for (const v of [0, 6, -1, 2.5, null, "3"]) expect(mapJobGrade(v)).toBeNull();
  });
  it("keeps a staff number as people type it, in capitals", () => {
    expect(cleanStaffNo(" ka1234 ")).toEqual({ value: "KA1234", unusual: false });
    expect(cleanStaffNo("10-231")).toEqual({ value: "10-231", unusual: false });
  });
  it("imports an unusual staff number as it is, and says so", () => {
    expect(cleanStaffNo("KA 1234")).toEqual({ value: "KA 1234", unusual: true });
    expect(cleanStaffNo("A1")).toEqual({ value: "A1", unusual: true });
  });
  it("has no staff number to give when it is blank or too long", () => {
    expect(cleanStaffNo("   ").value).toBeNull();
    expect(cleanStaffNo("X".repeat(21)).value).toBeNull();
    expect(cleanStaffNo(null).value).toBeNull();
  });
  it("carries only a real MD5 value", () => {
    expect(cleanMd5("5F4DCC3B5AA765D61D8327DEB882CF99")).toBe("5f4dcc3b5aa765d61d8327deb882cf99");
    for (const v of ["", null, "password", "5f4dcc3b5aa765d61d8327deb882cf9", "zz4dcc3b5aa765d61d8327deb882cf99"]) expect(cleanMd5(v)).toBeNull();
  });
  it("reads a date, and refuses a zero date or a day that doesn't exist", () => {
    expect(cleanDate("2019-03-04")?.toISOString()).toBe("2019-03-04T00:00:00.000Z");
    expect(cleanDate("2024-02-29 00:00:00")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    for (const v of ["0000-00-00", "2023-02-30", "2023-13-01", "0006-01-01", "", null, "soon"]) expect(cleanDate(v)).toBeNull();
  });
});

describe("old roles", () => {
  it("makes an old admin an L&D admin", () => {
    expect(mapOldRoles("ADMIN", "")).toEqual({ roles: ["LD_ADMIN"], fillsOwnTna: false, markedHod: false, unknown: [] });
    expect(mapOldRoles("ADMIN", "ADMIN").roles).toEqual(["LD_ADMIN"]);
  });
  it("makes every old clerk a main clerk", () => {
    expect(mapOldRoles("CLERK", "MAIN").roles).toEqual(["MAIN_CLERK"]);
  });
  it("reads office as filling in their own TNA, and HOD as a mark only", () => {
    expect(mapOldRoles("", "OFFICE")).toEqual({ roles: [], fillsOwnTna: true, markedHod: false, unknown: [] });
    expect(mapOldRoles(null, "HOD")).toEqual({ roles: [], fillsOwnTna: false, markedHod: true, unknown: [] });
  });
  it("gives nothing to someone with neither", () => {
    expect(mapOldRoles(null, null)).toEqual({ roles: [], fillsOwnTna: false, markedHod: false, unknown: [] });
  });
  it("hands back a word it doesn't know instead of guessing", () => {
    expect(mapOldRoles("SUPERUSER", "VIP")).toEqual({ roles: [], fillsOwnTna: false, markedHod: false, unknown: ["roletype SUPERUSER", "usertype VIP"] });
  });
});

describe("old passwords", () => {
  it("are shared when others have the same one", () => {
    expect(oldPasswordShared(2938)).toBe(true);
    expect(oldPasswordShared(2)).toBe(true);
  });
  it("are the person's own when no one else has it", () => {
    expect(oldPasswordShared(1)).toBe(false);
  });
});

describe("old trainings", () => {
  it("maps the program, function, platform and HRDC words", () => {
    expect(mapProgram("EXT")).toEqual({ value: "EXTERNAL_PUBLIC", known: true });
    expect(mapProgram(" intx ")).toEqual({ value: "INTERNAL_EXTERNAL_TRAINER", known: true });
    expect(mapProgram("INTI")).toEqual({ value: "INTERNAL_INTERNAL_TRAINER", known: true });
    expect(mapFunction("PERSONAL  EFFECTIVENESS")).toEqual({ value: "PERSONAL_EFFECTIVENESS", known: true });
    expect(mapPlatform("ONLINE")).toEqual({ value: "ONLINE", known: true });
    expect(mapHrdc("YES")).toEqual({ value: true, known: true });
    expect(mapHrdc("NO")).toEqual({ value: false, known: true });
  });
  it("leaves a blank one blank, and says so apart from a word it doesn't know", () => {
    expect(mapFunction("")).toEqual({ value: null, known: true });
    expect(mapHrdc(null)).toEqual({ value: null, known: true });
    expect(mapProgram("DEPARTMENTAL")).toEqual({ value: null, known: false });
    expect(mapPlatform("HYBRID")).toEqual({ value: null, known: false });
  });
  it("reads a time as Prisma stores it", () => {
    expect(cleanTime("08:30:00")?.toISOString()).toBe("1970-01-01T08:30:00.000Z");
    expect(cleanTime("17:30")?.toISOString()).toBe("1970-01-01T17:30:00.000Z");
    expect(cleanTime("24:00:00")).toBeNull();
    expect(cleanTime(null)).toBeNull();
  });
});

describe("old attendance", () => {
  it("maps completed and absent", () => {
    expect(mapAttendance("COMPLETED", 2024)).toEqual({ attendance: "COMPLETED", reason: null, blank: false });
    expect(mapAttendance("COMPLETEDOJT", 2026)).toEqual({ attendance: "COMPLETED", reason: null, blank: false });
    expect(mapAttendance("ABSENT", 2026)).toEqual({ attendance: "ABSENT", reason: null, blank: false });
  });
  it("leaves this year's blank attendance pending, so the person can still complete it (decision 8)", () => {
    expect(mapAttendance(null, 2026)).toEqual({ attendance: "PENDING", reason: null, blank: true });
    expect(mapAttendance("", 2027)).toEqual({ attendance: "PENDING", reason: null, blank: true });
  });
  it("makes earlier blank attendance absent, with the reason", () => {
    expect(mapAttendance(" ", 2025)).toEqual({ attendance: "ABSENT", reason: NOT_COMPLETED_REASON, blank: true });
  });
  it("refuses a word it doesn't know", () => {
    expect(mapAttendance("MAYBE", 2026)).toBeNull();
  });
});

describe("the same person on a training more than once (decision 7)", () => {
  const row = (id: number, completed: boolean, hasFeedback: boolean) => ({ id, completed, hasFeedback });
  it("keeps a completed row", () => {
    expect(keptDuplicate([row(1, false, false), row(2, true, false)]).id).toBe(2);
  });
  it("then one with feedback", () => {
    expect(keptDuplicate([row(1, true, false), row(2, true, true), row(3, false, true)]).id).toBe(2);
  });
  it("then the oldest", () => {
    expect(keptDuplicate([row(5, true, true), row(3, true, true)]).id).toBe(3);
    expect(keptDuplicate([row(9, false, false), row(4, false, false)]).id).toBe(4);
  });
});

describe("old course feedback", () => {
  const all = { q1: "5", q2: "4", q3: "3", q4: "2", q5: "1", q6: "5", q7: "4", q8: "4", q9: "5", q10: "5", q11: "4", q12: "Yes" };
  it("stores ratings as numbers, q12 as YES or NO, and written answers as given", () => {
    const { answers, odd } = mapFeedback({ ...all, q13: "  Line one\nline two ", q14: "", q15: null, q16: "Ok" });
    expect(odd).toEqual([]);
    expect(answers).toMatchObject({ q1: 5, q5: 1, q11: 4, q12: "YES", q13: "Line one\nline two", q14: null, q15: null, q16: "Ok" });
    expect(mapFeedback({ ...all, q12: "No" }).answers?.q12).toBe("NO");
  });
  it("is nothing when nothing was answered", () => {
    expect(mapFeedback({ q1: "", q12: null, q13: " " })).toEqual({ answers: null, odd: [] });
  });
  it("leaves an answer that doesn't fit its question blank, and lists it", () => {
    const { answers, odd } = mapFeedback({ ...all, q3: "7", q12: "5" });
    expect(answers).toMatchObject({ q3: null, q12: null });
    expect(odd).toEqual(['q3 "7"', 'q12 "5"']);
  });
  it("cuts a written answer to the form's limit", () => {
    const { answers, odd } = mapFeedback({ q13: "x".repeat(1200) });
    expect((answers?.q13 as string).length).toBe(1000);
    expect(odd).toEqual(["q13 cut to 1000 characters"]);
  });
});

describe("old OJT", () => {
  it("reads the trainer type as external or internal, older words too", () => {
    expect(mapOjtTrainer("EXTERNAL")).toEqual({ value: "INTERNAL_EXTERNAL_TRAINER", known: true });
    expect(mapOjtTrainer("INEXTERNAL")).toEqual({ value: "INTERNAL_EXTERNAL_TRAINER", known: true });
    expect(mapOjtTrainer("internal")).toEqual({ value: "INTERNAL_INTERNAL_TRAINER", known: true });
    expect(mapOjtTrainer("INHOUSE")).toEqual({ value: "INTERNAL_INTERNAL_TRAINER", known: true });
  });
  it("leaves a blank trainer type blank, and doesn't guess at OJT", () => {
    expect(mapOjtTrainer("")).toEqual({ value: null, known: true });
    expect(mapOjtTrainer("OJT")).toEqual({ value: null, known: false });
  });
  it("puts the three answers where the OJT form keeps them", () => {
    expect(mapOjtAnswers({ q1: " WELDING SAFETY ", q2: "2", q3: "4" })).toEqual({ answers: { a1: "WELDING SAFETY", a2: 2, a3: 4 }, odd: [] });
    expect(mapOjtAnswers({ q1: "", q2: "3", q3: null })).toEqual({ answers: { a1: null, a2: 3, a3: null }, odd: [] });
    expect(mapOjtAnswers({ q1: null, q2: "", q3: "" })).toEqual({ answers: null, odd: [] });
    expect(mapOjtAnswers({ q2: "9" })).toEqual({ answers: null, odd: ['q2 "9"'] });
  });
  it("gives an OJT with no code one shaped like v2's, from its start date and old id", () => {
    expect(oldOjtCode(new Date("2024-03-05T00:00:00Z"), 4195)).toBe("OJT20240305004195");
  });
  it("compares 2023 to 2026 year by year and other years together", () => {
    expect(yearBucket(2024)).toBe("2024");
    expect(yearBucket(1970)).toBe("other years");
    expect(yearBucket(2032)).toBe("other years");
  });
});

describe("old PMEs", () => {
  it("maps each old status", () => {
    expect(mapPmeStatus("pending")).toBe("PENDING");
    expect(mapPmeStatus("approved")).toBe("EVALUATED");
    expect(mapPmeStatus("completed")).toBe("ACKNOWLEDGED");
    expect(mapPmeStatus("verified")).toBe("VERIFIED");
    expect(mapPmeStatus("not_applicable")).toBe("NOT_REQUIRED");
    expect(mapPmeStatus("cancelled")).toBeNull();
  });
  it("keeps the PME furthest on when two belong to the same attendance, then the newest", () => {
    expect(
      keptPme([
        { id: 1, status: "VERIFIED" as const },
        { id: 2, status: "PENDING" as const },
      ]).id,
    ).toBe(1);
    expect(
      keptPme([
        { id: 3, status: "PENDING" as const },
        { id: 7, status: "PENDING" as const },
      ]).id,
    ).toBe(7);
  });

  const old = (over: Partial<Parameters<typeof mapPmeAnswers>[0]> = {}) => ({
    ojt: "yes",
    ratings: ["Excellent", "Very Good", "Good", "Poor"] as [unknown, unknown, unknown, unknown],
    percents: ["95", "85%", "70", "10"] as [unknown, unknown, unknown, unknown],
    remarks: [" Done twice ", "", null, "x"] as [unknown, unknown, unknown, unknown],
    ...over,
  });
  it("puts the four ratings where the PME form keeps them", () => {
    expect(mapPmeAnswers(old())).toEqual({
      answers: {
        q1: { rating: "EXCELLENT", percent: 95, remarks: "Done twice" },
        q2: { rating: "VERY_GOOD", percent: 85, remarks: null },
        q3: { rating: "GOOD", percent: 70, remarks: null },
        q4: { rating: "POOR", percent: 10, remarks: "x" },
        ojtConducted: true,
      },
      odd: [],
    });
  });
  it("is nothing when nothing was rated", () => {
    expect(mapPmeAnswers(old({ ratings: [null, "", null, null], percents: ["", null, null, null] }))).toEqual({ answers: null, odd: [] });
  });
  it("keeps a percentage outside its band, and lists it", () => {
    const { answers, odd } = mapPmeAnswers(old({ percents: ["80", "85", "70", "10"] }));
    expect(answers?.q1).toEqual({ rating: "EXCELLENT", percent: 80, remarks: "Done twice" });
    expect(odd).toEqual(["q1: 80% is outside excellent (90 to 100)"]);
  });
  it("leaves OJT conducted unknown when it wasn't answered, never guessed", () => {
    const { answers, odd } = mapPmeAnswers(old({ ojt: "" }));
    expect(answers?.ojtConducted).toBeNull();
    expect(odd).toEqual(["OJT conducted: not answered"]);
  });
  it("keeps no answers when one question can't be read", () => {
    const { answers, odd } = mapPmeAnswers(old({ ratings: ["Excellent", "Superb", "Good", "Poor"] }));
    expect(answers).toBeNull();
    expect(odd).toEqual(['q2: rating "Superb"']);
  });
});

describe("old PMEs on a training of 4 hours or less", () => {
  it("are Not required when pending, as v2 treats a short training", () => {
    expect(pmeStatusForTraining("PENDING", 4, false)).toBe("NOT_REQUIRED");
    expect(pmeStatusForTraining("PENDING", 3.5, true)).toBe("NOT_REQUIRED");
  });
  it("are Not required when the old daily job completed them without an evaluation", () => {
    expect(pmeStatusForTraining("ACKNOWLEDGED", 2, false)).toBe("NOT_REQUIRED");
  });
  it("keep their status once the HOD evaluated, or once verified", () => {
    expect(pmeStatusForTraining("ACKNOWLEDGED", 2, true)).toBe("ACKNOWLEDGED");
    expect(pmeStatusForTraining("EVALUATED", 2, true)).toBe("EVALUATED");
    expect(pmeStatusForTraining("VERIFIED", 2, false)).toBe("VERIFIED");
  });
  it("leave a longer training's PME, or one whose hours can't be worked out, as it was", () => {
    expect(pmeStatusForTraining("PENDING", 4.5, false)).toBe("PENDING");
    expect(pmeStatusForTraining("ACKNOWLEDGED", 8, false)).toBe("ACKNOWLEDGED");
    expect(pmeStatusForTraining("PENDING", null, false)).toBe("PENDING");
  });
});

describe("old skill matrices", () => {
  it("map the old status: blank is a draft, PENDING is with the HOD", () => {
    expect(mapSkillStatus(null)).toBe("DRAFT");
    expect(mapSkillStatus("")).toBe("DRAFT");
    expect(mapSkillStatus("PENDING")).toBe("SUBMITTED");
    expect(mapSkillStatus(" approved ")).toBe("APPROVED");
    expect(mapSkillStatus("REJECTED")).toBeNull();
  });
  it("map the three sections, and nothing else", () => {
    expect(mapSkillSection("knowledge")).toBe("KNOWLEDGE");
    expect(mapSkillSection("skill")).toBe("SKILL");
    expect(mapSkillSection("Ability")).toBe("ABILITY");
    expect(mapSkillSection("attitude")).toBeNull();
    expect(mapSkillSection(null)).toBeNull();
  });
  it("keep a rating of 1 to 5 and nothing else", () => {
    expect([1, 2, 3, 4, 5].map(mapSkillRating)).toEqual([1, 2, 3, 4, 5]);
    for (const raw of [0, 6, 2.5, "x", null]) expect(mapSkillRating(raw)).toBeNull();
  });
});
