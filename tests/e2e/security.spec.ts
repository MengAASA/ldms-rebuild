import { expect, test, type Browser, type Page } from "@playwright/test";
import { deleteTestStaff } from "./db";
import { choose, signIn } from "./helpers";

// Security regressions found in the phase 1 review. Each test creates its own
// staff so the demo accounts are left alone, and removes them afterwards.
const suffix = String(Date.now()).slice(-6);

test.afterAll(async () => {
  await deleteTestStaff(["S", "K"].map((letter) => `${letter}${suffix}`));
});

async function newSession(browser: Browser) {
  const context = await browser.newContext();
  return context.newPage();
}

async function addContractStaff(admin: Page, staffNo: string, name: string): Promise<string> {
  await admin.goto("staff/new");
  await admin.getByLabel("Staff no.").fill(staffNo);
  await admin.getByLabel("Full name").fill(name);
  await choose(admin, "Designation", "Contract");
  await choose(admin, "Department", "Stamping");
  await admin.getByRole("button", { name: "Add staff" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Staff record added." })).toBeVisible();
  return admin.url().replace(/\?.*$/, "");
}

async function resetPassword(admin: Page, recordUrl: string, password: string) {
  await admin.goto(recordUrl);
  await admin.getByRole("button", { name: "Reset password" }).click();
  await admin.getByRole("dialog").getByLabel("Temporary password").fill(password);
  await admin.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
  await expect(admin.getByRole("dialog").getByText(/signed out everywhere/)).toBeVisible();
}

async function changeOwnPassword(page: Page, current: string, next: string) {
  await page.goto("account");
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  await page.getByRole("button", { name: "Change password" }).click();
}

test("security headers are sent and the framework is not advertised", async ({ request }) => {
  const res = await request.get("login");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("sign-in never redirects to another site", async ({ page }) => {
  for (const from of ["%2F%5Cevil.example", "%2F%2Fevil.example", "https%3A%2F%2Fevil.example"]) {
    await page.context().clearCookies();
    await page.goto(`login?from=${from}`);
    await page.getByLabel("Staff no.").fill("10001");
    await page.getByLabel("Password").fill("Ldms@2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/phn-ldms$/, { timeout: 20_000 });
  }
});

test("temporary passwords, password changes and resets end other sessions", async ({ browser }) => {
  const staffNo = `S${suffix}`;
  const admin = await newSession(browser);
  await signIn(admin, "10001");
  const record = await addContractStaff(admin, staffNo, "Min Thant Zaw");
  await resetPassword(admin, record, `Temp${suffix}a`);

  // Signed in with a temporary password: only the Account page is reachable.
  const laptop = await newSession(browser);
  await signIn(laptop, staffNo, `Temp${suffix}a`);
  await expect(laptop).toHaveURL(/\/account$/);
  await laptop.goto("./");
  await expect(laptop).toHaveURL(/\/account$/);

  await changeOwnPassword(laptop, `Temp${suffix}a`, `Own${suffix}pw1`);
  await expect(laptop).toHaveURL(/\/phn-ldms$/, { timeout: 20_000 });

  // A second device signs in, then the password is changed on the laptop:
  // the laptop stays signed in, the second device is signed out.
  const phone = await newSession(browser);
  await signIn(phone, staffNo, `Own${suffix}pw1`);
  await changeOwnPassword(laptop, `Own${suffix}pw1`, `Own${suffix}pw2`);
  await expect(laptop.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
  await phone.goto("./");
  await expect(phone).toHaveURL(/\/login/);

  // An admin reset (e.g. a compromised account) signs the laptop out too.
  await resetPassword(admin, record, `Temp${suffix}b`);
  await laptop.goto("./");
  await expect(laptop).toHaveURL(/\/login/);
});

test("a clerk cannot change contract staff who hold extra access", async ({ browser }) => {
  const admin = await newSession(browser);
  await signIn(admin, "10001");
  const record = await addContractStaff(admin, `K${suffix}`, "Bishnu Tamang");
  await admin.goto(record);
  await admin.getByRole("checkbox", { name: /Clerk/ }).first().check();
  await admin.getByRole("button", { name: "Save access" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  const clerk = await newSession(browser);
  await signIn(clerk, "10003");
  await clerk.goto(record);
  await expect(clerk.getByRole("heading", { name: "Bishnu Tamang" })).toBeVisible();
  await expect(clerk.getByRole("button", { name: "Reset password" })).toHaveCount(0);
  await expect(clerk.getByRole("link", { name: "Edit" })).toHaveCount(0);
  const res = await clerk.goto(`${record}/edit`);
  expect(res?.status()).toBe(403);
});
