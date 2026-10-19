import { type Browser, expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createTestSkillMatrix, deleteTestSkillMatrices, giveRole } from "./db";
import { signIn } from "./helpers";

// The skill matrix runs between two people in Stamping:
//   10003 Ooi Boon Kiat, given the Skill matrix evaluator role for the run: fills in
//   10231 Nor Azlina binti Rosli, the HOD: approves or sends back
// about non-executive staff there (10235 to 10239). 10001 (L&D) and 10002
// (main clerk in another department) check who else can see what. Every
// matrix these tests make is removed at the end.
const SUBJECTS = ["10235", "10236", "10237", "10238", "10239"];
const LOW = "Low Kai Xuan"; // 10235
const TAN = "Tan Wei Liang"; // 10236
const CHONG = "Chong Siew Yin"; // 10237
const GANESAN = "Ganesan a/l Muniandy"; // 10238
const AZRUL = "Mohd Azrul bin Othman"; // 10239

// The quarter being filled in is the one that has just ended; the one before it is closed.
const now = new Date(Date.now() + 8 * 3_600_000);
const thisQuarter = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3);
const quarterAt = (n: number) => ({ year: Math.floor(n / 4), quarter: (n % 4) + 1 });
const OPEN = quarterAt(thisQuarter - 1);
const CLOSED = quarterAt(thisQuarter - 2);
const label = (q: { year: number; quarter: number }) => `Q${q.quarter} ${q.year}`;
const param = (q: { year: number; quarter: number }) => `${q.year}-${q.quarter}`;

let removeRole: () => Promise<void> = async () => {};

test.beforeAll(async () => {
  await deleteTestSkillMatrices(SUBJECTS);
  removeRole = await giveRole("10003", "SKILL_EVALUATOR");
});
test.afterAll(async () => {
  await deleteTestSkillMatrices(SUBJECTS);
  await removeRole();
});

/** A signed-in page of its own, so people can take turns. */
async function as(browser: Browser, staffNo: string) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, staffNo);
  return page;
}

const dialog = (page: Page) => page.getByRole("dialog");
const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const list = (page: Page) => page.getByRole("table", { name: "Skill matrices" });
const row = (page: Page, name: string) => list(page).getByRole("row", { name: new RegExp(name) });

/** Fills in one topic's name and its first line, with a rating. */
async function fillTopic(page: Page, section: "Knowledge" | "Skill" | "Ability", name: string, line: string, rating: string) {
  await page.getByLabel(`${section} topic 1`, { exact: true }).fill(name);
  await page.getByLabel(`${section} topic 1, line 1`, { exact: true }).fill(line);
  await page
    .getByRole("radiogroup", { name: `Rating for ${section.toLowerCase()} topic 1, line 1` })
    .getByRole("radio", { name: rating })
    .click();
}

test("a skill matrix goes from draft to approved: fill in, submit, duplicate, send back, approve, chart", async ({ browser }) => {
  test.setTimeout(240_000);
  const evaluator = await as(browser, "10003");
  const hod = await as(browser, "10231");
  let id = 0;

  await test.step("the evaluator starts a matrix for the open quarter and saves a draft", async () => {
    await expect(evaluator.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Skill matrix/ })).toBeVisible();
    await evaluator.goto("skill-matrix");
    await expect(evaluator.getByRole("heading", { name: "Skill matrix", level: 1 })).toBeVisible();
    await expect(evaluator.getByText(label(OPEN)).first()).toBeVisible();
    // The department has well over a page of staff, so find people by staff no.
    await evaluator.goto("skill-matrix?q=10235");
    await expect(row(evaluator, LOW)).toContainText("Not started");
    await row(evaluator, LOW).getByRole("link", { name: "Start" }).click();
    await expect(evaluator.getByRole("heading", { name: LOW, level: 1 })).toBeVisible();
    await evaluator.waitForLoadState("networkidle");

    // Nothing typed: there is nothing to save, even as a draft.
    await evaluator.getByRole("button", { name: "Save as draft" }).click();
    await expect(evaluator.getByText("Add at least one topic before saving.").first()).toBeVisible();

    // One topic is enough for a draft, and its score shows as it is rated.
    await fillTopic(evaluator, "Knowledge", "Die setting", "Knows the die change steps", "4, Advanced");
    await expect(evaluator.getByText("80%")).toBeVisible();
    // ... but not enough to submit: each section needs a topic.
    await evaluator.getByRole("button", { name: "Submit to HOD" }).click();
    await expect(evaluator.getByText("Add at least one skill topic.")).toBeVisible();
    await expect(evaluator.getByText("Add at least one ability topic.")).toBeVisible();
    await evaluator.getByRole("button", { name: "Save as draft" }).click();
    await expect(evaluator.getByRole("status").first()).toHaveText("Draft saved. Submit it to the HOD when it's complete.");
    await evaluator.waitForURL(/\/skill-matrix\/\d+\?/);
    id = Number(new URL(evaluator.url()).pathname.split("/").pop());
    await expect(panel(evaluator, "Record")).toContainText("Draft");
    await expect(panel(evaluator, "Knowledge")).toContainText("Die setting");

    // Submitting the unfinished draft from its page is refused, with what is missing.
    await evaluator.getByRole("button", { name: "Submit to HOD" }).click();
    await dialog(evaluator).getByRole("button", { name: "Submit" }).click();
    await expect(dialog(evaluator).getByRole("alert")).toContainText("This matrix isn't complete yet: Add at least one skill topic");
    await dialog(evaluator).getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("the evaluator finishes it and submits; the HOD hasn't seen it until then", async () => {
    await hod.goto("approvals");
    await expect(hod.getByRole("row", { name: new RegExp(LOW) })).toHaveCount(0);

    await evaluator.getByRole("link", { name: "Edit" }).click();
    await evaluator.waitForLoadState("networkidle");
    await expect(evaluator.getByLabel("Knowledge topic 1", { exact: true })).toHaveValue("Die setting");
    await evaluator.getByRole("button", { name: "Add skill topic" }).click();
    await fillTopic(evaluator, "Skill", "Press operation", "Runs the 200T press alone", "5, Expert");
    await evaluator.getByRole("button", { name: "Add ability topic" }).click();
    await fillTopic(evaluator, "Ability", "Teamwork", "Hands over cleanly at shift change", "3, Competent");
    // A line with words but no rating can't be submitted.
    await evaluator.getByRole("region", { name: "Skill", exact: true }).getByRole("button", { name: "Add line" }).click();
    await evaluator.getByLabel("Skill topic 1, line 2", { exact: true }).fill("Clears a misfeed");
    await evaluator.getByRole("button", { name: "Submit to HOD" }).click();
    await expect(evaluator.getByText("Rate every line.")).toBeVisible();
    await evaluator.getByRole("radiogroup", { name: "Rating for skill topic 1, line 2" }).getByRole("radio", { name: "3, Competent" }).click();
    await evaluator.getByRole("button", { name: "Submit to HOD" }).click();
    await expect(evaluator.getByRole("status").first()).toHaveText("Submitted. The HOD can now approve it or send it back.");
    await expect(panel(evaluator, "Record")).toContainText("Waiting for HOD");
    // With the HOD: the evaluator can't change or delete it, and can never approve it.
    await expect(evaluator.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(evaluator.getByRole("button", { name: "Delete" })).toBeHidden();
    await expect(evaluator.getByRole("button", { name: "Approve" })).toHaveCount(0);
    expect((await evaluator.goto(`skill-matrix/${id}/edit`))?.status()).toBe(200);
    await expect(evaluator.getByText("This matrix is with the HOD for approval. It can be changed only if they send it back.")).toBeVisible();
  });

  await test.step("the evaluator duplicates it to two others as drafts", async () => {
    await evaluator.goto(`skill-matrix/${id}`);
    await evaluator.waitForLoadState("networkidle");
    await evaluator.getByRole("button", { name: "Duplicate" }).click();
    const d = dialog(evaluator);
    await expect(d.getByText("Loading staff")).toBeHidden();
    // Low Kai Xuan already has one this quarter, so isn't offered.
    await d.getByLabel("Search staff").fill("10235");
    await expect(d.getByText("No one matches.")).toBeVisible();
    for (const staffNo of ["10236", "10237"]) {
      await d.getByLabel("Search staff").fill(staffNo);
      await d.getByRole("list", { name: "Staff" }).getByRole("checkbox").first().check();
    }
    await d.getByRole("button", { name: "Duplicate to 2" }).click();
    await expect(d.getByRole("status")).toContainText("2 drafts made.");
    await d.getByRole("button", { name: "Close" }).click();
    await evaluator.goto("skill-matrix?q=1023");
    await expect(row(evaluator, TAN)).toContainText("Draft");
    await expect(row(evaluator, CHONG)).toContainText("Draft");
    // A copy says where it came from, and a draft can be deleted.
    await row(evaluator, CHONG).getByRole("link", { name: CHONG }).click();
    await expect(panel(evaluator, "Record")).toContainText(`${LOW}, ${label(OPEN)}`);
    await expect(panel(evaluator, "Skill")).toContainText("Clears a misfeed");
    await evaluator.waitForLoadState("networkidle");
    await evaluator.getByRole("button", { name: "Delete" }).click();
    await dialog(evaluator).getByRole("button", { name: "Delete" }).click();
    await expect(evaluator.getByRole("status").first()).toHaveText("Draft deleted.");
    await evaluator.goto("skill-matrix?q=10237");
    await expect(row(evaluator, CHONG)).toContainText("Not started");
  });

  await test.step("the HOD sends it back with a reason; the evaluator changes it and submits again", async () => {
    await hod.goto("approvals");
    await expect(hod.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Approvals/ })).toContainText(/[1-9]/);
    const waiting = panel(hod, "Skill matrices to approve").getByRole("row", { name: new RegExp(LOW) });
    await expect(waiting).toContainText(label(OPEN));
    await waiting.getByRole("link", { name: "Review" }).click();
    await expect(hod.getByRole("heading", { name: LOW, level: 1 })).toBeVisible();
    await hod.waitForLoadState("networkidle");
    // The HOD approves or sends back; they don't fill in.
    await expect(hod.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await hod.getByRole("button", { name: "Send back" }).click();
    await dialog(hod).getByRole("button", { name: "Send back" }).click();
    await expect(dialog(hod).getByText("Say what needs changing")).toBeVisible();
    await dialog(hod).getByLabel("Reason").fill("Add the coil loading topic");
    await dialog(hod).getByRole("button", { name: "Send back" }).click();
    await expect(dialog(hod).getByRole("status")).toHaveText("Sent back to the evaluator, who can now change it and submit again.");
    await dialog(hod).getByRole("button", { name: "Close" }).click();
    await expect(panel(hod, "Record")).toContainText("Sent back");

    await evaluator.goto("skill-matrix?q=10235");
    await expect(evaluator.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Skill matrix/ })).toContainText("1");
    await expect(row(evaluator, LOW)).toContainText("Sent back");
    await row(evaluator, LOW).getByRole("link", { name: "Continue" }).click();
    await evaluator.waitForLoadState("networkidle");
    await expect(evaluator.getByText("Add the coil loading topic")).toBeVisible();
    await evaluator.getByRole("button", { name: "Add skill topic" }).click();
    await evaluator.getByLabel("Skill topic 2", { exact: true }).fill("Coil loading");
    await evaluator.getByLabel("Skill topic 2, line 1", { exact: true }).fill("Loads a coil with the crane");
    await evaluator.getByRole("radiogroup", { name: "Rating for skill topic 2, line 1" }).getByRole("radio", { name: "2, Basic" }).click();
    await evaluator.getByRole("button", { name: "Submit to HOD" }).click();
    await expect(evaluator.getByRole("status").first()).toHaveText("Submitted. The HOD can now approve it or send it back.");
  });

  await test.step("the HOD approves; it is locked", async () => {
    await hod.goto(`skill-matrix/${id}`);
    await hod.waitForLoadState("networkidle");
    await expect(panel(hod, "Skill")).toContainText("Coil loading");
    await hod.getByRole("button", { name: "Approve" }).click();
    await dialog(hod).getByRole("button", { name: "Approve" }).click();
    await expect(dialog(hod).getByRole("status")).toHaveText("Approved.");
    await dialog(hod).getByRole("button", { name: "Close" }).click();
    await expect(panel(hod, "Record")).toContainText("Approved");
    await expect(hod.getByRole("button", { name: "Approve" })).toBeHidden();
    await expect(hod.getByRole("button", { name: "Send back" })).toBeHidden();

    await evaluator.goto(`skill-matrix/${id}`);
    await expect(evaluator.getByRole("link", { name: "Edit" })).toHaveCount(0);
    expect((await evaluator.goto(`skill-matrix/${id}/edit`))?.status()).toBe(200);
    await expect(evaluator.getByText("The HOD has approved this matrix, so it can't be changed.")).toBeVisible();
    // One per person per quarter: starting another goes to the one on record.
    await evaluator.goto("skill-matrix?q=10235");
    await expect(row(evaluator, LOW).getByRole("link", { name: "Start" })).toHaveCount(0);
  });

  await test.step("the chart, its export and the staff record show the approved matrix", async () => {
    await hod.goto(`skill-matrix/chart?quarter=${param(OPEN)}`);
    const chart = hod.getByRole("table", { name: "Matrix chart" });
    // Knowledge 4/5 = 80; Skill (5+3)/10 = 80 and 2/5 = 40; Ability 3/5 = 60. Average of the four topics: 65.
    const low = chart.getByRole("row", { name: new RegExp(LOW) });
    await expect(low).toContainText("65%");
    await expect(chart.getByRole("columnheader", { name: "Coil loading" })).toBeVisible();
    // Drafts aren't charted.
    await expect(chart.getByRole("row", { name: new RegExp(TAN) })).toHaveCount(0);

    const download = hod.waitForEvent("download");
    await hod.getByRole("link", { name: "Export to Excel" }).click();
    const file = test.info().outputPath("chart.xlsx");
    await (await download).saveAs(file);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet("Matrix chart")!;
    const header = Array.from(ws.getRow(5).values as unknown[], (v) => String(v ?? ""));
    const found: unknown[][] = [];
    ws.eachRow((r) => {
      const values = r.values as unknown[];
      if (values[2] === "10235") found.push(values);
    });
    expect(found).toHaveLength(1);
    // The export is laid out as the old chart: a column per level, holding the topics that scored there.
    const cell = (name: string) => found[0][header.findIndex((h) => h.includes(name))] ?? "";
    expect(cell("Highly skilled")).toBe("");
    expect(cell("Competent")).toBe("1. Die setting  80%\n2. Press operation  80%");
    expect(cell("Medium competency")).toBe("4. Teamwork  60%");
    expect(cell("Novice")).toBe("3. Coil loading  40%");
    expect(cell("Minimal competency")).toBe("");
    expect(cell("Average")).toBe(65);
    expect(String(ws.getCell(4, 5).value)).toBe("Ability description");
    expect(cell("Status")).toBe("Approved");
    expect(cell("Evaluated By")).toBe("Ooi Boon Kiat");
    expect(cell("Approved By")).toBe("Nor Azlina binti Rosli");

    await hod.goto("staff?q=10235");
    await hod.getByRole("link", { name: LOW }).click();
    const history = panel(hod, "Skill matrix").getByRole("row", { name: new RegExp(label(OPEN)) });
    await expect(history).toContainText("Approved");
    await expect(history).toContainText("65%");
  });
});

test("a closed quarter is view-only: no edits, the HOD can still approve, and a matrix can be carried forward", async ({ browser }) => {
  test.setTimeout(180_000);
  // Last quarter's leftovers: one submitted in time but never approved, one draft never sent.
  const submittedId = await createTestSkillMatrix("10238", CLOSED, "SUBMITTED", "10003");
  const draftId = await createTestSkillMatrix("10239", CLOSED, "DRAFT", "10003");
  await createTestSkillMatrix("10237", CLOSED, "SUBMITTED", "10003"); // a second one waiting, so Approvals has something to filter
  const evaluator = await as(browser, "10003");
  const hod = await as(browser, "10231");

  await test.step("the evaluator can look at the closed quarter but not change it", async () => {
    await evaluator.goto(`skill-matrix?quarter=${param(CLOSED)}&q=10239`);
    await expect(evaluator.getByText(`${label(CLOSED)} closed on`).first()).toBeVisible();
    await expect(evaluator.getByText("Closed: view only")).toBeVisible();
    await expect(row(evaluator, AZRUL)).toContainText("Draft");
    // No Start for anyone, no Continue for the draft.
    await expect(list(evaluator).getByRole("link", { name: "Start" })).toHaveCount(0);
    await expect(list(evaluator).getByRole("link", { name: "Continue" })).toHaveCount(0);

    await evaluator.goto(`skill-matrix/${draftId}`);
    await expect(evaluator.getByText(/closed on .+ before this draft was submitted, so it can only be viewed/)).toBeVisible();
    await expect(evaluator.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(evaluator.getByRole("button", { name: "Submit to HOD" })).toBeHidden();
    await expect(evaluator.getByRole("button", { name: "Delete" })).toBeHidden();
    await evaluator.goto(`skill-matrix/${draftId}/edit`);
    await expect(evaluator.getByText(new RegExp(`${label(CLOSED)} closed on .+ so its matrices can only be viewed`))).toBeVisible();
    await expect(evaluator.getByRole("button", { name: "Save as draft" })).toHaveCount(0);
  });

  await test.step("the closed draft is duplicated into the open quarter, for the same person", async () => {
    await evaluator.goto(`skill-matrix/${draftId}`);
    await evaluator.waitForLoadState("networkidle");
    await evaluator.getByRole("button", { name: "Duplicate" }).click();
    const d = dialog(evaluator);
    await expect(d.getByText("Loading staff")).toBeHidden();
    await expect(d.getByText(label(OPEN))).toBeVisible();
    await d.getByLabel("Search staff").fill("10239");
    await d.getByRole("list", { name: "Staff" }).getByRole("checkbox").first().check();
    await d.getByRole("button", { name: "Duplicate to 1" }).click();
    await expect(d.getByRole("status")).toContainText("1 draft made.");
    await d.getByRole("button", { name: "Close" }).click();
    await evaluator.goto("skill-matrix?q=10239");
    await expect(row(evaluator, AZRUL)).toContainText("Draft");
    await row(evaluator, AZRUL).getByRole("link", { name: "Continue" }).click();
    await expect(evaluator.getByLabel("Knowledge topic 1", { exact: true })).toHaveValue("Test knowledge topic");
  });

  await test.step("the HOD narrows Approvals by a search and by the kind of record", async () => {
    await hod.goto("approvals");
    const filters = hod.getByRole("search", { name: "Filter approvals" });
    await filters.getByLabel("Search").fill("10238");
    await filters.getByRole("button", { name: "Apply" }).click();
    await expect(hod).toHaveURL(/q=10238/);
    const matrices = panel(hod, "Skill matrices to approve");
    await expect(matrices.getByRole("row", { name: new RegExp(GANESAN) })).toBeVisible();
    await expect(matrices.getByRole("row", { name: new RegExp(CHONG) })).toHaveCount(0);
    await expect(matrices).toContainText("1 to do");
    await expect(filters.getByLabel("Search")).toHaveValue("10238");

    // The evaluator's name finds both; showing skill matrices only leaves out everything else.
    await hod.goto("approvals?kind=SKILL&q=ooi+boon");
    await expect(matrices.getByRole("row", { name: new RegExp(`${GANESAN}|${CHONG}`) })).toHaveCount(2);
    await expect(panel(hod, "PMEs to evaluate")).toHaveCount(0);
    await expect(panel(hod, "TNAs to approve")).toHaveCount(0);
    await expect(matrices.getByRole("button", { name: "Approve all 2" })).toBeVisible();

    await hod.goto("approvals?q=no+one+is+called+this");
    await expect(hod.getByText("Nothing matches")).toBeVisible();
    await hod.getByRole("link", { name: "Clear the filters" }).click();
    await expect(matrices.getByRole("row", { name: new RegExp(GANESAN) })).toBeVisible();
  });

  await test.step("the matrix submitted in time still waits for the HOD, who can approve but not send back", async () => {
    await hod.goto("approvals");
    const waiting = panel(hod, "Skill matrices to approve").getByRole("row", { name: new RegExp(GANESAN) });
    await expect(waiting).toContainText(label(CLOSED));
    await expect(waiting).toContainText("Quarter closed");
    await waiting.getByRole("link", { name: "Review" }).click();
    await expect(hod.getByText(/This matrix was submitted in time and still waits for the HOD's approval/)).toBeVisible();
    await hod.waitForLoadState("networkidle");
    await expect(hod.getByRole("button", { name: "Send back" })).toBeHidden();
    await hod.getByRole("button", { name: "Approve" }).click();
    await dialog(hod).getByRole("button", { name: "Approve" }).click();
    await expect(dialog(hod).getByRole("status")).toHaveText("Approved.");
    await dialog(hod).getByRole("button", { name: "Close" }).click();
    await hod.goto("approvals");
    await expect(hod.getByRole("row", { name: new RegExp(GANESAN) })).toHaveCount(0);
  });

  await test.step("L&D see it; other departments and people without the role don't", async () => {
    const ld = await as(browser, "10001");
    expect((await ld.goto(`skill-matrix/${submittedId}`))?.status()).toBe(200);
    await expect(ld.getByRole("heading", { name: GANESAN, level: 1 })).toBeVisible();
    await ld.context().close();

    // The main clerk fills in for their own department (HR & Administration), not Stamping.
    const clerk = await as(browser, "10002");
    expect((await clerk.goto("skill-matrix"))?.status()).toBe(200);
    await expect(row(clerk, LOW)).toHaveCount(0);
    expect((await clerk.goto(`skill-matrix/${submittedId}`))?.status()).toBe(404);
    expect((await clerk.goto("skill-matrix/new?staff=1"))?.status()).toBe(404);
    await clerk.context().close();

    // Without the evaluator role, the clerk who filled these in has no skill matrix screens at all.
    await removeRole();
    removeRole = async () => {};
    expect((await evaluator.goto("skill-matrix"))?.status()).toBe(403);
    expect((await evaluator.goto(`skill-matrix/${submittedId}`))?.status()).toBe(403);
    expect((await evaluator.goto("skill-matrix/chart"))?.status()).toBe(403);
    expect((await evaluator.request.get(`skill-matrix/chart/export?quarter=${param(OPEN)}&department=1`)).status()).toBe(403);
    await expect(evaluator.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Skill matrix/ })).toHaveCount(0);
  });
});
