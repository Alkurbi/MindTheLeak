// Smoke: the deterministic demo route renders the dashboard hero.
// Run: npm run test:e2e
import { test, expect } from "@playwright/test";

test("demo dashboard renders the leak-score hero", async ({ page }) => {
  await page.goto("/?demo=1&static=1");
  // analysis runs server-side on the seeded demo data; webdriver skips the reveal beat
  await expect(page.getByText("مؤشر التسريب")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("لحظة الوعي")).toBeVisible();
});
