import { type Browser, expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createTestTraining, deleteTestTraining, giveDemoPassword, makeTestPmes } from "./db";
import { choose, DEMO_PASSWORD, signIn, writeFeedbackAnswers } from "./helpers";

// PME runs between three people, all in Stamping:
//   10232 Ahmad Zulkifli bin Rosli, an executive: the one evaluated
//   10231 Nor Azlina binti Rosli, the HOD: evaluates
//   10001, L&D: verifies or sends back
// plus 10003 (non-executive, Stamping, a clerk) and 10318 (HOD of another
// department), who must be kept out. The tests make their own trainings and
// remove them; 10232 and 10318 get the demo password for the run only.
const suffix = String(Date.now()).slice(-6);
const HELD = `PME path ${suffix}`; // long enough ago that its evaluation period has ended
const RECENT = `PME period ${suffix}`; // still in its evaluation period
const SHORT = `PME short ${suffix}`; // 3 hours: no evaluation needed
const STAFF = "Ahmad Zulkifli bin Rosli";

const daysAgo = (n: number) => new Date(Date.now() + 8 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);

let heldId = 0;
let recentId = 0;
const restore: (() => Promise<void>)[] = [];

test.beforeAll(async () => {
  restore.push(await giveDemoPassword("10232", DEMO_PASSWORD), await giveDemoPassword("10318", DEMO_PASSWORD));
  heldId = await createTestTraining(HELD, [{ staffNo: "10232", attendance: "PENDING" }], daysAgo(120));
  recentId = await createTestTraining(
    RECENT,
    [
      { staffNo: "10232", attendance: "PENDING" },
      { staffNo: "10003", attendance: "PENDING" },
      { staffNo: "10231", attendance: "PENDING" },
    ],
    daysAgo(10),
  );
});
test.afterAll(async () => {
  for (const title of [HELD, RECENT, SHORT]) await deleteTestTraining(title);
  for (const undo of restore) await undo();
});

/** A signed-in page of its own, so three people can take turns. */
async function as(browser: Browser, staffNo: string) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, staffNo);
  return page;
}

const dialog = (page: Page) => page.getByRole("dialog");
const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const pmeIdOf = (page: Page) => Number(new URL(page.url()).pathname.split("/").pop());

/** Fills in the four questions. `q1` lets a test start from a wrong percentage. */
async function fillEvaluation(page: Page, q1Percent = "85") {
  const answers = [
    ["q1", "VERY_GOOD", q1Percent],
    ["q2", "EXCELLENT", "90"],
    ["q3", "GOOD", "75"],
    ["q4", "SATISFACTORY", "60"],
  ] as const;
  for (const [i, [id, rating, percent]] of answers.entries()) {
    await page.locator(`input[name="${id}_rating"][value="${rating}"]`).check();
    await page.getByLabel(`Percentage for question ${i + 1}`).fill(percent);
  }
  await page.locator('input[name="ojtConducted"][value="YES"]').check();
  await page.getByLabel("Remarks for question 1").fill("OJT on the press line, 12 Aug, 2pm");
}

test("a PME goes from completed attendance to verified: evaluate, acknowledge, send back, verify", async ({ browser }) => {
  test.setTimeout(240_000);
  const staff = await as(browser, "10232");
  const hod = await as(browser, "10231");
  const ld = await as(browser, "10001");
  let id = 0;

  await test.step("completing the course by sending feedback starts the PME", async () => {
    await staff.goto("my-training");
    await staff.getByRole("link", { name: HELD }).click();
    await expect(panel(staff, "PME")).toHaveCount(0);
    await staff.waitForLoadState("networkidle");
    for (const radio of await staff.locator('input[type="radio"][value="4"]').all()) await radio.check();
    await staff.locator('input[type="radio"][value="YES"]').check();
    await writeFeedbackAnswers(staff, "The practical session");
    await staff.getByRole("button", { name: "Send feedback" }).click();
    await expect(staff.getByRole("status")).toContainText("this training is now completed");
    // The period ended long ago, so it is already with the HOD.
    await expect(panel(staff, "PME")).toContainText("Waiting for your HOD");
    await panel(staff, "PME").getByRole("link", { name: "Open PME" }).click();
    await staff.waitForURL(/\/pme\/\d+$/);
    await expect(staff.getByRole("heading", { name: HELD, level: 1 })).toBeVisible();
    id = pmeIdOf(staff);
    await expect(staff.getByText("Waiting for Nor Azlina binti Rosli to evaluate you.")).toBeVisible();
    await expect(staff.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
    await expect(staff.getByRole("button", { name: "Submit evaluation" })).toHaveCount(0);
  });

  await test.step("the HOD finds it under Approvals and evaluates", async () => {
    await hod.goto("approvals");
    await expect(hod.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Approvals/ })).toContainText(/[1-9]/);
    const row = panel(hod, "PMEs to evaluate").getByRole("row", { name: new RegExp(HELD) });
    await expect(row).toContainText(STAFF);
    await row.getByRole("link", { name: "Evaluate" }).click();
    await expect(hod.getByRole("heading", { name: STAFF, level: 1 })).toBeVisible();

    // Nothing filled in: every question says what is missing.
    await hod.getByRole("button", { name: "Submit evaluation" }).click();
    await expect(hod.getByText("Check the highlighted fields.")).toBeVisible();
    await expect(hod.getByText("Choose a rating")).toHaveCount(4);
    await expect(hod.getByText("Choose yes or no")).toBeVisible();

    // A percentage outside its rating's band is refused; the mark adds up as it is typed.
    await fillEvaluation(hod, "95");
    await hod.getByRole("button", { name: "Submit evaluation" }).click();
    await expect(hod.getByText("Very good is 80 to 89", { exact: true })).toBeVisible();
    await hod.getByLabel("Percentage for question 1").fill("85");
    await expect(hod.getByRole("status", { name: "Mark so far" })).toContainText("Total 310 of 400");
    await expect(hod.getByRole("status", { name: "Mark so far" })).toContainText("77.5");
    await hod.getByRole("button", { name: "Submit evaluation" }).click();
    await expect(hod.getByRole("status").first()).toHaveText("Evaluation submitted. The staff member can now acknowledge it.");
    await expect(hod.getByRole("button", { name: "Submit evaluation" })).toHaveCount(0);
    await expect(panel(hod, "Record")).toContainText("Waiting for staff");
    await expect(panel(hod, "Record")).toContainText("77.5");
  });

  await test.step("L&D can't verify before the staff member has acknowledged", async () => {
    await ld.goto(`pme/${id}`);
    await expect(ld.getByText(`${STAFF} hasn't acknowledged the evaluation yet. You can verify once they have.`)).toBeVisible();
    await expect(ld.getByRole("button", { name: "Verify" })).toBeHidden();
    await expect(ld.getByRole("button", { name: "Send back to HOD" })).toBeVisible();
  });

  await test.step("the staff member reads it and acknowledges, with a comment", async () => {
    await staff.goto("my-training");
    await expect(staff.getByRole("link", { name: "1 PME to acknowledge" })).toBeVisible();
    const row = staff.getByRole("table", { name: "My trainings" }).getByRole("row", { name: new RegExp(HELD) });
    await expect(row).toContainText("To acknowledge");
    await row.getByRole("link", { name: "Acknowledge PME" }).click();
    await expect(staff.getByText("OJT on the press line, 12 Aug, 2pm")).toBeVisible();
    await expect(staff.getByText("Very good")).toBeVisible();
    await staff.getByLabel("Comment").fill("Agreed, thank you.");
    await staff.getByRole("button", { name: "Acknowledge" }).click();
    await expect(staff.getByRole("status").first()).toContainText("You have acknowledged this evaluation");
    await expect(staff.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
    await expect(panel(staff, "Record")).toContainText("Waiting for L&D");
  });

  await test.step("L&D send it back with a reason; the HOD evaluates again from what they wrote", async () => {
    await ld.goto("approvals");
    await panel(ld, "PMEs to verify")
      .getByRole("row", { name: new RegExp(HELD) })
      .getByRole("link", { name: "Verify" })
      .click();
    await expect(panel(ld, "Record")).toContainText("Agreed, thank you.");
    await ld.getByRole("button", { name: "Send back to HOD" }).click();
    await dialog(ld).getByRole("button", { name: "Send back" }).click();
    await expect(dialog(ld).getByText("Say what needs changing")).toBeVisible();
    await dialog(ld).getByLabel("Reason").fill("Question 4 needs remarks");
    await dialog(ld).getByRole("button", { name: "Send back" }).click();
    await expect(dialog(ld).getByRole("status")).toHaveText("Sent back to the HOD, who can now evaluate again.");
    await dialog(ld).getByRole("button", { name: "Close" }).click();
    await expect(panel(ld, "Record")).toContainText("Waiting for HOD");
    await expect(panel(ld, "Record")).toContainText("Question 4 needs remarks");

    await hod.goto(`pme/${id}`);
    await expect(hod.getByText("Question 4 needs remarks")).toBeVisible();
    await expect(hod.getByLabel("Percentage for question 1")).toHaveValue("85");
    await hod.getByLabel("Remarks for question 4").fill("Scrap on line 3 is down");
    await hod.getByRole("button", { name: "Submit evaluation" }).click();
    await expect(hod.getByRole("status").first()).toHaveText("Evaluation submitted. The staff member can now acknowledge it.");

    await staff.goto(`pme/${id}`);
    await expect(staff.getByText("Scrap on line 3 is down")).toBeVisible();
    await staff.getByRole("button", { name: "Acknowledge" }).click();
    await expect(staff.getByRole("status").first()).toContainText("You have acknowledged this evaluation");
  });

  await test.step("L&D verify: the mark is saved and the PME is locked", async () => {
    await ld.goto(`pme/${id}`);
    await ld.getByRole("button", { name: "Verify" }).click();
    await expect(dialog(ld)).toContainText("77.5");
    await dialog(ld).getByRole("button", { name: "Verify" }).click();
    await expect(dialog(ld).getByRole("status")).toHaveText("Verified. This PME is now locked.");
    await dialog(ld).getByRole("button", { name: "Close" }).click();
    await expect(panel(ld, "Record")).toContainText("Verified");
    await expect(ld.getByRole("button", { name: "Verify" })).toBeHidden();
    await expect(ld.getByRole("button", { name: "Send back to HOD" })).toBeHidden();
    // Each step is in the history.
    const history = panel(ld, "History");
    for (const line of ["Verified", "acknowledged their PME", "Re-evaluated", "back to the HOD", "Evaluated"]) await expect(history).toContainText(line);

    // The list and its export carry the mark.
    await ld.goto(`pme?q=${encodeURIComponent(HELD)}`);
    const row = ld.getByRole("table", { name: "PMEs" }).getByRole("row", { name: new RegExp(STAFF) });
    await expect(row).toContainText("Verified");
    await expect(row).toContainText("77.5");
    const download = ld.waitForEvent("download");
    await ld.getByRole("link", { name: "Export to Excel" }).click();
    const file = test.info().outputPath("pme.xlsx");
    await (await download).saveAs(file);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet("PME")!;
    const header = (ws.getRow(1).values as unknown[]).map(String);
    const cells = ws.getRow(2).values as unknown[];
    const cell = (name: string) => cells[header.indexOf(name)];
    expect(ws.rowCount).toBe(2);
    expect(cell("Staff No")).toBe("10232");
    expect(cell("Status")).toBe("Verified");
    expect(cell("Q1 Rating")).toBe("Very good");
    expect(cell("Q4 Remarks")).toBe("Scrap on line 3 is down");
    expect(cell("OJT Conducted")).toBe("Yes");
    expect(cell("Average Mark")).toBe(77.5);
  });

  await test.step("once evaluated, attendance can't be reopened", async () => {
    await ld.goto(`trainings/${heldId}`);
    const row = panel(ld, "Participants").getByRole("row", { name: new RegExp(STAFF) });
    await expect(row).toContainText("Verified");
    await row.getByRole("button", { name: /^Reopen/ }).click();
    await expect(dialog(ld)).toContainText("HOD has already evaluated them for this training (PME), so their attendance stays completed.");
    await dialog(ld).getByRole("button", { name: "Close" }).click();
  });
});

test("only executives and managers with a HOD get a PME, it waits for its period, and others are kept out", async ({ browser }) => {
  test.setTimeout(180_000);
  const ld = await as(browser, "10001");
  const participants = panel(ld, "Participants");
  let id = 0;

  await test.step("marking attendance completed makes a PME for the executive only", async () => {
    await ld.goto(`trainings/${recentId}`);
    await expect(participants.getByRole("columnheader", { name: "PME" })).toHaveCount(0);
    await participants.getByRole("checkbox", { name: "Select all shown" }).check();
    await participants.getByRole("button", { name: "Mark completed", exact: true }).click();
    await dialog(ld).getByLabel("Reason").fill("No computer access");
    await dialog(ld).getByRole("button", { name: "Mark completed: 3" }).click();
    await expect(dialog(ld).getByRole("status")).toBeVisible();
    await dialog(ld).getByRole("button", { name: "Close" }).click();
    // The executive has one, in its period; the non-executive and the HOD have none.
    await expect(participants.getByRole("row", { name: new RegExp(STAFF) })).toContainText("In evaluation period");
    await expect(participants.getByRole("row", { name: /Ooi Boon Kiat/ })).not.toContainText("evaluation period");
    await expect(participants.getByRole("row", { name: /Nor Azlina binti Rosli/ })).not.toContainText("evaluation period");
    await participants
      .getByRole("row", { name: new RegExp(STAFF) })
      .getByRole("link", { name: "In evaluation period" })
      .click();
    await ld.waitForURL(/\/pme\/\d+$/);
    await expect(ld.getByRole("heading", { name: STAFF, level: 1 })).toBeVisible();
    id = pmeIdOf(ld);
  });

  await test.step("the HOD sees it but can't evaluate until the period ends", async () => {
    const hod = await as(browser, "10231");
    await hod.goto("approvals");
    await expect(hod.getByRole("row", { name: new RegExp(RECENT) })).toHaveCount(0);
    await hod.goto(`pme?q=${encodeURIComponent(RECENT)}`);
    const row = hod.getByRole("table", { name: "PMEs" }).getByRole("row", { name: new RegExp(STAFF) });
    await expect(row).toContainText("In evaluation period");
    await expect(row.getByRole("link", { name: "Evaluate" })).toHaveCount(0);
    await row.getByRole("link", { name: STAFF }).click();
    await expect(hod.getByText(/The evaluation period runs until .+\. You can evaluate from /)).toBeVisible();
    await expect(hod.getByRole("button", { name: "Submit evaluation" })).toHaveCount(0);
    // Not L&D: nothing to verify or send back.
    await expect(hod.getByRole("button", { name: "Verify" })).toHaveCount(0);
    await hod.context().close();
  });

  await test.step("a short training's PME is not required", async () => {
    const shortId = await createTestTraining(SHORT, [{ staffNo: "10232", attendance: "COMPLETED" }], daysAgo(120), "11:30");
    const [pme] = await makeTestPmes(shortId);
    expect(pme.status).toBe("NOT_REQUIRED");
    await ld.goto(`pme/${pme.id}`);
    await expect(ld.getByText("This training was 4 hours or less, so no evaluation is needed.")).toBeVisible();
    await expect(ld.getByRole("button", { name: "Verify" })).toBeHidden();
  });

  await test.step("the person sees their own PME and nothing else", async () => {
    const staff = await as(browser, "10232");
    expect((await staff.goto(`pme/${id}`))?.status()).toBe(200);
    await expect(staff.getByText(/Your evaluation period runs until/)).toBeVisible();
    expect((await staff.goto("pme"))?.status()).toBe(403);
    expect((await staff.goto("approvals"))?.status()).toBe(403);
    expect((await staff.request.get("pme/export")).status()).toBe(403);
    await expect(staff.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Approvals|PME/ })).toHaveCount(0);
    await staff.context().close();
  });

  await test.step("a clerk and another department's HOD can't open it", async () => {
    const clerk = await as(browser, "10003");
    expect((await clerk.goto(`pme/${id}`))?.status()).toBe(404);
    expect((await clerk.goto("pme"))?.status()).toBe(403);
    expect((await clerk.goto("approvals"))?.status()).toBe(403);
    await clerk.context().close();

    const other = await as(browser, "10318");
    expect((await other.goto(`pme/${id}`))?.status()).toBe(404);
    await other.goto(`pme?q=${encodeURIComponent(RECENT)}`);
    await expect(other.getByText("No PMEs match these filters.")).toBeVisible();
    await other.context().close();
  });

  await test.step("reopening attendance before the HOD evaluates withdraws the PME", async () => {
    await ld.goto(`trainings/${recentId}`);
    await participants
      .getByRole("row", { name: new RegExp(STAFF) })
      .getByRole("button", { name: /^Reopen/ })
      .click();
    await dialog(ld).getByRole("button", { name: "Reopen" }).click();
    await expect(dialog(ld).getByRole("status")).toBeVisible();
    await dialog(ld).getByRole("button", { name: "Close" }).click();
    await expect(participants.getByRole("columnheader", { name: "PME" })).toHaveCount(0);
    expect((await ld.goto(`pme/${id}`))?.status()).toBe(404);
  });
});

test("a PME follows its training: new dates move the period, cancelling closes it", async ({ browser }) => {
  test.setTimeout(180_000);
  const title = `PME moves ${suffix}`;
  const trainingId = await createTestTraining(title, [{ staffNo: "10232", attendance: "COMPLETED" }], daysAgo(120));
  try {
    const [pme] = await makeTestPmes(trainingId);
    const ld = await as(browser, "10001");
    const hod = await as(browser, "10231");
    const waiting = () => panel(hod, "PMEs to evaluate").getByRole("row", { name: new RegExp(title) });

    // Held four months ago: the period is over, so it waits for the HOD.
    await hod.goto("approvals");
    await expect(waiting()).toBeVisible();

    // L&D correct the dates to ten days ago: the period starts again, and the HOD has to wait.
    await ld.goto(`trainings/${trainingId}/edit`);
    await ld.waitForLoadState("networkidle");
    await choose(ld, "HRDC", "No");
    await choose(ld, "Platform", "Physical");
    await choose(ld, "Function", "Business");
    await choose(ld, "Program", "External public program");
    await ld.getByLabel("Start date").fill(daysAgo(10));
    await ld.getByLabel("End date").fill(daysAgo(10));
    await ld.getByRole("button", { name: "Save" }).click();
    await expect(ld.getByRole("status").first()).toHaveText("Changes saved.");
    await expect(panel(ld, "Participants").getByRole("row", { name: new RegExp(STAFF) })).toContainText("In evaluation period");
    await hod.goto("approvals");
    await expect(waiting()).toHaveCount(0);
    await hod.goto(`pme/${pme.id}`);
    await expect(hod.getByText(/The evaluation period runs until/)).toBeVisible();
    await expect(hod.getByRole("button", { name: "Submit evaluation" })).toHaveCount(0);

    // Back to four months ago, then cancelled: the PME is closed and off every list.
    await ld.goto(`trainings/${trainingId}/edit`);
    await ld.waitForLoadState("networkidle");
    await ld.getByLabel("Start date").fill(daysAgo(120));
    await ld.getByLabel("End date").fill(daysAgo(120));
    await ld.getByRole("button", { name: "Save" }).click();
    await expect(ld.getByRole("status").first()).toHaveText("Changes saved.");
    await hod.goto("approvals");
    await expect(waiting()).toBeVisible();

    await ld.getByRole("button", { name: "Cancel training" }).click();
    await dialog(ld).getByRole("button", { name: "Cancel training" }).click();
    await expect(dialog(ld).getByRole("status")).toBeVisible();
    await hod.goto("approvals");
    await expect(waiting()).toHaveCount(0);
    await hod.goto(`pme?q=${encodeURIComponent(title)}`);
    await expect(hod.getByText("No PMEs match these filters.")).toBeVisible();
    await hod.goto(`pme/${pme.id}`);
    await expect(hod.getByText("This training was cancelled, so its PME is closed.")).toBeVisible();
    await expect(hod.getByRole("button", { name: "Submit evaluation" })).toHaveCount(0);
  } finally {
    await deleteTestTraining(title);
  }
});
