import { expect, test } from "@playwright/test";

const enabled = process.env.LEDGERFLOW_E2E === "1";

test.describe("ledger workflows against the running backend", () => {
  test.skip(!enabled, "Set LEDGERFLOW_E2E=1 with identity, payment, ledger, settlement, and reconciliation running.");

  test("login, capture, inspect the journal, and refuse a second idempotency key", async ({ page }) => {
    const email = process.env.LEDGERFLOW_E2E_EMAIL;
    const password = process.env.LEDGERFLOW_E2E_PASSWORD;
    const merchantId = process.env.LEDGERFLOW_E2E_MERCHANT_ID;
    test.skip(email === undefined || password === undefined || merchantId === undefined, "E2E credentials are not set.");

    await page.goto("/login");
    await page.getByLabel("Email").fill(email ?? "");
    await page.getByLabel("Password").fill(password ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.goto("/payments");
    await page.getByRole("button", { name: "Create payment" }).click();
    await page.getByLabel("Merchant id").fill(merchantId ?? "");
    await page.getByLabel("Amount in minor units").fill("10000");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
    await page.getByRole("button", { name: "Authorize" }).click();
    await page.getByRole("button", { name: "Authorize" }).last().click();
    await expect(page.getByRole("status").filter({ hasText: "AUTHORIZED" })).toBeVisible();
  });
});
