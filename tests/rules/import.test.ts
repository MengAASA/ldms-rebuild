import { describe, expect, it } from "vitest";
import { isDeletedDepartment, cleanShortName, cleanText, databaseAddress, importTargetBlock, isReadOnlySql, partsToRun } from "@/server/rules/import";

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
    expect(partsToRun(undefined)).toEqual(["org"]);
  });
  it("runs the named part and those that depend on it", () => {
    expect(partsToRun("org")).toEqual(["org"]);
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
