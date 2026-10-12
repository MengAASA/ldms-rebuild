import { expect, type Page, test } from "@playwright/test";
import { deleteTestTraining } from "./db";
import { choose, signIn, writeFeedbackAnswers } from "./helpers";

// Each test creates its own records with a unique title and removes them at
// the end. A training someone has given feedback on can't be deleted in the
// app, so that one is removed directly (see db.ts).
const suffix = String(Date.now()).slice(-6);

/** YYYY-MM-DD, n days from today (Malaysia time). */
function day(n: number) {
  return new Date(Date.now() + 8 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
}

const dialog = (page: Page) => page.getByRole("dialog");
/** A card on the page, found by its heading: the nearest section around it, not the page sections that hold it. */
const card = (page: Page, heading: string) => page.getByRole("heading", { name: heading, exact: true }).locator("xpath=ancestor::section[1]");

async function switchUser(page: Page, staffNo: string) {
  await page.context().clearCookies();
  await signIn(page, staffNo);
}

test("staff find their feedback form, send it, and the training's hours count", async ({ page }) => {
  const title = `Hydraulic Press Basics ${suffix}`;
  try {
    // L&D: a course held two days ago (08:30–17:30, so 9 hours), with Ooi Boon Kiat on it.
    await signIn(page, "10001");
    await page.goto("trainings/new");
    await page.waitForLoadState("networkidle");
    await choose(page, "Type", "Public / In-house");
    await page.getByLabel("Title").fill(title);
    await choose(page, "HRDC", "No");
    await choose(page, "Platform", "Physical");
    await choose(page, "Function", "Business");
    await page.getByLabel("Start date").fill(day(-2));
    // The end date follows the start date: the form is live and has the date.
    await expect(page.getByLabel("End date")).toHaveValue(day(-2).split("-").reverse().join("/"));
    await choose(page, "Program", "External public program");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await page.getByRole("region", { name: "Participants" }).getByRole("button", { name: "Add participants" }).click();
    await expect(dialog(page).getByText("Loading staff")).toBeHidden();
    await dialog(page).getByPlaceholder("Search by name or staff no.").fill("10003");
    await dialog(page).getByRole("list", { name: "Staff" }).getByRole("checkbox").first().check();
    await dialog(page).getByRole("button", { name: "Add 1 participant" }).click();
    await expect(dialog(page).getByRole("status")).toHaveText("Added 1 participant.");

    // The staff member: it's waiting on the overview and counted in the menu.
    await switchUser(page, "10003");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /My training/ })).toContainText(/\d/);
    const waiting = card(page, "Waiting on you");
    await waiting.getByRole("link", { name: new RegExp(title) }).click();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();

    // Nothing filled in: every unanswered question is flagged.
    await page.getByRole("button", { name: "Send feedback" }).click();
    await expect(page.getByText("Check the highlighted fields.")).toBeVisible();
    await expect(page.getByText("Choose an answer")).toHaveCount(12); // 11 ratings and the yes/no one
    await expect(page.getByText("Write an answer")).toHaveCount(4); // the four written ones

    // Answer everything: 4 (Good) throughout, "Yes", and the written answers.
    for (const radio of await page.locator('input[type="radio"][value="4"]').all()) await radio.check();
    await page.locator('input[type="radio"][value="YES"]').check();
    await writeFeedbackAnswers(page, "The die safety walkthrough");
    await page.getByRole("button", { name: "Send feedback" }).click();
    await expect(page.getByRole("status")).toHaveText("Thank you. Your answers have been sent and this training is now completed.");
    await expect(card(page, "Your record").getByText("9 h")).toBeVisible();
    await expect(page.getByText("The die safety walkthrough")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);

    // My training: in the table with its hours; nothing waiting any more.
    await page.getByRole("link", { name: "My training", exact: true }).first().click();
    const row = page.getByRole("table", { name: "My trainings" }).getByRole("row", { name: new RegExp(title) });
    await expect(row).toContainText("Completed");
    await expect(row).toContainText("9 h");
    await expect(row.getByRole("link", { name: /Give feedback/ })).toHaveCount(0);
    // The date filters: in a range around it, then gone from one that ends before it.
    await page.getByLabel("Start date").fill(day(-3));
    await page.getByLabel("End date").fill(day(-2));
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(new RegExp(`from=${day(-3)}&to=${day(-2)}`));
    await expect(row).toBeVisible();
    // Applying reloads the page: wait for it to settle, or loading resets what's typed next.
    await page.waitForLoadState("networkidle");
    await page.getByLabel("End date").fill(day(-3));
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(new RegExp(`to=${day(-3)}`));
    await expect(row).toHaveCount(0);
    await page.goto("my-training");
    await row.getByRole("link", { name: title }).click();
    await page.waitForURL(/\/my-training\/\d+$/);
    const ownUrl = page.url();

    // Someone else can't open it.
    await switchUser(page, "10002");
    const res = await page.goto(ownUrl);
    expect(res?.status()).toBe(404);

    // L&D sees when the feedback came in.
    await switchUser(page, "10001");
    await page.goto(`trainings?q=${encodeURIComponent(title)}`);
    await page.getByRole("link", { name: title }).click();
    await expect(page.getByRole("region", { name: "Participants" }).getByRole("row", { name: /Ooi Boon Kiat/ })).toContainText("Completed");
    await expect(page.getByText(/Ooi Boon Kiat \(10003\) submitted feedback/)).toBeVisible();
  } finally {
    await deleteTestTraining(title);
  }
});

test("staff record their own OJT, change it, and delete it", async ({ page }) => {
  const title = `Coil changeover ${suffix}`;
  const renamed = `Coil changeover, line 2 ${suffix}`;
  try {
    await signIn(page, "10003");
    await page.goto("my-training");
    await page.getByRole("link", { name: "Record OJT" }).click();
    await expect(page.getByRole("heading", { name: "Record OJT", level: 1 })).toBeVisible();

    // Nothing filled in: Section A and Section B are flagged together.
    await page.getByRole("button", { name: "Record OJT" }).click();
    await expect(page.getByText("Enter the title")).toBeVisible();
    await expect(page.getByText("Choose the training type")).toBeVisible();
    await expect(page.getByText("Enter the venue")).toBeVisible();
    await expect(page.getByText("Choose external or internal")).toBeVisible();
    await expect(page.getByText("Write an answer")).toHaveCount(1);
    await expect(page.getByText("Choose an answer")).toHaveCount(2); // before and after

    // Section A: two days of coaching, 08:30–11:30 each day.
    await page.getByLabel("Title", { exact: true }).fill(title);
    await choose(page, "Training type", "Coaching / Coachee");
    await page.getByLabel("Start date").fill(day(-2));
    await page.getByLabel("End date").fill(day(-1));
    await page.getByLabel("End time").fill("11:30");
    await expect(page.getByTestId("live-hours")).toHaveText("6 h");
    await page.getByLabel("Venue").fill("Press Line A");
    await choose(page, "External/Internal trainer", "Internal");
    // Section B.
    await page.getByLabel("Please highlight what you have learned from the OJT").fill("Changing coils safely");
    await page.locator('input[name="a2"][value="2"]').check();
    await page.locator('input[name="a3"][value="4"]').check();

    // Not in the future.
    await page.getByLabel("End date").fill(day(2));
    await page.getByRole("button", { name: "Record OJT" }).click();
    await expect(page.getByText("OJT is recorded once it has happened. Pick today or an earlier date.")).toBeVisible();
    await page.getByLabel("End date").fill(day(-1));
    await page.getByRole("button", { name: "Record OJT" }).click();

    await expect(page.getByRole("status")).toHaveText("OJT recorded. Its hours now count toward your total.");
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText("Coaching / Coachee")).toBeVisible();
    await expect(page.getByText("Internal trainer")).toBeVisible();
    const record = card(page, "Your record");
    await expect(record).toContainText("6 h");
    await expect(record.getByText("You", { exact: true })).toBeVisible();

    // The answers are shown, not an open form: one Edit changes everything.
    const answers = card(page, "Your OJT answers");
    await expect(answers).toContainText("4 · Good");
    await expect(page.getByRole("button", { name: "Save answers" })).toHaveCount(0);

    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit OJT", level: 1 })).toBeVisible();
    await expect(page.locator('input[name="a3"][value="4"]')).toBeChecked();
    await page.getByLabel("Title", { exact: true }).fill(renamed);
    await page.locator('input[name="a3"][value="5"]').check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Changes saved.");
    await expect(page.getByRole("heading", { name: renamed, level: 1 })).toBeVisible();
    await expect(answers).toContainText("5 · Excellent");

    // Delete it.
    await page.getByRole("button", { name: "Delete" }).click();
    await dialog(page).getByRole("button", { name: "Delete OJT" }).click();
    await expect(page).toHaveURL(/my-training\?deleted=1/);
    await expect(page.getByText("OJT deleted.")).toBeVisible();
    await expect(page.getByText(renamed)).toHaveCount(0);
  } finally {
    await deleteTestTraining(title);
    await deleteTestTraining(renamed);
  }
});
