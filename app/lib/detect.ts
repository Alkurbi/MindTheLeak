// The leak-detection engine. Thresholds are research-backed، see docs/RESEARCH.md.
// Works entirely offline on classified transactions; Claude only writes the narrative.
//
// Honesty rule: every transaction is attributed to at most ONE leak (priority
// order below), so the headline total never double-counts a riyal. Counterfactual
// leaks (delivery, payday) are additionally capped at their computed saving.

import type { ClassifiedTransaction, Leak } from "./types.ts";
import { DISCRETIONARY, type Category, CATEGORY_AR } from "./classify.ts";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function day(t: ClassifiedTransaction): number {
  return Math.floor(new Date(t.date + "T00:00:00").getTime() / 86400000);
}

function hourOf(t: ClassifiedTransaction): number | undefined {
  if (!t.time) return undefined;
  const h = Number(t.time.split(":")[0]);
  return Number.isFinite(h) ? h : undefined;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export type EngineOutput = {
  transactions: ClassifiedTransaction[]; // with class upgrades applied
  leaks: Leak[];
  leakScore: number;
  monthlyIncomeSar: number;
  monthlyLeakSar: number;
  months: number;
  stats: Stats; // compact summary fed to Claude for the narrative
};

export type Stats = {
  months: number;
  monthlyIncomeSar: number;
  monthlyDiscretionarySar: number;
  categoryMonthly: Record<string, number>;
  salaryDates: string[];
  paydayWindowSharePct: number; // % of monthly discretionary spent in days 0–4
  lateNightCountPerMonth: number;
  lateNightMonthlySar: number;
  subscriptions: { merchant: string; monthlySar: number; count: number }[];
  deliveryPerWeek: number;
  topMerchants: { merchant: string; monthlySar: number; count: number }[];
};

// A detected pattern before attribution: which txns, plus a cap for
// counterfactual detectors (undefined = full attributed amount counts).
type Candidate = {
  kind: string;
  txns: ClassifiedTransaction[];
  capMonthlySar?: number;
  meta: Record<string, number | string>;
};

export function runEngine(input: ClassifiedTransaction[]): EngineOutput {
  const txns = input.map((t) => ({ ...t }));
  const debits = txns.filter((t) => t.amount > 0);
  const credits = txns.filter((t) => t.amount < 0);

  const days = txns.length ? day(txns[txns.length - 1]) - day(txns[0]) + 1 : 1;
  const months = Math.max(1, days / 30.44);

  // ---- salary detection from income-classified credits only —
  // transfers-in (own accounts, wallet loads) are money movement, not income
  const incomeCredits = credits.filter((t) => t.category === "income");
  const maxCredit = Math.max(0, ...incomeCredits.map((t) => -t.amount));
  const salaries = incomeCredits.filter((t) => -t.amount >= maxCredit * 0.5);
  const monthlyIncome = incomeCredits.reduce((s, t) => s - t.amount, 0) / months;

  const disc = debits.filter((t) => DISCRETIONARY.has(t.category as Category));
  const discMonthly = disc.reduce((s, t) => s + t.amount, 0) / months;

  const byDay = new Map<number, number>();
  for (const t of disc) byDay.set(day(t), (byDay.get(day(t)) ?? 0) + t.amount);
  const dailyMedian = median([...byDay.values()]);

  const candidates: Candidate[] = [];

  // ---- 1. Recurring subscriptions (merchant + amount ±5%, ≥3 hits, ~monthly gap)
  const byMerchant = new Map<string, ClassifiedTransaction[]>();
  for (const t of debits)
    byMerchant.set(t.merchant, [...(byMerchant.get(t.merchant) ?? []), t]);

  // Bills (rent, telecom, utilities, ATM habits) also recur، they're commitments,
  // not leaks. Only digital subs and AI-unresolved merchants count as leak candidates.
  const SUB_CATEGORIES = new Set(["subscriptions_digital", "other", "entertainment"]);
  const subs: { merchant: string; monthlySar: number; count: number; txns: ClassifiedTransaction[] }[] = [];
  for (const [merchant, ts] of byMerchant) {
    if (ts.length < 3) continue;
    if (!SUB_CATEGORIES.has(ts[0].category)) continue;
    const amounts = ts.map((t) => t.amount);
    const med = median(amounts);
    // ±10%: real-world charges drift (FX, VAT rounding) more than the ±5% ideal
    if (!amounts.every((a) => Math.abs(a - med) / med <= 0.1)) continue;
    const gaps = ts.slice(1).map((t, i) => day(t) - day(ts[i]));
    const medGap = median(gaps);
    if (medGap < 25 || medGap > 35) continue;
    ts.forEach((t) => {
      if (t.class === "planned") t.class = "recurring_leak";
    });
    subs.push({ merchant, monthlySar: med, count: ts.length, txns: ts });
  }
  const subsMonthly = subs.reduce((s, x) => s + x.monthlySar, 0);
  if (subs.length) {
    candidates.push({
      kind: "forgotten_subscription",
      txns: subs.flatMap((s) => s.txns),
      capMonthlySar: subsMonthly,
      meta: { count: subs.length, names: subs.map((s) => s.merchant).join("، ") },
    });
  }

  // zombie: ≥2 digital streams at once → cheapest is the cancel candidate
  const digitalSubs = subs.filter((s) => s.txns[0].category === "subscriptions_digital");
  const zombie =
    digitalSubs.length >= 2
      ? digitalSubs.reduce((a, b) => (a.monthlySar < b.monthlySar ? a : b))
      : undefined;

  // ---- 2. Late-night impulse (00:00–04:00 hard, 22:00+ soft)
  const lateNight = disc.filter((t) => {
    if (t.class === "recurring_leak") return false;
    const h = hourOf(t);
    return h !== undefined && (h >= 22 || h < 4);
  });
  const lateMonthlyCount = lateNight.length / months;
  const lateMonthlySar = lateNight.reduce((s, t) => s + t.amount, 0) / months;
  if (lateMonthlyCount >= 3) {
    lateNight.forEach((t) => {
      if (t.class === "planned") t.class = "impulsive";
    });
    candidates.push({ kind: "late_night", txns: lateNight, meta: {} });
  }

  // ---- 3. Delivery streak (≥4 orders / rolling 7 days)، counterfactual: 2/week
  const delivery = debits
    .filter((t) => t.category === "food_delivery")
    .sort((a, b) => day(a) - day(b));
  let maxWeekly = 0;
  for (const t of delivery) {
    const cnt = delivery.filter((u) => day(u) >= day(t) - 6 && day(u) <= day(t)).length;
    maxWeekly = Math.max(maxWeekly, cnt);
  }
  const deliveryPerWeek = delivery.length / (days / 7);
  const deliveryAvg = delivery.length
    ? delivery.reduce((s, t) => s + t.amount, 0) / delivery.length
    : 0;
  const deliverySaving =
    Math.max(0, (delivery.length - 2 * (days / 7)) * deliveryAvg) / months;
  if (maxWeekly >= 4) {
    candidates.push({
      kind: "delivery_streak",
      txns: delivery,
      capMonthlySar: deliverySaving,
      meta: { perWeek: deliveryPerWeek.toFixed(1), avg: Math.round(deliveryAvg) },
    });
  }

  // ---- 4. Payday burn: discretionary in days 0–4 after salary، counterfactual: excess over median
  const salaryDays = salaries.map(day);
  const windowTxns = disc.filter(
    (t) =>
      t.class !== "recurring_leak" &&
      salaryDays.some((sd) => day(t) >= sd && day(t) - sd <= 4)
  );
  const windowSum = windowTxns.reduce((s, t) => s + t.amount, 0);
  const windowShare = discMonthly > 0 ? windowSum / months / discMonthly : 0;
  const paydayExcess = Math.max(0, windowSum / months - 5 * dailyMedian);
  if (salaries.length && windowShare > 0.3) {
    windowTxns.forEach((t) => {
      if (t.class === "planned") t.class = "impulsive";
    });
    candidates.push({
      kind: "payday_spike",
      txns: windowTxns,
      capMonthlySar: paydayExcess,
      meta: { sharePct: Math.round(windowShare * 100) },
    });
  }

  // ---- 5. Micro-leak (< SAR 100 discretionary, >15/month)، excludes delivery/subs (own detectors)
  const micro = disc.filter(
    (t) =>
      t.amount < 100 &&
      t.class !== "recurring_leak" &&
      t.category !== "food_delivery"
  );
  if (micro.length / months > 15) {
    candidates.push({
      kind: "micro_leak",
      txns: micro,
      meta: { perMonth: Math.round(micro.length / months) },
    });
  }

  // ---- 6. Bank fees
  const fees = debits.filter((t) => t.category === "bank_fees");
  if (fees.length) {
    candidates.push({ kind: "bank_fees", txns: fees, meta: {} });
  }

  // ---- attribution: each txn counts in exactly one leak
  const PRIORITY = [
    "bank_fees",
    "forgotten_subscription",
    "late_night",
    "delivery_streak",
    "payday_spike",
    "micro_leak",
  ];
  candidates.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const taken = new Set<string>();
  const leaks: Leak[] = [];

  for (const c of candidates) {
    const own = c.txns.filter((t) => !taken.has(t.id));
    own.forEach((t) => taken.add(t.id));
    const attributedMonthly = own.reduce((s, t) => s + t.amount, 0) / months;
    const cost = Math.min(attributedMonthly, c.capMonthlySar ?? attributedMonthly);
    if (cost < 1) continue;
    leaks.push(buildLeak(c, own, cost));
  }

  // zombie is advisory (a "do this first" card), costs nothing extra in the total
  if (zombie) {
    leaks.push({
      kind: "zombie_subscription",
      titleAr: "اشتراكات متداخلة",
      detailAr: `لديك ${digitalSubs.length} اشتراكات رقمية متزامنة. إلغاء الأقل استخداماً (مثلاً ${zombie.merchant}) يوفر ${fmt(
        zombie.monthlySar * 12
      )} ر.س سنوياً دون أن تفقد شيئاً تستخدمه فعلاً، الدراسات تظهر أن الشركات تضاعف أرباحها لأن المشتركين لا يعيدون النظر.`,
      monthlyCostSar: 0,
      transactions: zombie.txns.map((t) => t.id),
      severity: "medium",
    });
  }

  const monthlyLeak = leaks.reduce((s, l) => s + l.monthlyCostSar, 0);
  leaks.sort((a, b) => b.monthlyCostSar - a.monthlyCostSar);

  // ponytail: 25% of income leaked = score 100; linear below that
  const leakScore = monthlyIncome
    ? Math.min(100, Math.round((monthlyLeak / (0.25 * monthlyIncome)) * 100))
    : 0;

  // per-category monthly for the AI prompt + UI chart
  const categoryMonthly: Record<string, number> = {};
  for (const t of debits) {
    const key = CATEGORY_AR[t.category as Category] ?? t.category;
    categoryMonthly[key] = (categoryMonthly[key] ?? 0) + t.amount / months;
  }

  const merchantAgg = new Map<string, { sar: number; count: number }>();
  for (const t of disc) {
    const m = merchantAgg.get(t.merchant) ?? { sar: 0, count: 0 };
    m.sar += t.amount;
    m.count++;
    merchantAgg.set(t.merchant, m);
  }
  const topMerchants = [...merchantAgg.entries()]
    .sort((a, b) => b[1].sar - a[1].sar)
    .slice(0, 8)
    .map(([merchant, m]) => ({ merchant, monthlySar: m.sar / months, count: m.count }));

  return {
    transactions: txns,
    leaks,
    leakScore,
    monthlyIncomeSar: monthlyIncome,
    monthlyLeakSar: monthlyLeak,
    months,
    stats: {
      months: Number(months.toFixed(1)),
      monthlyIncomeSar: Math.round(monthlyIncome),
      monthlyDiscretionarySar: Math.round(discMonthly),
      categoryMonthly: Object.fromEntries(
        Object.entries(categoryMonthly).map(([k, v]) => [k, Math.round(v)])
      ),
      salaryDates: salaries.map((t) => t.date),
      paydayWindowSharePct: Math.round(windowShare * 100),
      lateNightCountPerMonth: Number(lateMonthlyCount.toFixed(1)),
      lateNightMonthlySar: Math.round(lateMonthlySar),
      subscriptions: subs.map(({ merchant, monthlySar, count }) => ({
        merchant,
        monthlySar: Math.round(monthlySar),
        count,
      })),
      deliveryPerWeek: Number(deliveryPerWeek.toFixed(1)),
      topMerchants: topMerchants.map((m) => ({ ...m, monthlySar: Math.round(m.monthlySar) })),
    },
  };

  function buildLeak(c: Candidate, own: ClassifiedTransaction[], cost: number): Leak {
    const ids = own.map((t) => t.id);
    switch (c.kind) {
      case "forgotten_subscription":
        return {
          kind: c.kind,
          titleAr: "اشتراكات متكررة تعمل بصمت",
          detailAr: `${c.meta.count} اشتراكات شهرية ثابتة (${c.meta.names}) تكلفك ${fmt(
            cost
          )} ر.س شهرياً، أي ${fmt(cost * 12)} ر.س سنوياً. الدراسات تشير إلى أن الناس يقدّرون اشتراكاتهم بأقل من ثلث قيمتها الفعلية.`,
          monthlyCostSar: cost,
          transactions: ids,
          severity: cost > 150 ? "high" : "medium",
        };
      case "late_night":
        return {
          kind: c.kind,
          titleAr: "مشتريات ما بعد ١٠ مساءً",
          detailAr: `${Math.round(own.length / months)} عملية شهرياً بعد الساعة ١٠ مساءً بقيمة ${fmt(
            cost
          )} ر.س شهرياً. ٣١٪ ممن يشترون في هذا الوقت لا يتذكرون الشراء أصلاً في اليوم التالي.`,
          monthlyCostSar: cost,
          transactions: ids,
          severity: cost > 300 ? "high" : "medium",
        };
      case "delivery_streak":
        return {
          kind: c.kind,
          titleAr: "عادة التوصيل",
          detailAr: `${c.meta.perWeek} طلبات توصيل أسبوعياً بمتوسط ${c.meta.avg} ر.س للطلب. لو اكتفيت بطلبين أسبوعياً لوفّرت ${fmt(
            cost
          )} ر.س شهرياً، أي ${fmt(cost * 12)} ر.س سنوياً.`,
          monthlyCostSar: cost,
          transactions: ids,
          severity: cost > 400 ? "high" : "medium",
        };
      case "payday_spike":
        return {
          kind: c.kind,
          titleAr: "حرق ما بعد الراتب",
          detailAr: `${c.meta.sharePct}٪ من إنفاقك الاستهلاكي يحدث في أول ٥ أيام بعد الراتب، بزيادة ${fmt(
            cost
          )} ر.س شهرياً فوق معدلك الطبيعي. هذا هو «تأثير يوم الراتب» الموثّق علمياً، ويحدث حتى لأصحاب الأرصدة المرتفعة.`,
          monthlyCostSar: cost,
          transactions: ids,
          severity: Number(c.meta.sharePct) > 45 ? "high" : "medium",
        };
      case "micro_leak":
        return {
          kind: c.kind,
          titleAr: "نزيف المبالغ الصغيرة",
          detailAr: `${c.meta.perMonth} عملية صغيرة (أقل من ١٠٠ ر.س) شهرياً، مجموعها ${fmt(
            cost
          )} ر.س شهرياً، تبدو تافهة، لكنها ${fmt(cost * 12)} ر.س في السنة.`,
          monthlyCostSar: cost,
          transactions: ids,
          severity: cost > 500 ? "high" : "low",
        };
      default: // bank_fees
        return {
          kind: "bank_fees",
          titleAr: "رسوم بنكية",
          detailAr: `${fmt(cost * 12)} ر.س سنوياً رسوم وعمولات، هذا التسريب الوحيد الذي لا يحتاج نقاشاً: كل ريال منه توفير ممكن بتغيير طريقة الاستخدام.`,
          monthlyCostSar: cost,
          transactions: ids,
          severity: "low",
        };
    }
  }
}
