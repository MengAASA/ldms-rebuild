import { mkdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { sheet } from "../excel";
import { IMPORT_PART_LABELS } from "../rules/import";
import type { ImportRun } from "./run";

// The import report: one Excel file per run, in import-reports/ (git-ignored,
// because the later parts list staff by their old id). A summary sheet
// compares old and new; then a sheet per reason lists the rows behind it, for
// L&D and HR to clean up.

const two = (n: number) => String(n).padStart(2, "0");
const stampOf = (d: Date) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;

/** Excel sheet names: at most 31 characters, none of \ / ? * [ ] : and no two alike. */
function sheetName(reason: string, taken: Set<string>) {
  const base =
    reason
      .replace(/[\\/?*[\]:]/g, " ")
      .slice(0, 28)
      .trim() || "Rows";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

export async function writeReport(run: ImportRun, from: string, into: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const covers = `${run.checkOnly ? "Check only, nothing written. " : ""}From ${from} into ${into}, ${run.startedAt.toLocaleString("en-GB")}`;

  sheet(
    wb,
    "Summary",
    "LDMS import: old system against v2",
    covers,
    [
      { header: "No", key: "no", width: 6 },
      { header: "Part", key: "part", width: 38 },
      { header: "What", key: "what", width: 40 },
      { header: "Old system", key: "old", width: 14 },
      { header: "In v2", key: "imported", width: 14 },
      { header: "Difference", key: "gap", width: 14 },
      { header: "Note", key: "note", width: 60 },
    ],
    run.counts.map((c) => ({
      part: IMPORT_PART_LABELS[c.part],
      what: c.what,
      old: c.old,
      imported: c.imported,
      gap: Math.round((c.imported - c.old) * 100) / 100,
      note: c.note,
    })),
  );

  const byReason = new Map<string, typeof run.issues>();
  for (const i of run.issues) byReason.set(i.reason, [...(byReason.get(i.reason) ?? []), i]);
  sheet(
    wb,
    "Reasons",
    "Rows that need a look, by reason",
    "Each reason has its own sheet listing the old rows",
    [
      { header: "No", key: "no", width: 6 },
      { header: "Part", key: "part", width: 38 },
      { header: "Reason", key: "reason", width: 60 },
      { header: "Rows", key: "rows", width: 12 },
    ],
    [...byReason].map(([reason, rows]) => ({ part: IMPORT_PART_LABELS[rows[0].part], reason, rows: rows.length })),
  );

  const taken = new Set(["summary", "reasons"]);
  for (const [reason, rows] of byReason)
    sheet(
      wb,
      sheetName(reason, taken),
      reason,
      `${rows.length} row(s) in the old database`,
      [
        { header: "No", key: "no", width: 6 },
        { header: "Old table", key: "table", width: 26 },
        { header: "Old id", key: "oldId", width: 12 },
        { header: "Note", key: "note", width: 70 },
      ],
      rows.map((r) => ({ table: r.table, oldId: r.oldId, note: r.note })),
    );

  const dir = path.join(process.cwd(), "import-reports");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `import-${stampOf(run.startedAt)}${run.checkOnly ? "-check" : ""}.xlsx`);
  await wb.xlsx.writeFile(file);
  return file;
}
