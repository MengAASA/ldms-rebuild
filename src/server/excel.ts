import "server-only";
import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import { UserError } from "./errors";

// How every Excel export is laid out: a title, a line saying what it covers,
// the table from row 4 with a filter on its headings, and an optional totals row.

export type Column = { header: string; key: string; width: number; numFmt?: string };
export type Row = Record<string, string | number | Date | null>;

/**
 * For an export route: a service refusing the export (UserError, e.g. too
 * many rows) becomes a plain message the browser shows; anything else is
 * thrown on. Use as `await exportData(...).catch(refusedExport)`.
 */
export function refusedExport(e: unknown): Response {
  if (e instanceof UserError) return new Response(e.message, { status: 413, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  throw e;
}

/**
 * A workbook that writes its rows out as they are added, for the exports that
 * can run to 100,000 rows (the audit report and OJT). The usual workbook keeps
 * every cell in memory: a year of the audit report took 24 s and 840 MB that
 * way, 6 s and 150 MB this way. Fill it with `sheet` (or commit each row and
 * the sheet), then `await file()`.
 */
export function streamingWorkbook() {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (chunk: Buffer) => chunks.push(chunk));
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = "LDMS";
  return {
    wb,
    file: async () => {
      await wb.commit();
      return Buffer.concat(chunks);
    },
  };
}

/** Whether a sheet belongs to a streaming workbook, whose rows must be committed as they are written. */
const streaming = (ws: ExcelJS.Worksheet) => typeof (ws as Partial<Pick<ExcelJS.Worksheet, "commit">>).commit === "function";

export const HOURS = "0.##";
export const MONEY = "#,##0.00";
export const DATE = "dd/mm/yyyy";

/** Adds a sheet in that layout. Rows are numbered in the `no` column. In a streaming workbook the sheet is finished (committed). */
export function sheet(wb: ExcelJS.Workbook, name: string, title: string, covers: string, columns: Column[], rows: Row[], total?: Row) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = columns.map(({ key, width, numFmt }) => ({ key, width, style: numFmt ? { numFmt } : undefined }));
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value = covers;
  const header = ws.getRow(4);
  columns.forEach((c, i) => (header.getCell(i + 1).value = c.header));
  header.font = { bold: true };
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
  rows.forEach((r, i) => ws.addRow({ no: i + 1, ...r }).commit());
  if (total && rows.length) ws.addRow(total).font = { bold: true };
  if (streaming(ws)) ws.commit();
  return ws;
}
