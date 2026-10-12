import { expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { deleteTestTraining } from "./db";
import { choose, signIn } from "./helpers";

// Each test records OJT with a unique title and removes it at the end.
const suffix = String(Date.now()).slice(-6);

/** YYYY-MM-DD, n days from today (Malaysia time). */
function day(n: number) {
  return new Date(Date.now() + 8 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
}

const HEADINGS = [
  "Title",
  "Venue",
  "Start Date (YYYY-MM-DD)",
  "End Date (YYYY-MM-DD)",
  "Start Time (HH:MM)",
  "End Time (HH:MM)",
  "Trainer Type",
  "Trainer Name",
  "Participant Staff No",
  "What Did You Learn (optional)",
  "Skill Before Training 1-5 (optional)",
  "Skill After Training 1-5 (optional)",
];

/** A file laid out like the clerks' template, one row per participant. */
async function template(rows: (string | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("OJT Import");
  ws.addRow(HEADINGS);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function upload(page: Page, name: string, buffer: Buffer) {
  await page.getByLabel("Excel file (.xlsx)").setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await page.getByRole("button", { name: "Check file" }).click();
}

test("a clerk records one OJT for contract staff, and isn't offered anyone else", async ({ page }, testInfo) => {
  const title = `Coil loading drill ${suffix}`;
  try {
    await signIn(page, "10003");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "OJT" }).click();
    await expect(page.getByRole("heading", { name: "OJT", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Record OJT" }).click();
    await expect(page.getByRole("heading", { name: "Record OJT", level: 1 })).toBeVisible();

    // A manager isn't offered to a clerk; a contract staff member is.
    const search = page.getByPlaceholder("Search by name or staff no.");
    await search.fill("10231");
    await expect(page.getByText("No active staff match.")).toBeVisible();

    // The OJT: 08:30–12:00, so 3.5 hours: short enough to be completed for everyone.
    await page.getByLabel("Title", { exact: true }).fill(title);
    await choose(page, "Training type", "OJT");
    await page.getByLabel("Start date").fill(day(-1));
    await expect(page.getByLabel("End date")).toHaveValue(day(-1).split("-").reverse().join("/"));
    await page.getByLabel("End time").fill("12:00");
    await expect(page.getByTestId("live-hours")).toHaveText("3.5 h");
    await expect(page.getByTestId("entry-outcome")).toContainText("everyone is recorded as completed");
    await page.getByLabel("Venue").fill("Press Line A");
    await choose(page, "External/Internal trainer", "Internal");
    await page.getByLabel("Trainer name").fill("Ahmad bin Ali");

    // Nobody picked yet.
    await page.getByRole("button", { name: "Record OJT", exact: true }).click();
    await expect(page.getByText("Choose at least one staff member")).toBeVisible();

    await search.fill("C2042");
    await page
      .getByRole("list", { name: "Staff" })
      .getByRole("checkbox", { name: /\(C2042\)/ })
      .check();
    await page.getByRole("button", { name: "Record OJT for 1 staff member" }).click();

    await expect(page).toHaveURL(/\/ojt\?recorded=1&completed=1/);
    await expect(page.getByRole("status")).toContainText("OJT recorded for 1 staff member. It counts as completed for everyone.");
    const row = page.getByRole("table", { name: "OJT records" }).getByRole("row", { name: new RegExp(title) });
    await expect(row).toContainText("C2042");
    await expect(row).toContainText("Completed");
    await expect(row).toContainText("Clerk");
    await expect(row).toContainText(/OJT\d{14}/);

    // The Excel export: the rows the filters show, with the OJT's details.
    await page.getByLabel("Search").fill(title);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/q=Coil/);
    await expect(page.getByRole("link", { name: "Export to Excel" })).toHaveAttribute("href", /\/ojt\/export\?q=Coil/);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export to Excel" }).click();
    const file = testInfo.outputPath("ojt.xlsx");
    await (await download).saveAs(file);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet("OJT")!;
    expect(ws.rowCount).toBe(2);
    const header = ws.getRow(1).values as string[];
    const cell = (name: string) => ws.getRow(2).getCell(header.indexOf(name)).value;
    expect(cell("Staff No")).toBe("C2042");
    expect(cell("OJT Title")).toBe(title);
    expect(cell("Training Type")).toBe("OJT");
    expect(cell("Venue")).toBe("Press Line A");
    expect(cell("Trainer Type")).toBe("Internal");
    expect(cell("Trainer Name")).toBe("Ahmad bin Ali");
    expect(cell("Hours")).toBe(3.5);
    expect(cell("Status")).toBe("Completed");
    expect(cell("Recorded By")).toBe("Clerk");
    // As on the old OJT audit report: the person's gender, and a column for each of the three answers.
    expect(header).toContain("Gender");
    expect(header.slice(-3)).toEqual([
      "Please highlight what you have learned from the OJT",
      "Your knowledge / skill before training (Pengetahuan/kemahiran sebelum training)",
      "Your knowledge / skill after training (Pengetahuan/kemahiran selepas latihan)",
    ]);
    expect(String(cell("Training Code"))).toMatch(/^OJT\d{14}$/);

    // Clicking anywhere on the row (here, the staff no.) opens the record, once the page is ready.
    await page.waitForLoadState("networkidle");
    await row.getByRole("cell", { name: "C2042" }).click();
    await expect(page).toHaveURL(/\/ojt\/\d+$/);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    const record = page.getByRole("region", { name: "Record" });
    await expect(record).toContainText("C2042");
    await expect(record).toContainText("Completed");
    await expect(record).toContainText("Ooi Boon Kiat (10003)");
    await expect(page.getByText("None needed: an OJT of 4 hours or less is completed without answers.")).toBeVisible();
  } finally {
    await deleteTestTraining(title);
  }
});

test("a clerk imports OJT from the template; a row with a problem holds back the whole file", async ({ page }) => {
  const long = `Die change practice ${suffix}`;
  const short = `Forklift walkaround ${suffix}`;
  const ojt = (title: string, from: string, to: string) => [title, "Press Line B", day(-3), day(-3), from, to, "INTERNAL", "Ahmad bin Ali"];
  const good = [
    [...ojt(long, "08:00", "17:00"), "C2043", "Changing dies safely", "2", "4"], // 9 h, answers given: completed
    [...ojt(long, "08:00", "17:00"), "C2044"], // 9 h, no answers yet: answers due
    [...ojt(short, "08:00", "10:00"), "C2045"], // 2 h: completed
  ];
  try {
    await signIn(page, "10003");
    await page.goto("ojt/import");

    // A manager's row: clerks import contract staff only, so nothing can be imported.
    await upload(page, "ojt.xlsx", await template([...good, [...ojt(long, "08:00", "17:00"), "10231"]]));
    await expect(page.getByText("1 row has problems. Nothing can be imported until every row is right")).toBeVisible();
    const table = page.getByRole("table", { name: "Rows in the file" });
    await expect(table.getByRole("row", { name: /10231/ })).toContainText("clerks record OJT for contract staff only");
    await expect(page.getByRole("button", { name: "Fix the rows with problems first" })).toBeDisabled();

    // The fixed file: two OJT, three people.
    await page.getByRole("button", { name: "Choose a different file" }).click();
    await upload(page, "ojt-fixed.xlsx", await template(good));
    await expect(table.getByRole("row", { name: /C2043/ })).toContainText("Completed");
    await expect(table.getByRole("row", { name: /C2044/ })).toContainText("Answers due");
    await expect(table.getByRole("row", { name: /C2045/ })).toContainText("Completed");
    await page.getByRole("button", { name: "Import 2 OJT for 3 staff records" }).click();
    await expect(page.getByRole("status")).toHaveText("Import finished: 2 OJT for 3 staff records.");

    // On the list, with how each one stands.
    await page.getByRole("link", { name: "View OJT records" }).click();
    const records = page.getByRole("table", { name: "OJT records" });
    await expect(records.getByRole("row", { name: /C2043/ }).filter({ hasText: long })).toContainText("Completed");
    await expect(records.getByRole("row", { name: /C2044/ }).filter({ hasText: long })).toContainText("Answers due");
    await expect(records.getByRole("row", { name: /C2045/ }).filter({ hasText: short })).toContainText("Excel import");

    // The records: one with the answers that came in the file, one still waiting for them.
    await records.getByRole("row", { name: /C2043/ }).getByRole("cell", { name: "C2043" }).click();
    await expect(page.getByRole("heading", { name: long, level: 1 })).toBeVisible();
    await expect(page.getByText("Changing dies safely")).toBeVisible();
    await expect(page.getByText("4 · Good")).toBeVisible();
    // Both people on this OJT are listed; the other one's record opens from there.
    await page.getByRole("region", { name: "On this OJT" }).getByRole("link", { name: /C2044/ }).click();
    await expect(page.getByRole("region", { name: "OJT answers" })).toContainText("Not given yet.");
    await expect(page.getByRole("region", { name: "Record" })).toContainText("Answers due");

    // The same file again isn't recorded twice.
    await page.goto("ojt/import");
    await upload(page, "ojt-fixed.xlsx", await template(good));
    await expect(table.getByRole("row", { name: /C2043/ })).toContainText("already has this OJT in LDMS");
  } finally {
    await deleteTestTraining(long);
    await deleteTestTraining(short);
  }
});

test("a clerk edits an OJT (details and who is on it), then deletes it", async ({ page }) => {
  const title = `Slitter threading ${suffix}`;
  const renamed = `${title} (line 2)`;
  try {
    await signIn(page, "10003");
    // 08:00–17:00 with no answers: waiting for them.
    await page.goto("ojt/import");
    await upload(page, "ojt.xlsx", await template([[title, "Slitter", day(-2), day(-2), "08:00", "17:00", "INTERNAL", "Ahmad bin Ali", "C2042"]]));
    await page.getByRole("button", { name: "Import 1 OJT for 1 staff record" }).click();
    await expect(page.getByRole("status")).toHaveText("Import finished: 1 OJT for 1 staff record.");
    await page.goto(`ojt?q=${encodeURIComponent(title)}`);
    await page.getByRole("link", { name: title }).click();
    await expect(page.getByRole("region", { name: "Record" })).toContainText("Answers due");

    // Edit: a new title, a shorter day (3.5 h, so completed), and one more person.
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit OJT", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
    await expect(page.getByLabel("Venue")).toHaveValue("Slitter");
    const picker = page.getByRole("list", { name: "Staff" });
    await expect(picker.getByRole("checkbox", { name: /\(C2042\)/ })).toBeChecked();
    await page.getByLabel("Title", { exact: true }).fill(renamed);
    await page.getByLabel("Start time").fill("08:30");
    await page.getByLabel("End time").fill("12:00");
    await expect(page.getByTestId("live-hours")).toHaveText("3.5 h");
    await page.getByPlaceholder("Search by name or staff no.").fill("C2043");
    await picker.getByRole("checkbox", { name: /\(C2043\)/ }).check();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/ojt\/\d+\?saved=1$/);
    await expect(page.getByRole("status")).toHaveText("OJT updated.");
    await expect(page.getByRole("heading", { name: renamed, level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Record" })).toContainText("Completed");
    await expect(page.getByRole("region", { name: "On this OJT" })).toContainText("C2043");

    // Delete: gone for both of them.
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("dialog")).toContainText("all 2 staff members on it");
    await page.getByRole("button", { name: "Delete OJT" }).click();
    await expect(page).toHaveURL(/\/ojt\?deleted=1$/);
    await expect(page.getByRole("status")).toHaveText("OJT deleted.");
    await expect(page.getByRole("row", { name: new RegExp(title.replace(/[()]/g, "\\$&")) })).toHaveCount(0);
  } finally {
    await deleteTestTraining(title);
    await deleteTestTraining(renamed);
  }
});

test("L&D import OJT from the Trainings page, and see it on OJT too", async ({ page }) => {
  const title = `Shear blade check ${suffix}`;
  try {
    await signIn(page, "10001");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Trainings" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "OJT" })).toBeVisible();

    await nav.getByRole("link", { name: "Trainings" }).click();
    await page.getByRole("link", { name: "Import from Excel" }).click();
    await expect(page).toHaveURL(/\/trainings\/import$/);
    await expect(page.getByRole("heading", { name: "Import OJT from Excel", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download the template" })).toBeVisible();

    // L&D aren't limited to contract staff: a manager is fine.
    await upload(page, "ojt.xlsx", await template([[title, "Shear Line", day(-2), day(-2), "08:00", "10:00", "INTERNAL", "Ahmad bin Ali", "10231"]]));
    await expect(page.getByRole("table", { name: "Rows in the file" }).getByRole("row", { name: /10231/ })).toContainText("Completed");
    await page.getByRole("button", { name: "Import 1 OJT for 1 staff record" }).click();
    await expect(page.getByRole("status")).toHaveText("Import finished: 1 OJT for 1 staff record.");

    // Back on Trainings, showing OJT.
    await page.getByRole("link", { name: "View OJT trainings" }).click();
    await expect(page).toHaveURL(/\/trainings\?type=OJT$/);
    await expect(page.getByRole("row", { name: new RegExp(title) })).toContainText(/OJT\d{14}/);

    // The per-person OJT list has it too.
    await nav.getByRole("link", { name: "OJT" }).click();
    await expect(page.getByRole("heading", { name: "OJT", level: 1 })).toBeVisible();
    await expect(page.getByRole("table", { name: "OJT records" }).getByRole("row", { name: new RegExp(title) })).toContainText("10231");
  } finally {
    await deleteTestTraining(title);
  }
});

test("the template downloads for clerks, and staff without OJT access are refused", async ({ page }, testInfo) => {
  await signIn(page, "10003");
  await page.goto("ojt/import");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download the template" }).click();
  const file = testInfo.outputPath("ojt-template.xlsx");
  await (await download).saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["OJT Import", "Options", "Instructions"]);
  expect(wb.getWorksheet("OJT Import")!.getRow(1).getCell(9).value).toBe("Participant Staff No");

  // A HOD with no clerk or L&D role.
  await page.context().clearCookies();
  await signIn(page, "10231");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "OJT" })).toHaveCount(0);
  expect((await page.goto("ojt"))?.status()).toBe(403);
  expect((await page.request.get("ojt/import/template")).status()).toBe(403);
  expect((await page.request.get("ojt/export")).status()).toBe(403);
  expect((await page.goto("ojt/1"))?.status()).toBe(403);
  expect((await page.goto("trainings/import"))?.status()).toBe(403);

  // A record that doesn't exist, or isn't one of the clerk's staff, is simply not found.
  await page.context().clearCookies();
  await signIn(page, "10003");
  expect((await page.goto("ojt/999999999"))?.status()).toBe(404);
  // Clerks import from their OJT page; the Trainings one is L&D's.
  expect((await page.goto("trainings/import"))?.status()).toBe(403);
});
