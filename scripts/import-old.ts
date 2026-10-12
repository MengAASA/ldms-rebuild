// The phase 5 import: the old system's data into a new, empty database.
//
//   npm run import:setup                      create or update the database being filled
//   npm run import:old                        every part
//   npm run import:old -- --only org          one part, and those that depend on it
//   npm run import:old -- --check             count and report only; nothing is emptied or written
//   npm run import:old -- --discard-changes   although people have already changed records there
//
// It needs OLD_DATABASE_URL (the old system's database, only ever read) and
// IMPORT_DATABASE_URL (the database it fills) in .env. It refuses to fill the
// old database or the one the app and the tests use. Each run writes an Excel
// report to import-reports/. See docs/phase-5-plan.md.

import { ImportRefused, runImport } from "../src/server/import";

const args = process.argv.slice(2);
const KNOWN = ["--only", "--check", "--discard-changes"];
const unknown = args.filter((a, i) => (a.startsWith("--") ? !KNOWN.includes(a) : args[i - 1] !== "--only"));
const onlyAt = args.indexOf("--only");

async function main() {
  if (unknown.length) throw new ImportRefused(`Not understood: ${unknown.join(" ")}. The options are ${KNOWN.join(", ")}.`);
  if (onlyAt >= 0 && (!args[onlyAt + 1] || args[onlyAt + 1].startsWith("--"))) throw new ImportRefused("--only needs the name of a part, e.g. --only org.");

  const started = Date.now();
  const result = await runImport(
    { old: process.env.OLD_DATABASE_URL, target: process.env.IMPORT_DATABASE_URL, app: process.env.DATABASE_URL },
    { only: onlyAt >= 0 ? args[onlyAt + 1] : undefined, checkOnly: args.includes("--check"), discardChanges: args.includes("--discard-changes") },
  );
  console.log(result.lines.join("\n"));
  console.log(`\nFrom ${result.from} into ${result.into} in ${Math.round((Date.now() - started) / 100) / 10}s.`);
  console.log(
    result.differences ? `${result.differences} line(s) differ between old and v2: each needs a reason in the report.` : "Old and v2 agree on every line.",
  );
  console.log(`Report: ${result.file}`);
}

main().catch((e) => {
  if (e instanceof ImportRefused) console.error(`Import not started. ${e.message}`);
  else console.error("Import failed:", e);
  process.exitCode = 1;
});
