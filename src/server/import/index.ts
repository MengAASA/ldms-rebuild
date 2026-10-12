import type { PrismaClient } from "@prisma/client";
import { IMPORT_PART_LABELS, type ImportPart, databaseAddress, importTargetBlock, partsToRun } from "../rules/import";
import { importOrg } from "./org";
import { writeReport } from "./report";
import { ImportRun } from "./run";

// The phase 5 import (docs/phase-5-plan.md): reads the old system's database
// and fills a new, empty one. Run it as often as needed; each run empties what
// it is about to load and loads it again, then compares old with new.

const PARTS: Record<ImportPart, (run: ImportRun) => Promise<void>> = {
  org: importOrg,
};

/** A reason a person can act on; thrown for anything that stops the run before it writes. */
export class ImportRefused extends Error {}

export type ImportOptions = {
  only?: string;
  checkOnly: boolean;
  /** Go ahead although people have already changed records in the database being filled. */
  discardChanges: boolean;
};

/**
 * Empties the database being filled. Every part depends on the org chart, so
 * until parts can be run on their own (the staff part onwards) a run starts
 * from nothing. Children before parents; settings are kept.
 */
async function empty(db: PrismaClient) {
  await db.notification.deleteMany();
  await db.emailMessage.deleteMany();
  await db.jobRun.deleteMany();
  await db.tniItem.deleteMany();
  await db.tni.deleteMany();
  await db.tnaItem.deleteMany();
  await db.tna.deleteMany();
  await db.tnaTrainingOption.deleteMany();
  await db.tnaTrainingCategory.deleteMany();
  await db.skillItem.deleteMany();
  await db.skillTopic.deleteMany();
  await db.skillEvaluation.deleteMany();
  await db.pme.deleteMany();
  await db.participant.deleteMany();
  await db.trainingSession.deleteMany();
  await db.training.deleteMany();
  await db.auditLog.deleteMany();
  await db.staffRole.deleteMany();
  await db.department.updateMany({ data: { hodId: null } });
  await db.division.updateMany({ data: { headId: null } });
  await db.staff.deleteMany();
  await db.section.deleteMany();
  await db.department.deleteMany();
  await db.division.deleteMany();
}

/** What a new database needs before anyone opens it; the seed does the same for the demo copy. */
async function ensureSettings(db: PrismaClient) {
  await db.setting.upsert({ where: { key: "tna.year" }, update: {}, create: { key: "tna.year", value: 2026 } });
  await db.setting.upsert({ where: { key: "mail.testMode" }, update: {}, create: { key: "mail.testMode", value: { enabled: true, address: "" } } });
}

export async function runImport(env: { old?: string; target?: string; app?: string }, options: ImportOptions) {
  const block = importTargetBlock(env);
  if (block) throw new ImportRefused(block);
  const parts = partsToRun(options.only);
  if (!parts) throw new ImportRefused(`There is no part called "${options.only}". The parts are: ${Object.keys(PARTS).join(", ")}.`);

  const from = databaseAddress(env.old)!.database;
  const into = databaseAddress(env.target)!.database;
  const run = new ImportRun({ old: env.old!, target: env.target! }, options.checkOnly);
  try {
    if (!options.checkOnly) {
      // Records people have added or changed in v2 would be lost. Entries the import wrote itself don't count.
      const changes = await run.target.auditLog.count({ where: { entity: { not: "Import" } } });
      if (changes > 0 && !options.discardChanges)
        throw new ImportRefused(
          `${into} has ${changes} change(s) made by people since it was last filled. The import would empty it. ` +
            `If that is what you want, run it again with --discard-changes.`,
        );
      await empty(run.target);
      await ensureSettings(run.target);
    }

    for (const part of parts) {
      console.log(`${options.checkOnly ? "Checking" : "Importing"}: ${IMPORT_PART_LABELS[part]}`);
      await PARTS[part](run);
      if (!options.checkOnly) {
        const mine = run.counts.filter((c) => c.part === part && !c.what.includes("with the same"));
        const summary = `Imported from the old system: ${mine.map((c) => `${c.imported} ${c.what.toLowerCase()}`).join(", ")}`;
        await run.target.auditLog.create({ data: { action: "IMPORT", entity: "Import", entityId: part, summary: summary.slice(0, 255) } });
      }
    }

    const file = await writeReport(run, from, into);
    return { from, into, file, lines: run.summaryLines(), differences: run.counts.filter((c) => c.old !== c.imported).length, listed: run.issues.length };
  } finally {
    await run.close();
  }
}
