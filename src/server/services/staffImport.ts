import "server-only";
import ExcelJS from "exceljs";
import { db } from "../db";
import { UserError } from "../errors";
import { canManageStaffRecord, hasExtraAccess, isAdmin, manageableDesignations, type SessionUser } from "../permissions";
import { DESIGNATION_LABELS, DESIGNATIONS, staffSchema, type StaffInput } from "@/lib/validation/staff";
import { diffFields, recordAudit } from "./audit";
import { ensure } from "./org";

export const IMPORT_COLUMNS = ["Staff No", "Name", "Email", "Position", "Designation", "Department", "Section", "Date Joined", "Job Grade", "Fills Own TNA", "Gender", "Plant"] as const;
/**
 * Added after phase 1. A file without one of these columns (an older template)
 * leaves that value as it is on existing records, where a blank cell under any
 * other heading clears it.
 */
const KEEP_WHEN_ABSENT = { jobGrade: "Job Grade", fillsOwnTna: "Fills Own TNA", gender: "Gender", plant: "Plant" } as const;
const REQUIRED = ["Staff No", "Name", "Designation", "Department"];
const MAX_ROWS = 2000;

export type ImportRow = {
  row: number;
  staffNo: string;
  name: string;
  department: string;
  designation: string;
  action: "create" | "update" | "unchanged" | "error";
  changes: string[];
  errors: string[];
};

export type ImportPreview = {
  fileName: string;
  rows: ImportRow[];
  counts: Record<ImportRow["action"], number>;
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("richText" in value) return value.richText.map((r) => r.text).join("").trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    return "";
  }
  return String(value).trim();
}

/** Accepts 2026-03-01, 01/03/2026 (day first, as typed in Malaysia) or an Excel date. */
function normaliseDate(s: string): string | null {
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  if (!iso) return null;
  // Reject impossible dates such as 31/13/2026 or 30/02/2026.
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? iso : null;
}

function matchDesignation(s: string): string {
  const key = s.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((DESIGNATIONS as readonly string[]).includes(key)) return key;
  const byLabel = Object.entries(DESIGNATION_LABELS).find(([, label]) => label.toUpperCase() === s.trim().toUpperCase());
  if (byLabel) return byLabel[0];
  if (key === "NON_EXEC" || key === "NONEXECUTIVE") return "NON_EXECUTIVE";
  return s;
}

type Parsed = { row: number; input?: StaffInput; raw: Record<string, string>; errors: string[]; has: { jobGrade: boolean; fillsOwnTna: boolean; gender: boolean; plant: boolean } };

/** "Male" / "Female" (or M, F, Lelaki, Perempuan) as the stored value; blank stays blank; anything else is returned as typed, for the error. */
function matchGender(s: string): string {
  const v = s.trim().toLowerCase();
  if (["male", "m", "lelaki"].includes(v)) return "MALE";
  if (["female", "f", "perempuan"].includes(v)) return "FEMALE";
  return s.trim();
}

/** "Yes" / "No" (or Y, N, true, false, 1, 0); blank is No. Null when it is something else. */
function yesNo(s: string): boolean | null {
  const v = s.trim().toLowerCase();
  if (["", "no", "n", "false", "0"].includes(v)) return false;
  return ["yes", "y", "true", "1"].includes(v) ? true : null;
}

async function parseWorkbook(buffer: ArrayBuffer): Promise<Parsed[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new UserError("That file could not be read. Save it as an Excel workbook (.xlsx) and try again.");
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new UserError("The workbook has no sheets.");

  const header = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => header.set(cellText(cell.value).toLowerCase(), col));
  const missing = REQUIRED.filter((h) => !header.has(h.toLowerCase()));
  if (missing.length) throw new UserError(`Row 1 must have these column headings: ${missing.join(", ")}. Download the template to see the layout.`);
  if (sheet.actualRowCount - 1 > MAX_ROWS) throw new UserError(`Import at most ${MAX_ROWS} rows at a time.`);

  const departments = await db.department.findMany({ include: { sections: true } });
  const deptByKey = new Map<string, (typeof departments)[number]>();
  for (const d of departments) {
    deptByKey.set(d.name.toLowerCase(), d);
    if (d.shortName) deptByKey.set(d.shortName.toLowerCase(), d);
  }

  const has = { jobGrade: header.has(KEEP_WHEN_ABSENT.jobGrade.toLowerCase()), fillsOwnTna: header.has(KEEP_WHEN_ABSENT.fillsOwnTna.toLowerCase()),
    gender: header.has(KEEP_WHEN_ABSENT.gender.toLowerCase()),
    plant: header.has(KEEP_WHEN_ABSENT.plant.toLowerCase()),
  };
  const parsed: Parsed[] = [];
  const seen = new Map<string, number>();
  sheet.eachRow((r, rowNumber) => {
    if (rowNumber === 1) return;
    const raw: Record<string, string> = {};
    for (const col of IMPORT_COLUMNS) {
      const idx = header.get(col.toLowerCase());
      raw[col] = idx ? cellText(r.getCell(idx).value) : "";
    }
    if (Object.values(raw).every((v) => !v)) return;

    const errors: string[] = [];
    const dept = deptByKey.get(raw["Department"].toLowerCase());
    if (raw["Department"] && !dept) errors.push(`Department "${raw["Department"]}" not found`);
    let sectionId = "";
    if (raw["Section"] && dept) {
      const section = dept.sections.find((s) => s.name.toLowerCase() === raw["Section"].toLowerCase());
      if (section) sectionId = String(section.id);
      else errors.push(`Section "${raw["Section"]}" is not in ${dept.name}`);
    }
    const date = normaliseDate(raw["Date Joined"]);
    if (date === null) errors.push(`Date Joined "${raw["Date Joined"]}" is not a date (use DD/MM/YYYY)`);
    const ownTna = yesNo(raw["Fills Own TNA"]);
    if (ownTna === null) errors.push(`Fills Own TNA "${raw["Fills Own TNA"]}" should be Yes or No`);

    const result = staffSchema.safeParse({
      staffNo: raw["Staff No"],
      name: raw["Name"],
      email: raw["Email"],
      position: raw["Position"],
      designation: matchDesignation(raw["Designation"]),
      gender: matchGender(raw["Gender"]),
      plant: raw["Plant"] ?? "",
      departmentId: dept ? String(dept.id) : "",
      sectionId,
      dateJoined: date ?? "",
      jobGrade: raw["Job Grade"],
      fillsOwnTna: ownTna ?? false,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        if (field === "departmentId" && raw["Department"]) continue; // already reported above
        if (field === "dateJoined") continue; // reported above with the value typed
        const label = { staffNo: "Staff No", name: "Name", email: "Email", designation: "Designation", departmentId: "Department", position: "Position", jobGrade: "Job Grade", gender: "Gender", plant: "Plant" }[field] ?? field;
        errors.push(`${label}: ${field === "designation" ? `"${raw["Designation"]}" is not one of ${Object.values(DESIGNATION_LABELS).join(", ")}` : issue.message}`);
      }
    }
    const staffNo = raw["Staff No"].toUpperCase();
    if (staffNo) {
      if (seen.has(staffNo)) errors.push(`Staff No ${staffNo} also appears on row ${seen.get(staffNo)}`);
      else seen.set(staffNo, rowNumber);
    }
    parsed.push({ row: rowNumber, input: result.success ? result.data : undefined, raw, errors, has });
  });
  if (!parsed.length) throw new UserError("The first sheet has no data rows under the headings.");
  return parsed;
}

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  email: "email",
  position: "position",
  designation: "designation",
  departmentId: "department",
  sectionId: "section",
  dateJoined: "date joined",
  jobGrade: "job grade",
  fillsOwnTna: "fills own TNA",
  gender: "gender",
  plant: "plant",
};

const IMPORT_FIELDS: (keyof StaffInput & string)[] = ["name", "email", "position", "designation", "departmentId", "sectionId", "dateJoined", "jobGrade", "fillsOwnTna", "gender", "plant"];

async function plan(user: SessionUser, buffer: ArrayBuffer) {
  const parsed = await parseWorkbook(buffer);
  const allowed = manageableDesignations(user);
  const existing = await db.staff.findMany({
    where: { staffNo: { in: parsed.flatMap((p) => (p.input ? [p.input.staffNo] : [])) } },
    include: { roles: { select: { role: true } }, hodOf: { select: { id: true } }, headOf: { select: { id: true } } },
  });
  const byNo = new Map(existing.map((s) => [s.staffNo, s]));

  return parsed.map((raw) => {
    const current = raw.input ? byNo.get(raw.input.staffNo) : undefined;
    // What the row would save: a column the file doesn't have keeps the record's value, and
    // who fills in their own TNA is L&D's to decide (a clerk's file can't change it).
    const input = raw.input && {
      ...raw.input,
      jobGrade: raw.has.jobGrade ? raw.input.jobGrade : (current?.jobGrade ?? null),
      gender: raw.has.gender ? raw.input.gender : (current?.gender ?? null),
      plant: raw.has.plant ? raw.input.plant : (current?.plant ?? null),
      fillsOwnTna: raw.has.fillsOwnTna && isAdmin(user) ? raw.input.fillsOwnTna : (current?.fillsOwnTna ?? false),
    };
    const p = { ...raw, input };
    const errors = [...p.errors];
    if (p.input && !allowed.includes(p.input.designation)) errors.push("Clerks can import contract staff only");
    if (current && !canManageStaffRecord(user, current)) errors.push(`${current.staffNo} is an existing record you can't change (${hasExtraAccess(current) ? "they have extra access, so only an admin can" : `${DESIGNATION_LABELS[current.designation].toLowerCase()} staff`})`);

    let action: ImportRow["action"] = "create";
    let changes: string[] = [];
    if (errors.length || !p.input) action = "error";
    else if (current) {
      const diff = diffFields(current, p.input, IMPORT_FIELDS);
      changes = Object.keys(diff).map((k) => FIELD_LABELS[k] ?? k);
      action = changes.length ? "update" : "unchanged";
    }
    return { parsed: p, current, action, changes, errors };
  });
}

export async function previewStaffImport(user: SessionUser, fileName: string, buffer: ArrayBuffer): Promise<ImportPreview> {
  ensure(user, "staff.import");
  const planned = await plan(user, buffer);
  const rows: ImportRow[] = planned.map(({ parsed, action, changes, errors }) => ({
    row: parsed.row,
    staffNo: parsed.raw["Staff No"],
    name: parsed.raw["Name"],
    department: parsed.raw["Department"],
    designation: parsed.raw["Designation"],
    action,
    changes,
    errors,
  }));
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  rows.forEach((r) => counts[r.action]++);
  return { fileName, rows, counts };
}

/**
 * Re-reads the same file and saves it. Rows with errors are either skipped
 * (when the user chose to) or block the whole import.
 */
export async function commitStaffImport(user: SessionUser, fileName: string, buffer: ArrayBuffer, skipErrors: boolean) {
  ensure(user, "staff.import");
  const planned = await plan(user, buffer);
  const errorCount = planned.filter((p) => p.action === "error").length;
  if (errorCount && !skipErrors) throw new UserError(`${errorCount} row(s) have errors. Fix them in the file, or choose to skip them.`);

  return db.$transaction(
    async (tx) => {
      let created = 0;
      let updated = 0;
      for (const p of planned) {
        const input = p.parsed.input;
        if (!input || p.action === "error" || p.action === "unchanged") continue;
        if (p.action === "create") {
          const s = await tx.staff.create({ data: input });
          await recordAudit(tx, { actorId: user.id, action: "CREATE", entity: "Staff", entityId: s.id, summary: `Added ${s.name} (${s.staffNo}) by import of ${fileName}` });
          created++;
        } else if (p.current) {
          const diff = diffFields(p.current, input, IMPORT_FIELDS);
          await tx.staff.update({ where: { id: p.current.id }, data: input });
          if (p.current.departmentId !== input.departmentId)
            await tx.department.updateMany({ where: { hodId: p.current.id, id: { not: input.departmentId } }, data: { hodId: null } });
          await recordAudit(tx, { actorId: user.id, action: "UPDATE", entity: "Staff", entityId: p.current.id, summary: `Updated ${input.name} by import of ${fileName}`, changes: diff });
          updated++;
        }
      }
      await recordAudit(tx, {
        actorId: user.id,
        action: "IMPORT",
        entity: "Staff",
        entityId: "import",
        summary: `Imported ${fileName}: ${created} added, ${updated} updated, ${errorCount} skipped`,
      });
      return { created, updated, skipped: errorCount };
    },
    { timeout: 60_000 },
  );
}

export async function buildImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Staff");
  ws.columns = IMPORT_COLUMNS.map((header) => ({ header, width: header === "Name" || header === "Department" ? 34 : 18 }));
  ws.getRow(1).font = { bold: true };
  ws.addRow(["C2101", "Aung Ko Ko", "", "Production Operator", "Contract", "Stamping", "Press Line A", "01/10/2026", 1, "No", "Male"]);
  const ref = wb.addWorksheet("Departments");
  ref.columns = [
    { header: "Department", width: 36 },
    { header: "Short name", width: 12 },
    { header: "Sections", width: 60 },
  ];
  ref.getRow(1).font = { bold: true };
  const departments = await db.department.findMany({ orderBy: { name: "asc" }, include: { sections: { orderBy: { name: "asc" } } } });
  departments.forEach((d) => ref.addRow([d.name, d.shortName ?? "", d.sections.map((s) => s.name).join(", ")]));
  const notes = wb.addWorksheet("Notes");
  notes.getColumn(1).width = 100;
  [
    "Required columns: Staff No, Name, Designation, Department.",
    `Designation: ${Object.values(DESIGNATION_LABELS).join(", ")}.`,
    "Department: the full name or the short name from the Departments sheet.",
    "Date Joined: DD/MM/YYYY.",
    "Job Grade: 1 to 5, or blank for none. Staff who don't fill in their own TNA are covered by their grade's.",
    "Fills Own TNA: Yes or No (blank is No). For office staff who aren't executives; executives and managers always do. Only the L&D unit can change it.",
    "A Staff No that already exists updates that record. Blank optional cells clear the value.",
    "Gender: Male or Female, or blank when not recorded.",
    "Plant: where they work, e.g. PEGOH PLANT, or blank when not recorded.",
    "A file without the Job Grade, Fills Own TNA, Gender or Plant column leaves those as they are.",
  ].forEach((line) => notes.addRow([line]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
