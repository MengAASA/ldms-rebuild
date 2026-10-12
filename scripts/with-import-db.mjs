// Runs a command against the imported database instead of the demo one:
//
//   npm run import:setup    prisma migrate deploy   (creates the database, or brings its tables up to date)
//   npm run dev:live        next dev                (LDMS v2 on the imported data; stop `npm run dev` first)
//
// It reads .env, points DATABASE_URL at IMPORT_DATABASE_URL for that one
// command, and changes nothing on disk. Neither Prisma nor Next.js replaces a
// variable that is already set, so the command sees the imported database.

import { spawn } from "node:child_process";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env: the variables may come from the environment itself.
}

const target = process.env.IMPORT_DATABASE_URL;
const [command, ...args] = process.argv.slice(2);

if (!target) {
  console.error(
    "IMPORT_DATABASE_URL is missing from .env. It is the database the import fills, e.g. the same address as DATABASE_URL with ldms_v2_live as the database.",
  );
  process.exit(1);
}
if (target === process.env.OLD_DATABASE_URL) {
  console.error("IMPORT_DATABASE_URL is the old system's database. Nothing is run against it.");
  process.exit(1);
}
if (!command) {
  console.error("Nothing to run.");
  process.exit(1);
}

const child = spawn(command, args, { stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: target } });
child.on("exit", (code) => process.exit(code ?? 1));
