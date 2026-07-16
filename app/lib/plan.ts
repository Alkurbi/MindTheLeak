// Recovery-plan engine: turns detected leaks into an ordered, honest action plan.
// "Honest" = each fix type has a realistic recovery rate (you don't reclaim 100%
// of a habit), and the ordering is effort-first: quick wins build momentum.

import type { Leak } from "./types.ts";
import type { GoalInput } from "./resilience.ts";

export type Goal = {
  label: string;
  icon: string;
  targetSar: number;
};

export const GOAL_PRESETS: Goal[] = [
  { icon: "🕋", label: "عمرة عائلية", targetSar: 12000 },
  { icon: "🚗", label: "دفعة أولى لسيارة", targetSar: 20000 },
  { icon: "💍", label: "زواج", targetSar: 50000 },
  { icon: "✈️", label: "سفر", targetSar: 8000 },
  { icon: "📱", label: "جهاز جديد", targetSar: 5000 },
];

// ---- goal persistence (client-only): mtl_goals, tolerating the old single-goal key

export function loadGoals(): GoalInput[] {
  try {
    const raw = localStorage.getItem("mtl_goals");
    if (raw) {
      const goals = JSON.parse(raw) as GoalInput[];
      if (goals.length) return goals;
    }
    const old = localStorage.getItem("mtl_goal"); // pre-resilience single goal
    if (old) return [{ ...(JSON.parse(old) as Goal), sharePct: 100 }];
  } catch {
    // corrupted storage → defaults
  }
  return [{ ...GOAL_PRESETS[0], sharePct: 100 }];
}

export function saveGoals(goals: GoalInput[]): void {
  localStorage.setItem("mtl_goals", JSON.stringify(goals));
}

export function loadShieldMonths(): number {
  const n = Number(localStorage.getItem("mtl_shield_months"));
  return n >= 1 && n <= 6 ? Math.round(n) : 3;
}

export function saveShieldMonths(n: number): void {
  localStorage.setItem("mtl_shield_months", String(n));
}

type Effort = {
  order: number; // plan ordering: quick wins first
  badgeAr: string;
  recoveryRate: number; // realistic fraction of the leak you actually reclaim
};

const EFFORTS: Record<string, Effort> = {
  instant: { order: 0, badgeAr: "سهل، دقيقتان اليوم", recoveryRate: 1.0 },
  auto: { order: 1, badgeAr: "إعداد لمرة واحدة", recoveryRate: 0.8 },
  rule: { order: 2, badgeAr: "قاعدة يومية بسيطة", recoveryRate: 0.6 },
  habit: { order: 3, badgeAr: "تغيير عادة، الأصعب والأكبر", recoveryRate: 0.5 },
};

const FIX_META: Record<string, { effort: keyof typeof EFFORTS; howAr: string }> = {
  forgotten_subscription: {
    effort: "instant",
    howAr: "افتح إعدادات الاشتراكات في جوالك الآن وألغِ كل ما لم تفتحه آخر 30 يوماً.",
  },
  bank_fees: {
    effort: "instant",
    howAr: "فعّل تنبيهات الرسوم وتجنّب العمليات الدولية بالبطاقة الخاطئة.",
  },
  payday_spike: {
    effort: "auto",
    howAr: "اضبط تحويلاً تلقائياً لحساب الادخار صباح يوم الراتب، قبل أن يبدأ الإنفاق.",
  },
  late_night: {
    effort: "rule",
    howAr: "قاعدة الـ 12 ساعة: أي شراء بعد 10 مساءً ينتظر إلى الصباح. إن بقيت تريده، اشتره.",
  },
  micro_leak: {
    effort: "rule",
    howAr: "خصص مبلغاً أسبوعياً ثابتاً للمشتريات الصغيرة، عندما ينتهي، ينتهي.",
  },
  delivery_streak: {
    effort: "habit",
    howAr: "سقف أسبوعي: طلبا توصيل فقط، وانقل تطبيقات التوصيل خارج الشاشة الرئيسية.",
  },
};

export type Fix = {
  kind: string;
  titleAr: string;
  howAr: string;
  badgeAr: string;
  order: number;
  leakMonthlySar: number;
  recoverableSar: number; // leak × recovery rate، the honest number
};

export function buildFixes(leaks: Leak[]): Fix[] {
  return leaks
    .filter((l) => l.monthlyCostSar > 0 && FIX_META[l.kind])
    .map((l) => {
      const meta = FIX_META[l.kind];
      const effort = EFFORTS[meta.effort];
      return {
        kind: l.kind,
        titleAr: l.titleAr,
        howAr: meta.howAr,
        badgeAr: effort.badgeAr,
        order: effort.order,
        leakMonthlySar: l.monthlyCostSar,
        recoverableSar: l.monthlyCostSar * effort.recoveryRate,
      };
    })
    .sort((a, b) => a.order - b.order || b.recoverableSar - a.recoverableSar);
}

export function monthsToGoal(targetSar: number, monthlySaving: number): number | null {
  if (monthlySaving <= 0) return null; // never, at this rate
  return Math.ceil(targetSar / monthlySaving);
}
