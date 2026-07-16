// The resilience engine: learns load-bearing obligations from classified
// transactions and computes the survival floor, crisis runway, what-breaks
// timeline, emergency-shield sizing, and multi-goal allocation.
// Pure — the same code runs server-side (narrative) and client-side (live edits).
// All constants the map tickets may tune live at the top of this file.

import type { ClassifiedTransaction } from "./types.ts";
import type { Category } from "./classify.ts";

export type Tier = "survival" | "committed";

// Categories that produce obligations, and their criticality tier.
// Comfort/discretionary categories never become obligations — in a crisis
// they stop immediately (the burn model's stated assumption).
// ponytail: the spec's four tiers folded to two — comfort/discretionary only
// ever "stop immediately", so they need no map entries; add them if a UI labels them.
const OBLIGATION_TIER: Partial<Record<Category, Tier>> = {
  rent: "survival",
  utilities_bills: "survival",
  telecom: "survival",
  health: "survival",
  government_fees: "survival",
  insurance: "survival",
  installments: "committed",
  education: "committed",
  remittance: "committed",
};

const TIER_AR: Record<Tier, string> = { survival: "بقاء", committed: "التزام" };

const CONSEQUENCE_AR: Partial<Record<Category, string>> = {
  insurance: "ينقطع التأمين — تصبح مكشوفاً أمام أي حادث",
  installments: "تعثر القسط — يبدأ الأثر على سجلك الائتماني",
  rent: "الإيجار لا يُدفع — خطر السكن",
  utilities_bills: "انقطاع الكهرباء والماء",
  telecom: "انقطاع الاتصال والإنترنت",
  health: "توقف الدواء والرعاية الصحية",
  government_fees: "رسوم حكومية متأخرة — غرامات تتراكم",
  education: "تعثر الرسوم الدراسية",
  remittance: "توقف دعم العائلة",
};

const DAYS_PER_MONTH = 30.44;
export const SHIELD_DEFAULT_MONTHS = 3;
const SHIELD_SHARE_WHILE_UNFUNDED = 0.7; // shield takes 70% until funded

export type Obligation = {
  merchant: string;
  category: Category;
  tier: Tier;
  tierAr: string;
  amountSar: number; // median observed payment
  cadenceDays: number; // median observed gap between payments
  monthlySar: number; // amortized monthly equivalent
  lastDate: string; // ISO — anchors due-date projection
  hits: number;
};

export type BreakEvent = {
  labelAr: string;
  tier: Tier;
  date: string; // ISO date of the first due date the balance cannot fund
  dayOffset: number; // days after asOf
  amountSar: number;
  consequenceAr: string;
};

export type GoalInput = { label: string; icon: string; targetSar: number; sharePct: number };

export type GoalPlan = GoalInput & {
  monthlySar: number; // allocation right now (shield phase applied)
  etaMonths: number | null; // null = never at this rate
};

export type ResilienceReport = {
  monthsOfHistory: number;
  obligations: Obligation[];
  groceriesMonthlySar: number; // median essential-groceries month
  floorSar: number; // survival floor: obligations' monthly equivalents + groceries
  dailyBurnSar: number;
  savingsSar: number;
  runwayMonths: number; // savings ÷ floor
  asOf: string; // statement end date — the simulation's "today"
  breakEvents: BreakEvent[];
  confidenceAr: string;
  assumptionAr: string; // the burn model's stated assumption
  shield: {
    months: number;
    targetSar: number;
    fundedSar: number; // liquid savings count toward the shield
    fundedPct: number;
    etaMonths: number | null;
  };
  goals: GoalPlan[];
};

export type ResilienceOptions = {
  savingsSar?: number; // defaults to the statement's latest running balance
  shieldMonths?: number; // 1–6, default 3
  goals?: GoalInput[];
  monthlySavingSar?: number; // feeds shield/goal ETAs
};

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const dayNum = (iso: string) => Math.floor(new Date(iso + "T00:00:00Z").getTime() / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

export function buildResilience(
  txns: ClassifiedTransaction[],
  opts: ResilienceOptions = {}
): ResilienceReport {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  const debits = sorted.filter((t) => t.amount > 0);
  const first = sorted[0]?.date ?? "2026-01-01";
  const asOf = sorted[sorted.length - 1]?.date ?? first;
  const monthsOfHistory = Math.max(1, (dayNum(asOf) - dayNum(first) + 1) / DAYS_PER_MONTH);

  // ---- learn obligations: recurring debits in survival/committed categories
  const byMerchant = new Map<string, ClassifiedTransaction[]>();
  for (const t of debits) {
    if (!OBLIGATION_TIER[t.category as Category]) continue;
    byMerchant.set(t.merchant, [...(byMerchant.get(t.merchant) ?? []), t]);
  }

  const obligations: Obligation[] = [];
  for (const [merchant, ts] of byMerchant) {
    if (ts.length < 2) continue;
    const gaps = ts.slice(1).map((t, i) => dayNum(t.date) - dayNum(ts[i].date));
    const cadence = median(gaps);
    if (cadence < 20 || cadence > 400) continue; // not bill-like
    // stable cadence: no gap wildly off the median (one-off payments drop out)
    if (!gaps.every((g) => g >= cadence * 0.5 && g <= cadence * 1.5)) continue;
    const amount = median(ts.map((t) => t.amount));
    const tier = OBLIGATION_TIER[ts[0].category as Category]!;
    obligations.push({
      merchant,
      category: ts[0].category as Category,
      tier,
      tierAr: TIER_AR[tier],
      amountSar: amount,
      cadenceDays: cadence,
      // near-monthly bills are calendar-monthly in real life — don't inflate by 30.44/28
      monthlySar: cadence >= 25 && cadence <= 35 ? amount : amount * (DAYS_PER_MONTH / cadence),
      lastDate: ts[ts.length - 1].date,
      hits: ts.length,
    });
  }
  obligations.sort((a, b) => b.monthlySar - a.monthlySar);

  // ---- essential groceries: median calendar-month spend, partial edge months dropped
  const buckets = new Map<string, number>();
  for (const t of debits) {
    if (t.category !== "groceries") continue;
    const m = t.date.slice(0, 7);
    buckets.set(m, (buckets.get(m) ?? 0) + t.amount);
  }
  const months = [...buckets.keys()].sort();
  if (months.length > 2) {
    if (Number(first.slice(8)) > 3) buckets.delete(months[0]);
    if (Number(asOf.slice(8)) < 27) buckets.delete(months[months.length - 1]);
  }
  const groceriesMonthlySar = median([...buckets.values()]);

  const floorSar = obligations.reduce((s, o) => s + o.monthlySar, 0) + groceriesMonthlySar;
  const dailyBurnSar = floorSar / DAYS_PER_MONTH;

  // ---- savings & runway
  const lastBalance = [...sorted].reverse().find((t) => t.balance !== undefined)?.balance ?? 0;
  const savingsSar = opts.savingsSar ?? Math.max(0, lastBalance);
  const runwayMonths = floorSar > 0 ? savingsSar / floorSar : Infinity;

  // ---- crisis simulation: income stops at asOf; survival + committed keep
  // being paid on their observed cadence, groceries burn daily, everything
  // optional stops. A due date the balance can't fund = a break event.
  const breakEvents: BreakEvent[] = [];
  const asOfNum = dayNum(asOf);
  const pending = obligations.map((o) => {
    let due = dayNum(o.lastDate) + o.cadenceDays;
    while (due <= asOfNum) due += o.cadenceDays;
    return { o, due };
  });
  let balance = savingsSar;
  const dailyGroceries = groceriesMonthlySar / DAYS_PER_MONTH;
  for (let day = asOfNum + 1; day <= asOfNum + 730 && pending.length; day++) {
    balance -= dailyGroceries;
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (Math.round(p.due) > day) continue;
      if (balance >= p.o.amountSar) {
        balance -= p.o.amountSar;
        p.due += p.o.cadenceDays;
      } else {
        breakEvents.push({
          labelAr: p.o.merchant,
          tier: p.o.tier,
          date: isoOf(day),
          dayOffset: day - asOfNum,
          amountSar: p.o.amountSar,
          consequenceAr: CONSEQUENCE_AR[p.o.category] ?? "تعثر التزام",
        });
        pending.splice(i, 1);
      }
    }
  }
  breakEvents.sort((a, b) => a.dayOffset - b.dayOffset);

  const histMonths = Math.round(monthsOfHistory);
  const confidenceAr =
    histMonths < 3
      ? `ثقة منخفضة — هذا النموذج تعلّم من ${histMonths <= 1 ? "شهر واحد" : "شهرين"} فقط من كشفك. ارفع تاريخاً أطول لأرقام أدق.`
      : histMonths < 6
        ? `ثقة متوسطة — تعلّمنا من ${histMonths} أشهر من كشفك.`
        : `ثقة جيدة — تعلّمنا من ${histMonths} شهراً من كشفك.`;

  // ---- shield & goal allocation
  const shieldMonths = Math.min(6, Math.max(1, opts.shieldMonths ?? SHIELD_DEFAULT_MONTHS));
  const shieldTarget = shieldMonths * floorSar;
  const shieldFunded = Math.min(savingsSar, shieldTarget);
  const shieldRemaining = shieldTarget - shieldFunded;
  const saving = opts.monthlySavingSar ?? 0;
  const shieldPhase = shieldRemaining > 0;
  const shieldRate = SHIELD_SHARE_WHILE_UNFUNDED * saving;
  // exact months until the shield is funded (goal ETAs pivot on this point)
  const tShield = shieldPhase && shieldRate > 0 ? shieldRemaining / shieldRate : 0;

  const inputs = opts.goals ?? [];
  const shareSum = inputs.reduce((s, g) => s + g.sharePct, 0);
  const goals: GoalPlan[] = inputs.map((g) => {
    const share = shareSum > 0 ? g.sharePct / shareSum : 1 / (inputs.length || 1);
    const rateNow = (shieldPhase ? 1 - SHIELD_SHARE_WHILE_UNFUNDED : 1) * saving * share;
    const rateAfter = saving * share;
    let eta: number | null = null;
    if (rateAfter > 0) {
      const accAtPivot = rateNow * tShield;
      eta =
        accAtPivot >= g.targetSar
          ? Math.ceil(g.targetSar / rateNow)
          : Math.ceil(tShield + (g.targetSar - accAtPivot) / rateAfter);
    }
    return { ...g, monthlySar: rateNow, etaMonths: eta };
  });

  return {
    monthsOfHistory,
    obligations,
    groceriesMonthlySar,
    floorSar,
    dailyBurnSar,
    savingsSar,
    runwayMonths,
    asOf,
    breakEvents,
    confidenceAr,
    assumptionAr:
      "افتراض النموذج: في الأزمة يستمر دفع التزامات البقاء والالتزامات الثابتة والتموينات الأساسية، ويتوقف كل إنفاق اختياري فوراً — وما ينكسر يتوقف دفعه ويستمر الباقي.",
    shield: {
      months: shieldMonths,
      targetSar: shieldTarget,
      fundedSar: shieldFunded,
      fundedPct: shieldTarget > 0 ? (shieldFunded / shieldTarget) * 100 : 100,
      etaMonths: shieldPhase ? (shieldRate > 0 ? Math.ceil(tShield) : null) : 0,
    },
    goals,
  };
}

// Leak repricing: what a fixed leak buys in survival time.
export function runwayDaysBought(monthlySar: number, floorSar: number): number {
  return floorSar > 0 ? monthlySar / (floorSar / DAYS_PER_MONTH) : 0;
}
