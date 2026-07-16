// Resilience UI against the deterministic demo route. Expected figures are
// computed by the SAME engine over the SAME seeded CSV — the UI must agree.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStatementCsv } from "../lib/parse.ts";
import { classifyByRules } from "../lib/classify.ts";
import { buildResilience } from "../lib/resilience.ts";

const csv = readFileSync(join(process.cwd(), "public", "demo.csv"), "utf8");
const engine = buildResilience(
  parseStatementCsv(csv).transactions.map((t) => classifyByRules(t)!)
);

test("what-breaks timeline renders the engine's break events in order", async ({ page }) => {
  await page.goto("/?demo=1&static=1");
  const events = page.getByTestId("break-event");
  await expect(events).toHaveCount(engine.breakEvents.length, { timeout: 30_000 });
  // first break: obligation name, day offset, and consequence copy all visible
  const first = events.first();
  await expect(first).toContainText(engine.breakEvents[0].labelAr);
  await expect(first).toContainText(`بعد ${engine.breakEvents[0].dayOffset} يوماً`);
  await expect(first).toContainText(engine.breakEvents[0].consequenceAr);
  // the burn-model assumption is stated, honest-numbers style
  await expect(page.getByText("افتراض النموذج")).toBeVisible();
});

test("goal percentages sum to 100 after an edit and the edit persists", async ({ page }) => {
  await page.goto("/?demo=1&static=1");
  await expect(page.getByTestId("runway-months")).toBeVisible({ timeout: 30_000 });

  await page.getByText("تعديل الأهداف والنسب").click();
  await page.getByText("+ 🚗 دفعة أولى لسيارة").click();
  await page.getByLabel("نسبة عمرة عائلية").fill("60");
  await page.getByLabel("نسبة دفعة أولى لسيارة").fill("40");
  await expect(page.getByTestId("share-sum")).toHaveText("المجموع: 100٪");
  await page.getByRole("button", { name: "حفظ" }).click();

  await expect(page.getByTestId("goal-row")).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId("goal-row")).toHaveCount(2, { timeout: 30_000 });
});

test("leak fixes are re-priced as runway days and the total updates on toggle", async ({ page }) => {
  await page.goto("/?demo=1&static=1");
  const summary = page.getByTestId("plan-summary");
  await expect(summary).toContainText("يوم أمان إضافي", { timeout: 30_000 });
  await expect(page.getByText(/يوم إضافي من الأمان شهرياً/).first()).toBeVisible();

  const before = await summary.textContent();
  await page.getByRole("button", { name: /تفعيل/ }).first().click();
  await expect(summary).not.toHaveText(before!);
});

test("offline narrative references the runway and the shield", async ({ page }) => {
  await page.goto("/?demo=1&static=1");
  const narrative = page.getByTestId("narrative");
  await expect(narrative).toContainText(`${engine.runwayMonths.toFixed(1)} شهر`, { timeout: 30_000 });
  await expect(narrative).toContainText("درع الطوارئ");
});

test("runway hero shows the engine-computed figure and recomputes on savings edit", async ({ page }) => {
  await page.goto("/?demo=1&static=1");
  const runway = page.getByTestId("runway-months");
  await expect(runway).toHaveText(engine.runwayMonths.toFixed(1), { timeout: 30_000 });

  // the model's inputs are visible: floor beside the editable savings
  await expect(page.getByText("ر.س ÷ أرضية البقاء")).toBeVisible();

  // editing savings recomputes the runway live…
  const savings = page.getByLabel("السيولة المتاحة");
  await savings.fill(String(Math.round(engine.floorSar * 4)));
  await expect(runway).not.toHaveText(engine.runwayMonths.toFixed(1));

  // …and persists across reload
  await page.reload();
  await expect(runway).not.toHaveText(engine.runwayMonths.toFixed(1), { timeout: 30_000 });
});
