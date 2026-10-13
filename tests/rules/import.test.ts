import { describe, expect, it } from "vitest";
import {
  cleanDate,
  cleanMd5,
  cleanShortName,
  cleanStaffNo,
  cleanText,
  databaseAddress,
  importTargetBlock,
  isDeletedDepartment,
  isReadOnlySql,
  mapDesignation,
  mapGender,
  mapJobGrade,
  mapOldRoles,
  mapStaffStatus,
  mustChangeOldPassword,
  partsToRun,
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
    expect(partsToRun(undefined)).toEqual(["org", "staff"]);
  });
  it("runs the named part and those that depend on it", () => {
    expect(partsToRun("org")).toEqual(["org", "staff"]);
    expect(partsToRun("staff")).toEqual(["staff"]);
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
  it("must be changed at first sign-in when others have the same one", () => {
    expect(mustChangeOldPassword(2938)).toBe(true);
    expect(mustChangeOldPassword(2)).toBe(true);
  });
  it("may be kept when it is the person's own", () => {
    expect(mustChangeOldPassword(1)).toBe(false);
  });
});
