import { expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createTestTraining, deleteTestTraining } from "./db";
import { choose, signIn } from "./helpers";

// The Dashboard is checked against one training of our own in 2023, a year
// with nothing else in it: 9 hours, on 7 March 2023, no cost entered, with
//   10231 (HOD, Stamping): completed      10002 (HR & Admin): completed
//   10003 (Stamping): absent
// So L&D see 18 hours over two departments; Stamping's HOD sees 9 for their own.
const suffix = String(Date.now()).slice(-6);
const title = `Dashboard check ${suffix}`;
const PERIOD = "from=2023-01-01&to=2023-12-31";
const DEPARTMENTS = "All Department List (Total Man Hour)";
const PROGRESS_SHEETS = ["PME progress", "Skill matrix progress", "TNA progress", "TNI progress"];

test.beforeAll(async () => {
  await createTestTraining(
    title,
    [
      { staffNo: "10231", attendance: "COMPLETED" },
      { staffNo: "10002", attendance: "COMPLETED" },
      { staffNo: "10003", attendance: "ABSENT" },
    ],
    "2023-03-07",
  );
});
test.afterAll(async () => {
  await deleteTestTraining(title);
});

const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
/** The value of one figure of the training overview, by its label. */
const figure = (page: Page, label: string) => panel(page, "Training overview").getByText(label, { exact: true }).locator("xpath=following-sibling::dd[1]");

async function exported(page: Page, file: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export to Excel" }).click();
  await (await download).saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

test("L&D: the Dashboard's figures and charts agree with the reports and with their export", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await signIn(page, "10001");
  // Just below Overview in the sidebar.
  const nav = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  await expect(nav.nth(1)).toHaveText(/Dashboard/);
  await nav.nth(1).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({ timeout: 30_000 });
  // Only the period to choose: no division or department.
  await expect(page.getByLabel("Start date")).toBeVisible();
  await expect(page.getByLabel("Division", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Department", { exact: true })).toHaveCount(0);

  await page.goto(`dashboard?${PERIOD}`);
  await expect(page.getByRole("link", { name: "Total man hour" })).toHaveAttribute("aria-current", "page");
  // The overview: one training, two people completed it, one day each, 18 hours, all of it public.
  await expect(figure(page, "Total trainings")).toHaveText("1");
  await expect(figure(page, "Total participant attend training")).toHaveText("2");
  await expect(figure(page, "Total training days")).toHaveText("2");
  await expect(figure(page, "Total hours")).toHaveText("18 h");
  await expect(figure(page, "Total public training hours")).toHaveText("18 h100%");
  await expect(figure(page, "Total OJT hours")).toHaveText("0 h0%");
  await expect(figure(page, "Total manpower")).toHaveText(/^\d+$/);

  // Monthly total cost: none entered, and the chart says the training has none.
  const cost = panel(page, "Monthly total cost (RM)");
  await expect(cost).toContainText("1 training has no cost entered");
  // Its own year: 2023 here whatever the dates above say.
  await page.goto("dashboard");
  await choose(panel(page, "Monthly total cost (RM)"), "Year", "2023");
  await expect(page).toHaveURL(/costYear=2023/, { timeout: 30_000 });
  await expect(panel(page, "Monthly total cost (RM)")).toContainText("Trainings that started in 2023");
  await expect(panel(page, "Monthly total cost (RM)")).toContainText("1 training has no cost entered");
  // The export follows the chart's year too.
  const costBook = await exported(page, testInfo.outputPath("dashboard-cost-year.xlsx"));
  expect(String(costBook.getWorksheet("Monthly total cost")!.getCell("A2").value)).toContain("Trainings that started in 2023");

  // Every department's man hours as one chart (its table), and Most hours.
  await page.goto(`dashboard?${PERIOD}`);
  const departments = panel(page, DEPARTMENTS).getByRole("table");
  await expect(departments.getByRole("row", { name: /Stamping/ }).getByRole("cell")).toHaveText("9 h");
  await expect(departments.getByRole("row", { name: /Human Resources/ }).getByRole("cell")).toHaveText("9 h");
  await expect(departments.getByRole("row", { name: /Finance/ }).getByRole("cell")).toHaveText("0 h");
  // The same again division by division: a chart for each, so Stamping is in two charts (all departments, and its division's).
  const charts = page.getByRole("region", { name: /Total Man Hour.$/ });
  expect(await charts.count()).toBeGreaterThan(2);
  await expect(charts.getByRole("row", { name: /Stamping/ })).toHaveCount(2);
  await expect(
    charts
      .getByRole("row", { name: /Stamping/ })
      .last()
      .getByRole("cell"),
  ).toHaveText("9 h");
  await expect(panel(page, "Top 5 most hours").getByRole("listitem")).toHaveCount(2);

  // The export: a sheet for the overview and one per chart, the same numbers.
  const wb = await exported(page, testInfo.outputPath("dashboard.xlsx"));
  expect(wb.worksheets.map((w) => w.name)).toEqual([
    "Training overview",
    "Hours by training type",
    "Hours by department",
    "Top 5 most hours",
    "Top 5 in-house trainers",
    "Top 5 trainings",
    "Monthly total cost",
    ...PROGRESS_SHEETS,
  ]);
  const overview = wb.getWorksheet("Training overview")!;
  expect(String(overview.getCell("A2").value)).toContain("Trainings that started 01 Jan – 31 Dec 2023");
  const figures = new Map<string, unknown>();
  overview.eachRow((row, n) => {
    if (n > 4) figures.set(String(row.getCell(2).value), row.getCell(3).value);
  });
  expect(figures.get("Total trainings")).toBe(1);
  expect(figures.get("Total participant attend training")).toBe(2);
  expect(figures.get("Total training days")).toBe(2);
  expect(figures.get("Total hours")).toBe(18);
  expect(figures.get("Total Public / In-house hours")).toBe(18);
  expect(figures.get("Total OJT hours")).toBe(0);
  const months = wb.getWorksheet("Hours by training type")!;
  const header = months.getRow(4).values as string[];
  expect(months.rowCount).toBe(17); // 4 heading rows, 12 months, total
  expect(months.getRow(7).getCell(header.indexOf("Month")).value).toBe("March 2023");
  expect(months.getRow(17).getCell(header.indexOf("Total Hours")).value).toBe(18);

  // The second tab: the same hours per person. Apply keeps the tab.
  await page.getByRole("link", { name: "Average total hour" }).click();
  await expect(page).toHaveURL(/tab=average/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Average total hour" })).toHaveAttribute("aria-current", "page");
  // Three averages, all over the same manpower, so public and OJT add up to the total; here it is all public.
  const averageTotal = await figure(page, "Average total hours").innerText();
  expect(averageTotal).toMatch(/^[0-9.]+ h$/);
  await expect(figure(page, "Average public training hours")).toHaveText(averageTotal);
  await expect(figure(page, "Average OJT hours")).toHaveText("0 h");
  // Every department's average, then the same division by division.
  const averages = page.getByRole("region", { name: /Average Total Hour.$/ });
  await expect(
    panel(page, "All Department List (Average Total Hour)")
      .getByRole("row", { name: /Finance/ })
      .getByRole("cell"),
  ).toHaveText("0 h");
  expect(await averages.count()).toBeGreaterThan(2);
  await expect(averages.getByRole("row", { name: /Stamping/ })).toHaveCount(2);
  const byType = panel(page, "Average Monthly Total Training Hour").getByRole("table");
  await expect(
    byType
      .getByRole("row", { name: /April 2023/ })
      .getByRole("cell")
      .last(),
  ).toHaveText("0 h");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/tab=average/, { timeout: 30_000 });
  await expect(page).toHaveURL(/from=2023-01-01/);

  // The department report for the same period says the same total.
  await page.goto(`dashboard?${PERIOD}`);
  await panel(page, DEPARTMENTS).getByRole("link", { name: "Department report" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/department-hours\\?${PERIOD}$`), { timeout: 30_000 });
  await expect(page.locator("tfoot td").nth(6)).toHaveText("18 h");

  // A department in the address changes nothing: the Dashboard has no such filter.
  await page.goto(`dashboard?${PERIOD}&department=1&division=1`);
  await expect(figure(page, "Total hours")).toHaveText("18 h");
  await expect(panel(page, "Monthly total cost (RM)")).toBeVisible();
});

test("a HOD sees the Dashboard for their own department only", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, "10231");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" })).toBeVisible();
  await page.goto(`dashboard?${PERIOD}`);
  // Their own 9 hours; the HR person's aren't theirs to see.
  await expect(figure(page, "Total hours")).toHaveText("9 h");
  await expect(figure(page, "Total participant attend training")).toHaveText("1");
  await expect(panel(page, "Top 5 most hours").getByRole("listitem")).toHaveCount(1);
  await expect(panel(page, "Top 5 most hours")).not.toContainText("10002");
  // One department: nothing to compare. Cost is L&D's alone.
  await expect(panel(page, DEPARTMENTS)).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Total Man Hour.$/ })).toHaveCount(0);
  await expect(panel(page, "Monthly total cost (RM)")).toHaveCount(0);
  // Asking for a cost year gets them nothing more.
  await page.goto(`dashboard?${PERIOD}&costYear=2023`);
  await expect(panel(page, "Monthly total cost (RM)")).toHaveCount(0);

  const wb = await exported(page, testInfo.outputPath("dashboard-hod.xlsx"));
  expect(wb.worksheets.map((w) => w.name)).toEqual([
    "Training overview",
    "Hours by training type",
    "Hours by department",
    "Top 5 most hours",
    "Top 5 in-house trainers",
    "Top 5 trainings",
    ...PROGRESS_SHEETS,
  ]);
  expect(wb.getWorksheet("Hours by department")!.rowCount).toBe(6); // 4 heading rows, Stamping, total
});

test("the Progress tab shows how far each department has got, and its export says the same", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page, "10001");
  await page.goto("dashboard");
  await page.getByRole("link", { name: "Progress", exact: true }).click();
  await expect(page).toHaveURL(/tab=progress/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Progress", exact: true })).toHaveAttribute("aria-current", "page");

  // Four cards, one for each workflow, each a share finished and "x of y".
  const overview = page.getByRole("region", { name: "Progress overview" });
  for (const label of [/^PME verified$/, /^Skill matrix approved, Q[1-4] 20[0-9]{2}$/, /^TNA approved, 20[0-9]{2}$/, /^TNI saved, 20[0-9]{2}$/])
    await expect(overview.getByText(label)).toBeVisible();
  const card = (label: RegExp) => overview.locator("div.card").filter({ has: page.getByText(label) });
  const counts = async (label: RegExp) => {
    const found = /([0-9,]+) of ([0-9,]+)/.exec(await card(label).innerText());
    expect(found, String(label)).not.toBeNull();
    return { done: Number(found![1].replaceAll(",", "")), of: Number(found![2].replaceAll(",", "")) };
  };
  const skill = await counts(/^Skill matrix approved/);
  const tna = await counts(/^TNA approved/);
  const tni = await counts(/^TNI saved/);

  // A chart for each of PME, skill matrix and TNA: a column for every department; TNI as a list of them.
  const skillChart = page.getByRole("region", { name: /^Skill matrix by department/ });
  await expect(skillChart.getByRole("row", { name: /Stamping/ })).toHaveCount(1);
  await expect(page.getByRole("region", { name: /^TNA by department/ }).getByRole("row", { name: /Finance/ })).toHaveCount(1);
  const tniList = page.getByRole("region", { name: /^TNI by department/ }).getByRole("listitem");
  await expect(tniList).toHaveCount(tni.of);
  await expect(tniList.filter({ hasText: "Saved" })).toHaveCount(tni.done);

  // PMEs follow the period: a year with no PME says so.
  await page.goto(`dashboard?tab=progress&${PERIOD}`);
  await expect(page.getByRole("region", { name: "PME by department" })).toContainText("No PME for trainings in this period");
  // Apply keeps the tab.
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/tab=progress/, { timeout: 30_000 });

  // The export: a sheet for each workflow, the same totals as the cards.
  const wb = await exported(page, testInfo.outputPath("dashboard-progress.xlsx"));
  for (const name of PROGRESS_SHEETS) expect(wb.getWorksheet(name), name).toBeDefined();
  const totalOf = (name: string) => {
    const ws = wb.getWorksheet(name)!;
    const header = ws.getRow(4).values as string[];
    return { all: ws.getRow(ws.rowCount).getCell(header.indexOf("Total")).value, done: ws.getRow(ws.rowCount).getCell(header.indexOf("Approved")).value };
  };
  expect(totalOf("Skill matrix progress")).toEqual({ all: skill.of, done: skill.done });
  expect(totalOf("TNA progress")).toEqual({ all: tna.of, done: tna.done });
  expect(wb.getWorksheet("TNI progress")!.rowCount).toBe(4 + tni.of);
});

test("a HOD's Progress tab covers their own department only", async ({ page }) => {
  await signIn(page, "10231");
  await page.goto("dashboard?tab=progress");
  const tniList = page.getByRole("region", { name: /^TNI by department/ }).getByRole("listitem");
  await expect(tniList).toHaveCount(1);
  await expect(tniList).toContainText("Stamping");
  // One column in each chart, and no ranking of departments.
  const skillChart = page.getByRole("region", { name: /^Skill matrix by department/ });
  await expect(skillChart.getByRole("row", { name: /Stamping/ })).toHaveCount(1);
  await expect(skillChart.getByRole("row", { name: /Finance/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "PMEs waiting for the HOD" })).toHaveCount(0);
});

test("clerks and plain staff have no Dashboard", async ({ page }) => {
  await signIn(page, "10003");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  expect((await page.goto("dashboard"))?.status()).toBe(403);
  expect((await page.goto("dashboard?tab=progress"))?.status()).toBe(403);
  expect((await page.request.get("dashboard/export")).status()).toBe(403);
});
