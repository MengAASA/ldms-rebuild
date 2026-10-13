import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { deleteTestStaff } from "./db";
import { choose, signIn } from "./helpers";

// Uses fresh staff numbers on every run, and removes those staff afterwards, so the demo data is left as it was.
const suffix = String(Date.now()).slice(-6);

test.afterAll(async () => {
  await deleteTestStaff(["E", "C", "X", "N", "K"].map((letter) => `${letter}${suffix}`));
});

test("admin adds a staff member, marks them resigned and reinstates them", async ({ page }) => {
  const staffNo = `E${suffix}`;
  await signIn(page, "10001");
  await page.goto("staff/new");
  await page.getByLabel("Staff no.").fill(staffNo);
  await page.getByLabel("Full name").fill("Nurul Izzah binti Othman");
  await choose(page, "Designation", "Executive");
  await choose(page, "Gender", "Female");
  await page.getByLabel("Plant").fill("pegoh  plant"); // saved in capitals, spaces tidied
  await choose(page, "Department", "Quality Control");
  await choose(page, "Section", "Final Inspection");
  await page.getByRole("button", { name: "Add staff" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Staff record added." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nurul Izzah binti Othman" })).toBeVisible();
  await expect(page.getByText("HOD of the department")).toBeVisible();
  await expect(page.getByText("GenderFemale")).toBeVisible();
  await expect(page.getByText("PlantPEGOH PLANT")).toBeVisible();

  await page.getByRole("button", { name: "Mark as resigned" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as resigned" }).click();
  await expect(page.getByRole("dialog").getByText("Marked as resigned.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Cannot sign in (resigned)")).toBeVisible();

  await page.getByRole("button", { name: "Reinstate" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reinstate" }).click();
  await expect(page.getByRole("dialog").getByText("Reinstated as active.")).toBeVisible();
});

test("clerk imports contract staff; other designations are rejected per row", async ({ page }, testInfo) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Staff");
  ws.addRow(["Staff No", "Name", "Email", "Position", "Designation", "Department", "Section", "Date Joined"]);
  ws.addRow([`C${suffix}`, "Aung Ko Ko", "", "Production Operator", "Contract", "STP", "Press Line A", "01/10/2026"]);
  ws.addRow([`X${suffix}`, "Lee Jun Hao", "", "Engineer", "Executive", "Die Engineering", "", "01/10/2026"]);
  const file = testInfo.outputPath("import.xlsx");
  await wb.xlsx.writeFile(file);

  await signIn(page, "10003");
  await page.goto("staff/import");
  await page.setInputFiles("#file", file);
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText("Clerks can import contract staff only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import 1 row" })).toBeDisabled();

  await page.getByLabel(/Skip the 1 row with errors/).check();
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 1 added, 0 updated, 1 rows with errors skipped.")).toBeVisible();
});

test("job grade, who fills in their own TNA, and the Skill matrix evaluator role", async ({ page }, testInfo) => {
  const staffNo = `N${suffix}`;
  await signIn(page, "10001");

  // L&D add a non-executive in job grade 3 who fills in their own TNA.
  await page.goto("staff/new");
  await page.getByLabel("Staff no.").fill(staffNo);
  await page.getByLabel("Full name").fill("Siti Aminah binti Yusof");
  await choose(page, "Designation", "Non-executive");
  await choose(page, "Department", "Finance & Accounts");
  await choose(page, "Job grade", "Grade 3");
  await page.getByLabel("Fills in their own TNA").check();
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Staff record added." })).toBeVisible();
  const employment = page.getByRole("region", { name: "Employment" });
  await expect(employment).toContainText("Job grade3");
  await expect(employment).toContainText("Fills in their own (set by L&D)");

  // Unticked, they are covered by their grade's TNA; an executive always fills in their own.
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Fills in their own TNA").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(employment).toContainText("By job grade 3, for the department");
  await expect(page.getByRole("region", { name: "History" })).toContainText("Fills in own TNA: Yes → No");
  await page.getByRole("link", { name: "Edit" }).click();
  await choose(page, "Designation", "Executive");
  await expect(page.getByText("Executives and managers fill in their own TNA each year")).toBeVisible();
  await expect(page.getByLabel("Fills in their own TNA")).toHaveCount(0);
  await page.getByRole("link", { name: "Cancel" }).click();

  // The evaluator role is given on the record, like the others.
  const access = page.getByRole("region", { name: "Access" });
  await access.getByLabel(/Skill matrix evaluator/).check();
  await access.getByRole("button", { name: "Save access" }).click();
  await expect(access.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(access.getByLabel(/Skill matrix evaluator/)).toBeChecked();
  await expect(access.getByLabel(/L&D admin/)).not.toBeChecked();

  // The export carries both columns.
  await page.goto(`staff?q=${staffNo}`);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export to Excel" }).click();
  const exported = testInfo.outputPath("staff.xlsx");
  await (await download).saveAs(exported);
  const out = new ExcelJS.Workbook();
  await out.xlsx.readFile(exported);
  const sheet = out.getWorksheet("Staff")!;
  const header = sheet.getRow(1).values as string[];
  expect(sheet.getRow(2).getCell(header.indexOf("Job Grade")).value).toBe(3);
  expect(sheet.getRow(2).getCell(header.indexOf("Fills Own TNA")).value).toBe("No");
  expect(header).toContain("Gender");
  expect(header).toContain("Plant");

  // An import with the new columns sets them; one in the old layout leaves them as they are.
  const importWith = async (name: string, headings: string[], row: (string | number)[], expected: RegExp) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Staff");
    ws.addRow(headings);
    ws.addRow(row);
    const file = testInfo.outputPath(name);
    await wb.xlsx.writeFile(file);
    await page.goto("staff/import");
    await page.setInputFiles("#file", file);
    await page.getByRole("button", { name: "Check file" }).click();
    await page.getByRole("button", { name: "Import 1 row" }).click();
    await expect(page.getByText(expected)).toBeVisible();
  };
  const old = ["Staff No", "Name", "Email", "Position", "Designation", "Department", "Section", "Date Joined"];
  const base = [staffNo, "Siti Aminah binti Yusof", "", "Accounts Assistant", "Non-executive", "Finance & Accounts", "", ""];
  await importWith("new-columns.xlsx", [...old, "Job Grade", "Fills Own TNA", "Gender", "Plant"], [...base, 5, "Yes", "female", "Rasa Plant"], /0 added, 1 updated/);
  await page.goto(`staff?q=${staffNo}`);
  await page.getByRole("link", { name: "Siti Aminah binti Yusof" }).click();
  await expect(employment).toContainText("Job grade5");
  await expect(employment).toContainText("GenderFemale");
  await expect(employment).toContainText("PlantRASA PLANT");
  await expect(employment).toContainText("Fills in their own (set by L&D)");
  await importWith("old-layout.xlsx", old, [...base.slice(0, 3), "Senior Accounts Assistant", ...base.slice(4)], /0 added, 1 updated/);
  await page.goto(`staff?q=${staffNo}`);
  await page.getByRole("link", { name: "Siti Aminah binti Yusof" }).click();
  await expect(employment).toContainText("Senior Accounts Assistant");
  await expect(employment).toContainText("Job grade5");
  // A file without the Gender or Plant column leaves them as they were.
  await expect(employment).toContainText("GenderFemale");
  await expect(employment).toContainText("PlantRASA PLANT");
  await expect(employment).toContainText("Fills in their own (set by L&D)");
});

test("a clerk can set a contract worker's job grade but not who fills in their own TNA", async ({ page }) => {
  const staffNo = `K${suffix}`;
  await signIn(page, "10003");
  await page.goto("staff/new");
  await page.getByLabel("Staff no.").fill(staffNo);
  await page.getByLabel("Full name").fill("Min Thant Zaw");
  await choose(page, "Department", "Stamping");
  await choose(page, "Job grade", "Grade 2");
  await expect(page.getByLabel("Fills in their own TNA")).toBeDisabled();
  await expect(page.getByText("Only the L&D unit can change this.")).toBeVisible();
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Staff record added." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Employment" })).toContainText("By job grade 2, for the department");
});
