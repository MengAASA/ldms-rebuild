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
export const IMPORT_PARTS = ["org", "staff"] as const;
export type ImportPart = (typeof IMPORT_PARTS)[number];

export const IMPORT_PART_LABELS: Record<ImportPart, string> = {
  org: "Divisions, departments and sections",
  staff: "Staff, roles, HODs and division heads",
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

// ---------- Staff ----------

export type NewDesignation = "NON_EXECUTIVE" | "EXECUTIVE" | "MANAGER" | "CONTRACT" | "TRAINEE";

const DESIGNATION_MAP: Record<string, NewDesignation> = {
  "NON EXECUTIVE": "NON_EXECUTIVE",
  EXECUTIVE: "EXECUTIVE",
  "MANAGER (AM/HOS & ABOVE)": "MANAGER",
  MANAGER: "MANAGER",
  CONTRACT: "CONTRACT",
  TRAINEE: "TRAINEE",
};

const key = (raw: unknown) => (typeof raw === "string" ? raw.replace(/ +/g, " ").trim().toUpperCase() : "");

/** The old designation as one of v2's five; null when it is none of them. */
export function mapDesignation(raw: unknown): NewDesignation | null {
  return DESIGNATION_MAP[key(raw)] ?? null;
}

/**
 * The old status. The old system only ever asks "not resigned", so a blank
 * status is an active member of staff (decision 3). `blank` lets the caller
 * list those for HR. Null: a word the old system never wrote.
 */
export function mapStaffStatus(raw: unknown): { status: "ACTIVE" | "RESIGNED"; blank: boolean } | null {
  const s = key(raw);
  if (s === "RESIGN") return { status: "RESIGNED", blank: false };
  if (s === "ACTIVE") return { status: "ACTIVE", blank: false };
  return s === "" ? { status: "ACTIVE", blank: true } : null;
}

export function mapGender(raw: unknown): "MALE" | "FEMALE" | null {
  const s = key(raw);
  return s === "MALE" || s === "FEMALE" ? s : null;
}

/** Job grade 1 to 5; the old 0 and blank mean none. */
export function mapJobGrade(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * A staff number as v2 keeps it: trimmed, in capitals. `unusual` says it would
 * be refused on the staff form (a space, a symbol, or under 3 characters): it
 * is imported as it is, because people sign in with it, and listed for HR.
 */
export function cleanStaffNo(raw: unknown): { value: string | null; unusual: boolean } {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!value || value.length > 20) return { value: null, unusual: true };
  return { value, unusual: !/^[A-Z0-9-]{3,}$/.test(value) };
}

/** An old password as `Staff.legacyMd5` holds it: 32 hex characters in lower case, or nothing. */
export function cleanMd5(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^[0-9a-f]{32}$/.test(s) ? s : null;
}

/** A date the old database holds as text (YYYY-MM-DD); null for none, a zero date or one that isn't a real day. */
export function cleanDate(raw: unknown): Date | null {
  const m = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

export type OldRoles = { roles: ("LD_ADMIN" | "MAIN_CLERK")[]; fillsOwnTna: boolean; markedHod: boolean; unknown: string[] };

/**
 * What the old `roletype` and `usertype` give a person in v2. Every old clerk
 * is marked MAIN, so every clerk becomes a main clerk (decision 5). HOD is not
 * a role in v2: it comes from the org chart, so `markedHod` is only for
 * checking. A word that is neither known nor blank comes back in `unknown`.
 */
export function mapOldRoles(roletype: unknown, usertype: unknown): OldRoles {
  const r = key(roletype);
  const u = key(usertype);
  const out: OldRoles = { roles: [], fillsOwnTna: u === "OFFICE", markedHod: u === "HOD", unknown: [] };
  if (r === "ADMIN") out.roles.push("LD_ADMIN");
  else if (r === "CLERK") out.roles.push("MAIN_CLERK");
  else if (r) out.unknown.push(`roletype ${r}`);
  if (u && !["OFFICE", "HOD", "MAIN", "ADMIN"].includes(u)) out.unknown.push(`usertype ${u}`);
  return out;
}

/**
 * Whether a person must choose a new password the first time they sign in to
 * v2: yes when their old password is one that others have too. Nearly all
 * staff are still on the password they were given, which anyone could use
 * with someone else's staff number.
 */
export function mustChangeOldPassword(peopleWithThisPassword: number): boolean {
  return peopleWithThisPassword > 1;
}

// Staff who can't be given their old department: it was blank, or it is one
// the old system marks as deleted (decision 4).
export const HOLDING_DIVISION = "No division (old system)";
export const HOLDING_DEPARTMENT = "No department (old system)";
