// End-to-end engine self-check over the bundled demo data.
// Run: node lib/detect.test.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStatementCsv } from "./parse.ts";
import { classifyByRules } from "./classify.ts";
import { runEngine } from "./detect.ts";

const csv = readFileSync(join(import.meta.dirname, "..", "public", "demo.csv"), "utf8");
const { transactions, errors } = parseStatementCsv(csv);
assert.strictEqual(errors.length, 0, JSON.stringify(errors.slice(0, 3)));
assert.ok(transactions.length > 150, `only ${transactions.length} parsed`);

// demo data must classify 100% by rules (no AI needed offline)
const classified = transactions.map((t) => {
  const c = classifyByRules(t);
  assert.ok(c, `unclassified: ${t.description}`);
  return c!;
});

const out = runEngine(classified);
const kinds = out.leaks.map((l) => l.kind);
for (const expected of [
  "forgotten_subscription",
  "zombie_subscription",
  "payday_spike",
  "late_night",
  "delivery_streak",
  "micro_leak",
  "bank_fees",
]) {
  assert.ok(kinds.includes(expected), `missing detector: ${expected} (got ${kinds})`);
}

assert.ok(out.monthlyIncomeSar > 10000 && out.monthlyIncomeSar < 13000, `income ${out.monthlyIncomeSar}`);
assert.ok(out.leakScore >= 40 && out.leakScore <= 100, `score ${out.leakScore}`);
assert.ok(out.monthlyLeakSar > 500, `leak ${out.monthlyLeakSar}`);

console.log("detect.ts self-check OK");
console.log(`  score=${out.leakScore}  monthlyLeak=${Math.round(out.monthlyLeakSar)} SAR  leaks=${kinds.join(",")}`);
console.log(`  paydayShare=${out.stats.paydayWindowSharePct}%  lateNight/mo=${out.stats.lateNightCountPerMonth}  delivery/wk=${out.stats.deliveryPerWeek}`);
