import { expect, test } from "@playwright/test";

test("unauthenticated routes go to the login screen", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
});

test("a short password is rejected before any request", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("ops@ledgerflow.local");
  await page.getByLabel("Password").fill("too-short");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Password must be at least 12 characters.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
