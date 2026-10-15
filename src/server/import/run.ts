import { PrismaClient } from "@prisma/client";
import { IMPORT_PART_LABELS, type ImportPart, isReadOnlySql } from "../rules/import";

// One run of the import: the two connections, and what it found. The parts
// (org.ts and so on) read through `read`, write through `target`, and report
// through `count` and `issue`.

/** A row the import could not bring across as it is, for the import report. */
export type Issue = { part: ImportPart; reason: string; table: string; oldId: number | string; note: string };

/** One line of the comparison: how many the old system has, and how many are in v2 now. */
export type Count = { part: ImportPart; what: string; old: number; imported: number; note: string; reportOnly?: boolean };

export class ImportRun {
  readonly old: PrismaClient;
  readonly target: PrismaClient;
  readonly issues: Issue[] = [];
  readonly counts: Count[] = [];
  readonly startedAt = new Date();

  constructor(
    urls: { old: string; target: string },
    /** Count and report only: nothing is emptied or written. */
    readonly checkOnly: boolean,
  ) {
    this.old = new PrismaClient({ datasourceUrl: urls.old, log: ["error"] });
    this.target = new PrismaClient({ datasourceUrl: urls.target, log: ["error"] });
  }

  /** Rows from the old database. Only a single SELECT is ever sent to it. */
  async read<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
    if (!isReadOnlySql(sql)) throw new Error(`Refused to send this to the old database, which is only read: ${sql.slice(0, 80)}`);
    const rows = (await this.old.$queryRawUnsafe(sql)) as Record<string, unknown>[];
    // COUNT(*) and SUM() arrive as bigint; every number in the old tables fits a JS number.
    for (const row of rows) for (const key in row) if (typeof row[key] === "bigint") row[key] = Number(row[key]);
    return rows as T[];
  }

  issue(part: ImportPart, reason: string, table: string, oldId: number | string, note = "") {
    this.issues.push({ part, reason, table, oldId, note });
  }

  count(part: ImportPart, what: string, old: number, imported: number, note = "") {
    this.counts.push({ part, what, old, imported, note });
  }

  /** A line of the comparison too detailed for the terminal: it goes in the report only. */
  detail(part: ImportPart, what: string, old: number, imported: number, note = "") {
    this.counts.push({ part, what, old, imported, note, reportOnly: true });
  }

  /** The comparison, for the terminal. */
  summaryLines(): string[] {
    const lines: string[] = [];
    let part: ImportPart | null = null;
    for (const c of this.counts) {
      if (c.reportOnly) continue;
      if (c.part !== part) lines.push("", IMPORT_PART_LABELS[(part = c.part)]);
      const gap = Math.round((c.imported - c.old) * 100) / 100; // hours have decimals
      lines.push(
        `  ${c.what.padEnd(38)} old ${String(c.old).padStart(7)}   v2 ${String(c.imported).padStart(7)}   ${gap === 0 ? "same" : `${gap > 0 ? "+" : ""}${gap}`}${c.note ? `   ${c.note}` : ""}`,
      );
    }
    const reasons = new Map<string, number>();
    for (const i of this.issues) reasons.set(i.reason, (reasons.get(i.reason) ?? 0) + 1);
    if (reasons.size) lines.push("", "Rows listed in the report");
    for (const [reason, n] of reasons) lines.push(`  ${String(n).padStart(7)}  ${reason}`);
    return lines;
  }

  async close() {
    await Promise.all([this.old.$disconnect(), this.target.$disconnect()]);
  }
}
