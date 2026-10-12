import { expect, type Locator, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "Ldms@2026";

export async function signIn(page: Page, staffNo: string, password = DEMO_PASSWORD) {
  await page.goto("login");
  await page.getByLabel("Staff no.").fill(staffNo);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The sign-in page has its own heading, so wait until we have left it.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Fills in the course feedback form's written answers (its last four questions,
 * all required): `benefit` under "What have you benefited from the course?" and
 * "None" under the rest.
 */
export async function writeFeedbackAnswers(page: Page, benefit: string) {
  for (const box of await page.locator("textarea").all()) await box.fill("None");
  await page.getByLabel(/What have you benefited from the course/).fill(benefit);
}

/** Picks an option in an LDMS <Select>: open it by its label, then click the option. */
export async function choose(scope: Page | Locator, label: string, option: string | { index: number }) {
  await scope.getByLabel(label, { exact: true }).click();
  const options = scope.getByRole("listbox").getByRole("option");
  // Match from the start of the option text, so "Executive" does not pick "Non-executive".
  if (typeof option === "string") {
    const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await options.filter({ hasText: new RegExp(`^${escaped}`) }).first().click();
  } else {
    await options.nth(option.index).click();
  }
}
