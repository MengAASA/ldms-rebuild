// Rules for the phase 5 import of the old system's data (docs/phase-5-plan.md).
// Every mapping from an old value to a new one lives here, as a pure function
// with unit tests. A value with no mapping is never guessed: the caller lists
// the row in the import report.

// ---------- Where the import may run ----------

export type DatabaseAddress = { host: string; port: string; database: string };

/** The server and database a connection string points at; null if it can't be read. */
export function databaseAddress(url: string | undefined): DatabaseAddress | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim().replace(/^"|"$/g, ""));
    const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (u.protocol !== "mysql:" || !u.hostname || !database) return null;
    const host = u.hostname.toLowerCase();
    return { host: host === "127.0.0.1" || host === "::1" || host === "[::1]" ? "localhost" : host, port: u.port || "3306", database: database.toLowerCase() };
  } catch {
    return null;
  }
}

const same = (a: DatabaseAddress, b: DatabaseAddress) => a.host === b.host && a.port === b.port && a.database === b.database;

/**
 * Why the import must not start, or null. The old database is only ever read,
 * and the database being filled is emptied first, so it must be neither the
 * old one nor the one the app and the tests use (`DATABASE_URL`).
 */
export function importTargetBlock(urls: { old?: string; target?: string; app?: string }): string | null {
  const old = databaseAddress(urls.old);
  const target = databaseAddress(urls.target);
  const app = databaseAddress(urls.app);
  if (!old) return "OLD_DATABASE_URL is missing from .env or isn't a MySQL address. It is the old system's database, which is only read.";
  if (!target) return "IMPORT_DATABASE_URL is missing from .env or isn't a MySQL address. It is the new, empty database the import fills.";
  if (same(old, target))
    return "OLD_DATABASE_URL and IMPORT_DATABASE_URL point at the same database. The import empties the database it fills, so it must never be the old one.";
  if (app && same(app, target))
    return "IMPORT_DATABASE_URL is the same database as DATABASE_URL, which the app and the tests use. Give the import a database of its own, e.g. ldms_v2_live.";
  if (app && same(app, old)) return "DATABASE_URL points at the old system's database. LDMS v2 must have its own.";
  return null;
}

/** The old database is only read: anything but a single SELECT is refused before it is sent. */
export function isReadOnlySql(sql: string): boolean {
  const s = sql.trim().replace(/;\s*$/, "");
  return /^select\s/i.test(s) && !s.includes(";") && !/\b(into\s+(outfile|dumpfile)|for\s+update|lock\s+in\s+share\s+mode)\b/i.test(s);
}

// ---------- The parts of the import, in the order they run ----------

// Each part needs the ones before it (attendance needs staff, staff need
// departments), so running one part also empties and reloads those after it.
export const IMPORT_PARTS = ["org"] as const;
export type ImportPart = (typeof IMPORT_PARTS)[number];

export const IMPORT_PART_LABELS: Record<ImportPart, string> = {
  org: "Divisions, departments and sections",
};

/** The parts a run covers: all of them, or the one asked for and those that depend on it. */
export function partsToRun(only: string | undefined): ImportPart[] | null {
  if (!only) return [...IMPORT_PARTS];
  const from = IMPORT_PARTS.indexOf(only as ImportPart);
  return from < 0 ? null : IMPORT_PARTS.slice(from);
}

// ---------- Text ----------

export type Cleaned = { value: string | null; cut: boolean };

/**
 * Old text as v2 stores it: spaces trimmed and runs of them made one, blank
 * as nothing. `cut` says it was longer than the column and lost its end, so
 * the caller can list the row.
 */
export function cleanText(raw: unknown, max: number): Cleaned {
  if (raw === null || raw === undefined) return { value: null, cut: false };
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return { value: null, cut: false };
  return s.length > max ? { value: s.slice(0, max).trimEnd(), cut: true } : { value: s, cut: false };
}

/** A short name, as the organization forms save it: capitals, at most 20 characters. */
export function cleanShortName(raw: unknown): Cleaned {
  const c = cleanText(raw, 20);
  return { value: c.value ? c.value.toUpperCase() : null, cut: c.cut };
}

// ---------- The org chart ----------

/**
 * A department the old system marks as deleted by writing "(DELETED)" in front of its name (it could not remove a
 * department that resigned staff still belonged to). It is not brought across: its sections go with it and its staff
 * are put in the holding department (decided 12 Oct 2026).
 */
export function isDeletedDepartment(name: unknown): boolean {
  return typeof name === "string" && /^\s*\(deleted\)/i.test(name);
}
