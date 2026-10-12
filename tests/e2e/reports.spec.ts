import { expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createTestTraining, deleteTestTraining } from "./db";
import { signIn } from "./helpers";

// The reports are checked against one training of our own in 2024, a year
// with nothing else in it: 9 hours, on 5 March 2024, with
//   10231 (HOD, Stamping): completed      10002 (HR & Admin): completed
//   10003 (Stamping): absent
// So L&D see 18 hours over two departments; Stamping's HOD sees 9 for their own.
const suffix = String(Date.now()).slice(-6);
const title = `Report check ${suffix}`;
const PERIOD = "from=2024-01-01&to=2024-12-31";

test.beforeAll(async () => {
  await createTestTraining(
    title,
    [
      { staffNo: "10231", attendance: "COMPLETED" },
      { staffNo: "10002", attendance: "COMPLETED" },
      { staffNo: "10003", attendance: "ABSENT" },
    ],
    "2024-03-05",
  );
});
test.afterAll(async () => {
  await deleteTestTraining(title);
});

/** The cells of a report's totals row. */
const totals = (page: Page) => page.locator("tfoot td");

async function exported(page: Page, path: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export to Excel" }).click();
  const file = path;
  await (await download).saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

test("L&D: the four reports agree with each other and with their exports", async ({ page }, testInfo) => {
  await signIn(page, "10001");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports\/staff-hours$/);
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();

  // Staff hours: the two who completed it, 9 hours each, at the top.
  await page.goto(`reports/staff-hours?${PERIOD}&show=trained`);
  const staff = page.getByRole("table", { name: "Staff hours" });
  await expect(staff.locator("tbody tr")).toHaveCount(2);
  await expect(staff.getByRole("row", { name: /10231/ })).toContainText("9 h");
  await expect(staff.getByRole("row", { name: /10002/ })).toContainText("9 h");
  await expect(totals(page).last()).toHaveText("18 h");
  // Someone absent has no hours: listed under "No training yet".
  await page.goto(`reports/staff-hours?${PERIOD}&show=untrained&q=10003`);
  await expect(staff.getByRole("row", { name: /10003/ })).toContainText("0 h");

  // Its export: the table from row 4, a totals row at the end.
  await page.goto(`reports/staff-hours?${PERIOD}&show=trained`);
  const wb = await exported(page, testInfo.outputPath("staff-hours.xlsx"));
  const ws = wb.getWorksheet("Staff hours")!;
  expect(ws.getCell("A2").value).toBe("Trainings that started 01 Jan – 31 Dec 2024");
  const header = ws.getRow(4).values as string[];
  expect(header.slice(1)).toEqual([
    "No",
    "Staff No",
    "Name",
    "Designation",
    "Status",
    "Division",
    "Department",
    "Section",
    "Trainings Completed",
    "Total Hours",
  ]);
  expect(ws.rowCount).toBe(7); // 4 heading rows, 2 staff, total
  expect(ws.getRow(7).getCell(header.indexOf("Total Hours")).value).toBe(18);

  // Department hours: 9 each for Stamping and HR & Admin, 18 in all; the average divides by headcount.
  await page.getByRole("link", { name: "Department hours" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/department-hours\\?${PERIOD}$`)); // tabs keep the period
  const departments = page.getByRole("table", { name: "Department hours" });
  const stamping = departments.getByRole("row", { name: /Stamping/ });
  await expect(stamping.getByRole("cell").nth(6)).toHaveText("9 h");
  await expect(
    departments
      .getByRole("row", { name: /Human Resources/ })
      .getByRole("cell")
      .nth(6),
  ).toHaveText("9 h");
  await expect(
    departments
      .getByRole("row", { name: /Finance/ })
      .getByRole("cell")
      .nth(6),
  ).toHaveText("0 h");
  await expect(totals(page).nth(6)).toHaveText("18 h");
  const headcount = Number(await stamping.getByRole("cell").nth(3).innerText());
  await expect(stamping.getByRole("cell").nth(7)).toHaveText(`${Math.round((9 / headcount) * 100) / 100} h`);

  // A department's row opens its staff, for the same period.
  await page.waitForLoadState("networkidle");
  await stamping.getByRole("cell").nth(3).click();
  await expect(page).toHaveURL(/\/reports\/staff-hours\?department=\d+&from=2024-01-01&to=2024-12-31$/);
  await expect(totals(page).last()).toHaveText("9 h");

  // Training attendance: the one training, 3 on it, 2 completed, 1 absent, 18 man hours.
  await page.goto(`reports/attendance?${PERIOD}`);
  const attendance = page.getByRole("table", { name: "Training attendance" });
  await expect(attendance.locator("tbody tr")).toHaveCount(1);
  const row = attendance.getByRole("row", { name: new RegExp(title) });
  await expect(row).toContainText("18 h");
  await expect(row).toContainText("Held");
  await expect(totals(page).nth(9)).toHaveText("18 h"); // man hours ("Total" spans two columns)

  // Its participants, with the hours each got.
  await page.waitForLoadState("networkidle");
  await row.getByRole("cell").nth(2).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  const people = page.getByRole("table", { name: "Participants" });
  await expect(people.locator("tbody tr")).toHaveCount(3);
  await expect(people.getByRole("row", { name: /10231/ })).toContainText("Completed");
  await expect(people.getByRole("row", { name: /10003/ })).toContainText("Absent");
  await expect(totals(page).last()).toHaveText("18 h");
  const detail = await exported(page, testInfo.outputPath("attendance.xlsx"));
  const sheet = detail.getWorksheet("Participants")!;
  expect(String(sheet.getCell("A1").value)).toContain(title);
  expect(sheet.rowCount).toBe(8); // 4 heading rows, 3 people, total
  // Back to the list as it was filtered.
  await page.getByRole("link", { name: "Training attendance" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/attendance\\?${PERIOD}$`));

  // Audit report: a line per person, hours only for those who completed it.
  await page.goto(`reports/audit?${PERIOD}`);
  const audit = page.getByRole("table", { name: "Audit report" });
  await expect(audit.locator("tbody tr")).toHaveCount(3);
  await expect(audit.getByRole("row", { name: /10231/ })).toContainText("9 h");
  await expect(audit.getByRole("row", { name: /10003/ })).toContainText("0 h");
  const auditBook = await exported(page, testInfo.outputPath("audit.xlsx"));
  const auditSheet = auditBook.getWorksheet("Audit report")!;
  const auditHeader = auditSheet.getRow(4).values as string[];
  const hours = [5, 6, 7].map((r) => auditSheet.getRow(r).getCell(auditHeader.indexOf("Hours")).value);
  expect(hours.sort()).toEqual([0, 9, 9]);
  expect(auditHeader).toContain("Certificate");
  // As on the old audit report: gender, times and program, then the 16 course feedback questions, one column each.
  for (const column of ["Gender", "Start Time", "End Time", "Program"]) expect(auditHeader).toContain(column);
  const questions = auditHeader.slice(auditHeader.indexOf("Certificate") + 1);
  expect(questions).toHaveLength(16);
  expect(questions[0]).toContain("Knowledge / skill presented in the training is suitable for job application");
  expect(questions[11]).toContain("Would you recommend the course to other employees?");
  expect(questions[15]).toContain("comments/suggestions for improvement");
});

test("a staff record shows the person's training history and hours by year", async ({ page }) => {
  await signIn(page, "10001");
  await page.goto("staff?q=10231");
  await page.getByRole("link", { name: "Nor Azlina binti Rosli" }).click();
  const training = page.getByRole("region", { name: "Training", exact: true });
  await expect(training.getByRole("row", { name: new RegExp(title) })).toContainText("Completed");
  await expect(training.getByRole("row", { name: new RegExp(title) })).toContainText("9 h");
  // 2024 has only our training.
  const y2024 = training.getByLabel("Hours by year").locator("div").filter({ hasText: "2024" });
  await expect(y2024).toContainText("9 h");
  await expect(y2024).toContainText("1 training");
});

test("a HOD sees the reports for their own department only", async ({ page }) => {
  await signIn(page, "10231");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports\/staff-hours$/);

  // Their staff only: the HR person's 9 hours aren't theirs to see.
  await page.goto(`reports/staff-hours?${PERIOD}&show=trained`);
  const staff = page.getByRole("table", { name: "Staff hours" });
  await expect(staff.locator("tbody tr")).toHaveCount(1);
  await expect(staff.getByRole("row", { name: /10231/ })).toBeVisible();
  await expect(totals(page).last()).toHaveText("9 h");
  // One department, so nothing to choose between.
  await expect(page.getByLabel("Department")).toHaveCount(0);

  await page.goto(`reports/department-hours?${PERIOD}`);
  const departments = page.getByRole("table", { name: "Department hours" });
  await expect(departments.locator("tbody tr")).toHaveCount(1);
  await expect(departments.getByRole("row", { name: /Stamping/ })).toBeVisible();

  // The training counts only their two people; the third isn't listed.
  await page.goto(`reports/attendance?${PERIOD}`);
  const row = page.getByRole("table", { name: "Training attendance" }).getByRole("row", { name: new RegExp(title) });
  await expect(row).toContainText("9 h");
  await page.waitForLoadState("networkidle");
  await row.getByRole("link", { name: title }).click();
  const people = page.getByRole("table", { name: "Participants" });
  await expect(people.locator("tbody tr")).toHaveCount(2);
  await expect(people.getByRole("row", { name: /10002/ })).toHaveCount(0);
  await expect(page.getByText("from your staff")).toBeVisible();

  await page.goto(`reports/audit?${PERIOD}`);
  await expect(page.getByRole("table", { name: "Audit report" }).locator("tbody tr")).toHaveCount(2);
  // Another department's filter gets them nothing more.
  await page.goto(`reports/audit?${PERIOD}&department=1`);
  await expect(page.getByRole("table", { name: "Audit report" }).getByRole("row", { name: /10002/ })).toHaveCount(0);
});

test("clerks and plain staff have no reports", async ({ page }) => {
  await signIn(page, "10003");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" })).toHaveCount(0);
  expect((await page.goto("reports"))?.status()).toBe(403);
  expect((await page.goto("reports/staff-hours"))?.status()).toBe(403);
  expect((await page.goto("reports/audit"))?.status()).toBe(403);
  expect((await page.request.get("reports/export?report=staff-hours")).status()).toBe(403);
  expect((await page.request.get("reports/export?report=audit")).status()).toBe(403);
});
