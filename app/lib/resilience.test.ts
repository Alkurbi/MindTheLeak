// Resilience-engine self-check: demo data + a crafted fixture with a known
// annual obligation. Run: node lib/resilience.test.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStatementCsv } from "./parse.ts";
import { classifyByRules } from "./classify.ts";
import { buildResilience, runwayDaysBought } from "./resilience.ts";
import type { ClassifiedTransaction } from "./types.ts";

// ---- demo dataset: obligations learned, floor plausible, runway exact
const csv = readFileSync(join(import.meta.dirname, "..", "public", "demo.csv"), "utf8");
const { transactions } = parseStatementCsv(csv);
const classified = transactions.map((t) => classifyByRules(t)!);
assert.ok(classified.every(Boolean), "demo must classify 100% by rules");

const r = buildResilience(classified);

assert.ok(r.obligations.length >= 3, `only ${r.obligations.length} obligations`);
const byCat = Object.fromEntries(r.obligations.map((o) => [o.category, o]));
assert.strictEqual(byCat["rent"]?.tier, "survival", "rent must be survival");
assert.strictEqual(byCat["installments"]?.tier, "committed", "installments must be committed");
assert.ok(byCat["utilities_bills"], "utility bill must be learned");
assert.ok(byCat["insurance"], "insurance must be learned from the demo");
assert.strictEqual(byCat["remittance"]?.tier, "committed", "family support must be committed");

// stage guarantees: ~2 months runway, ≥3 break events across both tiers
assert.ok(r.runwayMonths > 1.5 && r.runwayMonths < 2.5, `demo runway ${r.runwayMonths}`);
assert.ok(r.breakEvents.length >= 3, `demo breaks ${r.breakEvents.length}`);

// floor = rent 3500 + installment 1400 + bills + groceries → plausible band
assert.ok(r.floorSar > 5000 && r.floorSar < 9000, `floor ${r.floorSar}`);
assert.ok(r.groceriesMonthlySar > 500, `groceries ${r.groceriesMonthlySar}`);

// runway is exactly savings ÷ floor
assert.ok(Math.abs(r.runwayMonths - r.savingsSar / r.floorSar) < 1e-9, "runway = savings/floor");

// break events: non-empty, chronological, derived from learned obligations
assert.ok(r.breakEvents.length >= 1, "no break events");
for (let i = 1; i < r.breakEvents.length; i++)
  assert.ok(r.breakEvents[i].dayOffset >= r.breakEvents[i - 1].dayOffset, "events out of order");
const obligationNames = new Set(r.obligations.map((o) => o.merchant));
for (const e of r.breakEvents)
  assert.ok(obligationNames.has(e.labelAr), `break event ${e.labelAr} not a learned obligation`);
// every tier the model learned eventually breaks (income stopped for good)
const learnedTiers = new Set(r.obligations.map((o) => o.tier));
const brokenTiers = new Set(r.breakEvents.map((e) => e.tier));
for (const t of learnedTiers) assert.ok(brokenTiers.has(t), `tier ${t} never breaks`);

// ---- crafted fixture: monthly rent + ANNUAL insurance amortized into the floor
function fix(date: string, amount: number, category: string, merchant: string): ClassifiedTransaction {
  return {
    id: `${merchant}-${date}`, date, description: merchant, amount,
    class: "planned", category, merchant, confidence: 1,
  };
}
const fixture: ClassifiedTransaction[] = [];
for (let m = 0; m < 13; m++) {
  const d = new Date(Date.UTC(2025, m, 28)).toISOString().slice(0, 10);
  fixture.push(fix(d, 3000, "rent", "EJAR RENT"));
}
fixture.push(fix("2025-02-10", 2400, "insurance", "TAWUNIYA"));
fixture.push(fix("2026-02-10", 2400, "insurance", "TAWUNIYA"));

const f = buildResilience(fixture, { savingsSar: 10000, monthlySavingSar: 1000,
  goals: [
    { label: "عمرة", icon: "🕋", targetSar: 12000, sharePct: 60 },
    { label: "سيارة", icon: "🚗", targetSar: 20000, sharePct: 40 },
  ],
});
const insurance = f.obligations.find((o) => o.category === "insurance");
assert.ok(insurance, "annual insurance not learned");
assert.strictEqual(insurance!.cadenceDays, 365, `cadence ${insurance!.cadenceDays}`);
// 2400 SAR/year amortized ≈ 200/month
assert.ok(Math.abs(insurance!.monthlySar - 2400 * (30.44 / 365)) < 1e-9, "amortization");
assert.ok(Math.abs(f.floorSar - (3000 + 2400 * (30.44 / 365))) < 1e-9, `floor ${f.floorSar}`);

// fixture breaks come only from its two known obligations, in order
assert.ok(f.breakEvents.length >= 2, "fixture must break both obligations");
for (const e of f.breakEvents)
  assert.ok(["EJAR RENT", "TAWUNIYA"].includes(e.labelAr), `unknown break ${e.labelAr}`);
// 10000 savings ÷ 3000 rent → rent survives 3 due dates, breaks on the 4th
assert.strictEqual(f.breakEvents[0].labelAr, "EJAR RENT");

// ---- shield & allocation: 70/30 while unfunded, exact ETAs
// floor ≈ 3200.2 → shield target 3 × floor ≈ 9600.6 < savings 10000 → funded!
assert.strictEqual(f.shield.months, 3);
assert.ok(f.shield.fundedPct === 100, "shield should be fully funded by savings");
// funded shield → goals split 100% by share: 600/400 per month
assert.ok(Math.abs(f.goals[0].monthlySar - 600) < 1e-9, `goal0 rate ${f.goals[0].monthlySar}`);
assert.strictEqual(f.goals[0].etaMonths, Math.ceil(12000 / 600));
assert.strictEqual(f.goals[1].etaMonths, Math.ceil(20000 / 400));

// unfunded shield: savings 1000 → shield takes 70%, goals split the 30%
const u = buildResilience(fixture, { savingsSar: 1000, monthlySavingSar: 1000,
  goals: [{ label: "عمرة", icon: "🕋", targetSar: 1200, sharePct: 100 }],
});
assert.ok(u.shield.fundedSar === 1000 && u.shield.targetSar > 1000, "shield unfunded");
assert.ok(Math.abs(u.goals[0].monthlySar - 300) < 1e-9, `phase-1 rate ${u.goals[0].monthlySar}`);
const tShield = (u.shield.targetSar - 1000) / 700;
assert.strictEqual(u.shield.etaMonths, Math.ceil(tShield));
// goal accumulates at 300/mo until the shield is funded, then 1000/mo;
// 1200 target is reached at 300/mo before the pivot → exactly 4 months
assert.ok(300 * tShield >= 1200, "fixture assumes goal funds during shield phase");
assert.strictEqual(u.goals[0].etaMonths, Math.ceil(1200 / 300));

// ---- leak repricing is exact: 600 SAR/month against a 6088 floor = 3 days
assert.strictEqual(runwayDaysBought(600, 200 * 30.44), 3);
assert.strictEqual(runwayDaysBought(100, 0), 0);

console.log("resilience.ts self-check OK");
console.log(`  demo: floor=${Math.round(r.floorSar)} SAR  savings=${Math.round(r.savingsSar)}  runway=${r.runwayMonths.toFixed(1)} mo  obligations=${r.obligations.length}  breaks=${r.breakEvents.length}`);
console.log(`  first break: ${r.breakEvents[0]?.labelAr} @ ${r.breakEvents[0]?.date} (+${r.breakEvents[0]?.dayOffset}d)`);
