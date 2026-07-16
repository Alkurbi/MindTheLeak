"use client";

import { useEffect, useMemo, useState } from "react";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, Legend,
} from "recharts";
import type { AnalysisResult, ClassifiedTransaction } from "@/lib/types.ts";
import type { Stats } from "@/lib/detect.ts";
import { DISCRETIONARY, CATEGORY_AR, type Category } from "@/lib/classify.ts";
import {
  buildFixes, GOAL_PRESETS, loadGoals, saveGoals, loadShieldMonths, saveShieldMonths,
} from "@/lib/plan.ts";
import {
  buildResilience, runwayDaysBought, type ResilienceReport, type GoalInput,
} from "@/lib/resilience.ts";

export type Result = AnalysisResult & { stats: Stats };

const round = (n: number) => Math.round(n).toLocaleString("en-US");
const sar = (n: number) => `${round(n)} ر.س`;

// Arabic count agreement: 1 singular, 2 dual, 3–10 plural, 11+ singular-accusative.
function arCount(n: number, one: string, two: string, few: string, many: string): string {
  n = Math.round(n);
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
const nMonths = (n: number) => arCount(n, "شهر واحد", "شهران", "أشهر", "شهراً");
const nDays = (n: number) => arCount(n, "يوم واحد", "يومان", "أيام", "يوماً");
const nFixes = (n: number) => arCount(n, "إصلاح واحد", "إصلاحان", "إصلاحات", "إصلاحاً");

// ?static=1 (or automation) → skip animations, render final state immediately
function isStatic() {
  return (
    typeof window !== "undefined" &&
    (window.navigator.webdriver || window.location.search.includes("static"))
  );
}

// eased count-up for the reveal
function useCountUp(target: number, ms = 1400) {
  const [v, setV] = useState(() => (isStatic() ? target : 0));
  useEffect(() => {
    if (isStatic()) {
      setV(target);
      return;
    }
    let raf = 0;
    let t0: number | null = null; // first rAF timestamp، same clock as later ticks
    const tick = (t: number) => {
      if (t0 === null) t0 = t;
      const p = Math.min(1, Math.max(0, (t - t0) / ms));
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export default function Dashboard({ result, onReset }: { result: Result; onReset: () => void }) {
  // liquid savings: statement running balance unless the user overrode it (persisted)
  const [savings, setSavings] = useState<number | null>(() => readJson<number>("mtl_savings"));
  const resilience = useMemo(
    () => buildResilience(result.transactions, savings !== null ? { savingsSar: savings } : {}),
    [result.transactions, savings]
  );
  function updateSavings(n: number) {
    setSavings(n);
    localStorage.setItem("mtl_savings", JSON.stringify(n));
  }
  return (
    <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
      {/* header */}
      <div className="flex items-center justify-between mb-8 fade-up">
        <h1 className="text-2xl font-bold text-teal">MindTheLeak</h1>
        <button onClick={onReset} className="text-muted text-sm hover:text-fg">
          ← تحليل ملف آخر
        </button>
      </div>

      <DeltaBanner result={result} />

      {/* 01 الأمان المالي، the resilience model: what your life costs, how long you survive */}
      <Stage n="٠١" title="الأمان المالي" sub="لو انقطع دخلك اليوم، كم شهر تكفيك مدخراتك؟" />
      <RunwayHero r={resilience} onSavings={updateSavings} />
      <BreakTimeline r={resilience} />
      <ObligationsPanel r={resilience} />

      <DripDivider />

      {/* 02 التشخيص، unboxed hero: the vessel and the verdict */}
      <Stage n="٠٢" title="التشخيص" sub="ماذا وجدنا في كشف حسابك" />
      <section className="grid md:grid-cols-[auto_1fr] gap-8 md:gap-12 items-center mb-10">
        <div className="flex flex-col items-center fade-up mx-auto">
          <LiquidGauge score={result.leakScore} />
          <div className="text-muted text-sm mt-1">مؤشر التسريب</div>
        </div>
        <div className="fade-up text-center md:text-right" style={{ animationDelay: "0.15s" }}>
          <div className="text-teal text-sm font-bold mb-3">💡 لحظة الوعي</div>
          <p className="display text-2xl md:text-[2.4rem] font-bold leading-snug md:leading-[1.45] mb-6">
            {result.headlineInsightAr}
          </p>
          <div className="flex flex-wrap justify-center md:justify-start gap-x-10 gap-y-3">
            <InlineStat label="دخلك الشهري" value={result.monthlyIncomeSar} />
            <InlineStat label="التسريب الشهري" value={result.monthlyLeakSar} tone="danger" />
            <InlineStat label="توفير ممكن سنوياً" value={result.monthlyLeakSar * 12} tone="teal" />
          </div>
        </div>
      </section>

      {/* income flow bar */}
      <div className="bg-navy-card/80 border border-teal/10 rounded-2xl p-6 mb-6 fade-up" style={{ animationDelay: "0.35s" }}>
        <h3 className="font-bold mb-1">إلى أين يتدفق راتبك؟</h3>
        <p className="text-muted text-sm mb-5">كل ريال من دخلك الشهري، موزعاً</p>
        <FlowBar result={result} />
      </div>

      <DripDivider />

      {/* 03 الأدلة */}
      <Stage n="٠٣" title="الأدلة" sub="ما وراء الأرقام، كل رقم يمكنك فتحه والتحقق منه" />
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-navy-card/80 border border-teal/10 rounded-2xl p-6 fade-up">
          <h3 className="font-bold mb-1">منحنى الراتب</h3>
          <p className="text-muted text-sm mb-4">الإنفاق حسب الأيام بعد استلام الراتب، لاحظ الانفجار</p>
          <PaydayCurve transactions={result.transactions} salaryDates={result.stats.salaryDates} />
        </div>
        <div className="bg-navy-card/80 border border-teal/10 rounded-2xl p-6 fade-up" style={{ animationDelay: "0.1s" }}>
          <h3 className="font-bold mb-1">الإنفاق الشهري حسب الفئة</h3>
          <p className="text-muted text-sm mb-4">متوسط {nMonths(result.stats.months)}</p>
          <CategoryChart categoryMonthly={result.stats.categoryMonthly} />
        </div>
      </div>

      <div className="bg-navy-card/80 border border-teal/10 rounded-2xl p-6 mb-6 fade-up">
        <h3 className="font-bold mb-1">متى تتخذ قراراتك المتهورة؟</h3>
        <p className="text-muted text-sm mb-5">
          كثافة الإنفاق الاستهلاكي حسب اليوم والوقت، الخلية الأكثر سخونة هي نقطة ضعفك
        </p>
        <Heatmap transactions={result.transactions} />
      </div>

      <h3 className="font-bold text-lg mb-1">التسريبات المكتشفة</h3>
      <p className="text-muted text-sm mb-4">
        كل ريال محسوب مرة واحدة فقط، اضغط على أي تسريب لترى المعاملات التي تقف خلفه
      </p>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        {result.leaks.map((leak, i) => (
          <LeakCard key={leak.kind} leak={leak} transactions={result.transactions} delay={0.05 * i} />
        ))}
      </div>

      <DripDivider />

      {/* 04 الخطة */}
      <Stage n="٠٤" title="الخطة" sub="من التشخيص إلى العلاج، أي كوب نملأ أولاً" />
      <PlanSection result={result} savings={savings} />

      {/* narrative */}
      <div className="bg-navy-card rounded-2xl p-8 mb-6 fade-up" data-testid="narrative">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-xl font-bold">تقريرك السلوكي</h2>
          {result.aiPowered && (
            <span className="text-xs bg-teal text-navy px-2 py-0.5 rounded-full font-bold">
              بالذكاء الاصطناعي
            </span>
          )}
        </div>
        {result.narrativeAr.split("\n\n").map((p, i) => (
          <p key={i} className="leading-loose mb-4 last:mb-0">{p}</p>
        ))}
      </div>

      {/* tips */}
      <div className="bg-navy-soft border border-teal rounded-2xl p-8 mb-10 fade-up">
        <h2 className="text-xl font-bold text-teal mb-4">ابدأ بهذه الخطوات الثلاث</h2>
        <ol className="space-y-3">
          {result.tipsAr.map((tip, i) => (
            <li key={i} className="flex gap-3">
              <span className="bg-teal text-navy font-bold rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span className="leading-relaxed">{tip}</span>
            </li>
          ))}
        </ol>
      </div>

      <footer className="text-center text-muted text-sm pb-6">
        اليوم: رفع كشف الحساب بدون أي بيانات دخول · غداً: ربط مباشر عبر المصرفية المفتوحة
        (SAMA Open Banking) · المعرفة المالية ركيزة من ركائز رؤية 2030
      </footer>
    </main>
  );
}

// stage markers: the dashboard is a real sequence، diagnosis → evidence → plan
function Stage({ n, title, sub }: { n: string; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-4 mb-6 fade-up">
      <span className="display text-5xl md:text-6xl font-bold text-teal/35 leading-none select-none">
        {n}
      </span>
      <div>
        <h2 className="text-2xl font-bold leading-tight">{title}</h2>
        {sub && <p className="text-muted text-sm">{sub}</p>}
      </div>
    </div>
  );
}

// three falling drops connect the stages
function DripDivider() {
  return (
    <div className="flex flex-col items-center gap-1.5 my-12" aria-hidden>
      <span className="w-2 h-2 rounded-full bg-teal/60" />
      <span className="w-1.5 h-1.5 rounded-full bg-teal/40" />
      <span className="w-1 h-1 rounded-full bg-teal/25" />
    </div>
  );
}

// ---- 01 الأمان المالي: crisis runway hero، savings ÷ floor, all inputs visible ----

function RunwayHero({ r, onSavings }: { r: ResilienceReport; onSavings: (n: number) => void }) {
  const months = r.floorSar > 0 ? r.runwayMonths : 0;
  return (
    <section className="grid md:grid-cols-[auto_1fr] gap-8 md:gap-12 items-center mb-8">
      <div className="flex flex-col items-center fade-up mx-auto">
        <RunwayGauge months={months} />
        <div className="text-muted text-sm mt-1">خزان الأمان</div>
      </div>
      <div className="fade-up text-center md:text-right" style={{ animationDelay: "0.15s" }}>
        <div className="text-danger text-sm font-bold mb-3">⏳ لو انقطع دخلك اليوم</div>
        <p className="display text-2xl md:text-[2.4rem] font-bold leading-snug md:leading-[1.45] mb-6">
          فواتيرك مغطاة لمدة{" "}
          <span className="num text-teal" data-testid="runway-months">
            {months.toFixed(1)}
          </span>{" "}
          شهر، ثم يبدأ التسلسل
        </p>
        {/* the equation, inspectable: savings (editable) ÷ floor = runway */}
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-3 gap-y-2 text-sm">
          <label className="text-muted">السيولة المتاحة</label>
          <input
            type="number"
            value={Math.round(r.savingsSar)}
            min={0}
            step={500}
            onChange={(e) => onSavings(Math.max(0, Number(e.target.value)))}
            aria-label="السيولة المتاحة"
            className="num bg-navy-card border border-navy-soft rounded-lg px-3 py-1.5 w-32 text-center font-bold focus:border-teal outline-none"
          />
          <span className="text-muted">ر.س ÷ مصاريفك الأساسية</span>
          <span className="font-bold num">{sar(r.floorSar)}</span>
          <span className="text-muted">شهرياً</span>
        </div>
        <p className="text-muted text-xs mt-3">
          الرصيد مأخوذ من آخر رصيد في كشفك ({r.asOf})، عدّله إن كانت لديك سيولة خارج هذا الحساب
        </p>
      </div>
    </section>
  );
}

// the leak gauge's sibling: a safety tank that drains instead of filling.
// 6 months of floor = full tank (the shield's upper bound).
function RunwayGauge({ months }: { months: number }) {
  const level = Math.max(0, Math.min(1, months / 6));
  const shown = useCountUp(months);
  const top = 30;
  const bottom = 192;
  const waterY = top + (1 - level) * (bottom - top);
  const color = months < 2 ? "var(--danger)" : months < 4 ? "var(--amber)" : "var(--teal)";
  const wave = (y: number) =>
    `M-80 ${y} q20 -9 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V220 H-80 Z`;

  return (
    <div className="relative w-44">
      <svg viewBox="0 0 170 224" className="w-full">
        <defs>
          <clipPath id="runway-clip">
            <path d="M40 30 H130 V150 Q130 192 85 192 Q40 192 40 150 Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#runway-clip)">
          <path d={wave(waterY)} fill={color} opacity="0.28" className={isStatic() ? "" : "wave-b"} />
          <path d={wave(waterY + 4)} fill={color} opacity="0.75" className={isStatic() ? "" : "wave-a"} />
        </g>
        <path
          d="M40 30 H130 V150 Q130 192 85 192 Q40 192 40 150 Z"
          fill="none"
          stroke="var(--muted)"
          strokeOpacity="0.55"
          strokeWidth="2"
        />
        {[2, 4].map((m) => {
          const y = top + (1 - m / 6) * (bottom - top);
          return (
            <g key={m}>
              <line x1="40" y1={y} x2="48" y2={y} stroke="var(--muted)" strokeOpacity="0.35" strokeWidth="1.5" />
              <text x="34" y={y + 3} textAnchor="end" fill="var(--muted)" fontSize="9" opacity="0.7">
                {m}ش
              </text>
            </g>
          );
        })}
        <text
          x="85"
          y="122"
          textAnchor="middle"
          fill="var(--fg)"
          style={{ font: `700 40px var(--font-changa), sans-serif` }}
        >
          {shown.toFixed(1)}
        </text>
        <text x="85" y="142" textAnchor="middle" fill="var(--muted)" fontSize="12">
          شهر
        </text>
      </svg>
    </div>
  );
}

// ---- 01 الأمان المالي: the cascade made concrete، which obligation breaks, when ----

function BreakTimeline({ r }: { r: ResilienceReport }) {
  if (!r.breakEvents.length) return null;
  const tierChip = {
    survival: "bg-danger/15 text-danger border-danger/40",
    committed: "bg-amber/15 text-amber border-amber/40",
  } as const;
  const tierAr = { survival: "أساسي", committed: "التزام" } as const;

  return (
    <div className="bg-navy-card/80 border border-danger/20 rounded-2xl p-6 mb-6 fade-up">
      <h3 className="font-bold mb-1">ماذا ينكسر أولاً؟ التسلسل يوماً بيوم</h3>
      <p className="text-muted text-sm mb-6">{r.assumptionAr}</p>
      <ol className="relative border-r-2 border-navy-soft pr-6 mr-1.5 space-y-6">
        {r.breakEvents.map((e, i) => (
          <li key={e.labelAr} className="relative" data-testid="break-event">
            <span
              className={`absolute -right-[1.95rem] top-1 w-3.5 h-3.5 rounded-full border-2 border-navy-card ${
                e.tier === "survival" ? "bg-danger" : "bg-amber"
              }`}
            />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-0.5">
              <span className="font-bold num">
                {i === 0 ? "أول كسر: " : ""}بعد {nDays(e.dayOffset)}
              </span>
              <span className="text-muted text-xs num">{e.date}</span>
              <span className={`text-xs border rounded-full px-2 py-px ${tierChip[e.tier]}`}>
                {tierAr[e.tier]}
              </span>
            </div>
            <div className="text-sm mb-0.5">
              {e.labelAr}، <span className="num">{sar(e.amountSar)}</span> لا تُدفع
            </div>
            <p className="text-danger/90 text-sm">{e.consequenceAr}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---- 01 الأمان المالي: the model's inputs, inspectable، obligations, floor, confidence ----

function cadenceAr(days: number): string {
  if (days >= 25 && days <= 35) return "شهري";
  if (days >= 330 && days <= 400) return "سنوي";
  if (days >= 6 && days <= 8) return "أسبوعي";
  return `كل ${nDays(days)}`;
}

function ObligationsPanel({ r }: { r: ResilienceReport }) {
  const tierStyle = {
    survival: "bg-danger/15 text-danger border-danger/40",
    committed: "bg-amber/15 text-amber border-amber/40",
  } as const;

  return (
    <div className="bg-navy-card/80 border border-teal/10 rounded-2xl p-6 mb-6 fade-up">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h3 className="font-bold">مصاريفك الأساسية، ماذا تكلف حياتك في حدها الأدنى؟</h3>
        <div className="text-left">
          <span className="display text-2xl font-bold text-teal num">{sar(r.floorSar)}</span>
          <span className="text-muted text-sm"> / شهر</span>
        </div>
      </div>
      <p className="text-muted text-sm mb-5">
        التزاماتك الحاملة تعلمناها من كشفك نفسه، المبلغ والإيقاع من التاريخ الفعلي، لا من تقديرك
      </p>

      <div className="space-y-2">
        {r.obligations.map((o) => (
          <div key={o.merchant} className="flex items-center gap-3 text-sm">
            <span className={`text-xs border rounded-full px-2 py-px shrink-0 ${tierStyle[o.tier]}`}>
              {o.tierAr}
            </span>
            <span className="truncate flex-1">{o.merchant}</span>
            <span className="text-muted text-xs shrink-0">
              <span className="num">{sar(o.amountSar)}</span> {cadenceAr(o.cadenceDays)}
            </span>
            <span className="font-bold num shrink-0 w-28 text-left">{sar(o.monthlySar)}/شهر</span>
          </div>
        ))}
        {r.groceriesMonthlySar > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-xs border rounded-full px-2 py-px shrink-0 bg-danger/15 text-danger border-danger/40">
              أساسي
            </span>
            <span className="truncate flex-1">تموينات أساسية</span>
            <span className="text-muted text-xs shrink-0">وسيط الشهر</span>
            <span className="font-bold num shrink-0 w-28 text-left">{sar(r.groceriesMonthlySar)}/شهر</span>
          </div>
        )}
      </div>

      <p className="text-muted text-xs mt-4 pt-3 border-t border-navy-soft">🧭 {r.confidenceAr}</p>
    </div>
  );
}

function InlineStat({
  label, value, tone,
}: { label: string; value: number; tone?: "danger" | "teal" }) {
  const v = useCountUp(value);
  return (
    <div>
      <div
        className={`display text-2xl font-bold num leading-none ${
          tone === "danger" ? "text-danger" : tone === "teal" ? "text-teal" : ""
        }`}
      >
        {sar(v)}
      </div>
      <div className="text-muted text-xs mt-1.5">{label}</div>
    </div>
  );
}

// The signature: the leak score as a vessel filling with water.
// Wave surface rolls; a drop falls from the tap above. Severity = color.
function LiquidGauge({ score }: { score: number }) {
  const shown = useCountUp(score);
  const top = 30;
  const bottom = 192;
  const waterY = top + (1 - score / 100) * (bottom - top);
  const color = score >= 60 ? "var(--danger)" : score >= 30 ? "var(--amber)" : "var(--teal)";
  // 80px-period wave. The loop shifts -80px, so the path must overhang the
  // vessel by ≥80px on BOTH sides or a gap flashes at the right wall each cycle.
  const wave = (y: number) =>
    `M-80 ${y} q20 -9 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V220 H-80 Z`;

  return (
    <div className="relative w-44">
      <svg viewBox="0 0 170 224" className="w-full">
        <defs>
          <clipPath id="vessel-clip">
            <path d="M40 30 H130 V150 Q130 192 85 192 Q40 192 40 150 Z" />
          </clipPath>
        </defs>

        {/* tap + drop */}
        <rect x="70" y="2" width="30" height="8" rx="3" fill="var(--navy-soft)" stroke="var(--teal-dim)" strokeWidth="1" />
        <circle cx="85" cy="16" r="4" fill={color} className={isStatic() ? "" : "drip-short"} opacity={isStatic() ? 0 : 1} />

        {/* water, clipped to the vessel */}
        <g clipPath="url(#vessel-clip)">
          <g className={isStatic() ? "" : "water-rise"}>
            <path d={wave(waterY)} fill={color} opacity="0.28" className={isStatic() ? "" : "wave-b"} />
            <path d={wave(waterY + 4)} fill={color} opacity="0.75" className={isStatic() ? "" : "wave-a"} />
          </g>
        </g>

        {/* vessel outline + depth ticks */}
        <path
          d="M40 30 H130 V150 Q130 192 85 192 Q40 192 40 150 Z"
          fill="none"
          stroke="var(--muted)"
          strokeOpacity="0.55"
          strokeWidth="2"
        />
        {[25, 50, 75].map((t) => {
          const y = top + (1 - t / 100) * (bottom - top);
          return <line key={t} x1="40" y1={y} x2="48" y2={y} stroke="var(--muted)" strokeOpacity="0.35" strokeWidth="1.5" />;
        })}

        {/* score */}
        <text
          x="85"
          y="122"
          textAnchor="middle"
          fill="var(--fg)"
          style={{ font: `700 44px var(--font-changa), sans-serif` }}
        >
          {Math.round(shown)}
        </text>
        <text x="85" y="142" textAnchor="middle" fill="var(--muted)" fontSize="12">
          /100
        </text>
      </svg>
    </div>
  );
}

// monthly money flow, shared by the flow bar and the plan projection.
// Transfers are money MOVEMENT (own accounts, family, wallets)، not consumption.
function flowNumbers(result: Result) {
  const months = result.stats.months || 1;
  const debits = result.transactions.filter((t) => t.amount > 0);
  const transferOut =
    debits.filter((t) => t.category === "transfer").reduce((s, t) => s + t.amount, 0) / months;
  const totalOut =
    debits.filter((t) => t.category !== "transfer").reduce((s, t) => s + t.amount, 0) / months;
  const discOut =
    debits
      .filter((t) => DISCRETIONARY.has(t.category as Category))
      .reduce((s, t) => s + t.amount, 0) / months;
  const income = Math.max(result.monthlyIncomeSar, totalOut + transferOut);
  return {
    totalOut,
    transferOut,
    discOut,
    income,
    baselineSaving: Math.max(0, income - totalOut - transferOut),
  };
}

// income → commitments / conscious spending / leaks / transfers / left over
function FlowBar({ result }: { result: Result }) {
  const seg = useMemo(() => {
    const { totalOut, transferOut, discOut, income, baselineSaving } = flowNumbers(result);
    const leak = result.monthlyLeakSar;
    return [
      { label: "التزامات وفواتير", sar: totalOut - discOut, color: "#3d5a80" },
      { label: "إنفاق منضبط", sar: Math.max(0, discOut - leak), color: "var(--teal-dim)" },
      { label: "تسريبات", sar: leak, color: "var(--danger)" },
      { label: "تحويلات لحسابات أخرى", sar: transferOut, color: "#6b5b95" },
      { label: "المتبقي للادخار", sar: baselineSaving, color: "var(--teal)" },
    ]
      .filter((s) => s.sar > 0.5)
      .map((s) => ({ ...s, pct: (s.sar / income) * 100 }));
  }, [result]);

  return (
    <div>
      <div className="flex h-10 rounded-xl overflow-hidden">
        {seg.map((s) => (
          <div
            key={s.label}
            className="h-full transition-all duration-1000"
            style={{ width: `${s.pct}%`, background: s.color }}
            title={`${s.label}: ${sar(s.sar)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
        {seg.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: s.color }} />
            <span className="text-muted">{s.label}</span>
            <span className="font-bold num">{sar(s.sar)}</span>
            <span className="text-muted text-xs num">({Math.round(s.pct)}٪)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const BANDS = [
  { label: "صباحاً", icon: "🌅", from: 6, to: 12 },
  { label: "ظهراً", icon: "☀️", from: 12, to: 17 },
  { label: "مساءً", icon: "🌆", from: 17, to: 22 },
  { label: "ليلاً", icon: "🌙", from: 22, to: 30 }, // 22:00–06:00 (wraps)
];

// A real heatmap: color carries the data, numbers stay out of the way.
function Heatmap({ transactions }: { transactions: ClassifiedTransaction[] }) {
  const { grid, max, hot } = useMemo(() => {
    const grid = BANDS.map(() => new Array(7).fill(0) as number[]);
    for (const t of transactions) {
      if (t.amount <= 0 || !t.time) continue;
      if (!DISCRETIONARY.has(t.category as Category)) continue;
      const h = Number(t.time.split(":")[0]);
      const dow = new Date(t.date + "T00:00:00").getDay();
      const band = BANDS.findIndex(({ from, to }) =>
        to > 24 ? h >= from || h < to - 24 : h >= from && h < to
      );
      if (band >= 0) grid[band][dow] += t.amount;
    }
    let max = 0, hot: [number, number] = [0, 0];
    grid.forEach((row, b) =>
      row.forEach((v, d) => {
        if (v > max) { max = v; hot = [b, d]; }
      })
    );
    return { grid, max, hot };
  }, [transactions]);

  // statement PDFs carry dates only، without times this analysis is impossible
  if (max === 0) {
    return (
      <div className="text-center py-8 px-4 border border-dashed border-navy-soft rounded-xl">
        <div className="text-3xl mb-3">🕐</div>
        <p className="mb-1">كشفك لا يتضمن وقت العمليات، لذا لا يمكن تحليل توقيت قراراتك</p>
        <p className="text-muted text-sm">
          كشوف الـ PDF تحمل التاريخ فقط، ملف CSV من تطبيق البنك يتضمن الوقت عادةً ويفعّل هذا التحليل
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        className="grid gap-1.5 items-center"
        style={{ gridTemplateColumns: "auto repeat(7, minmax(0, 1fr))" }}
      >
        <span />
        {WEEKDAYS.map((d) => (
          <span key={d} className="text-muted text-xs text-center pb-1 truncate">
            {d}
          </span>
        ))}
        {BANDS.map((band, b) => (
          <FragmentRow key={band.label}>
            <span className="text-muted text-xs whitespace-nowrap pl-3">
              {band.icon} {band.label}
            </span>
            {WEEKDAYS.map((_, d) => {
              const v = grid[b][d];
              const intensity = max ? v / max : 0;
              const isHot = b === hot[0] && d === hot[1] && max > 0;
              return (
                <div
                  key={d}
                  title={v > 0 ? `${WEEKDAYS[d]} ${band.label}: ${sar(v)}` : `${WEEKDAYS[d]} ${band.label}: لا إنفاق`}
                  className={`h-10 rounded-lg transition-transform hover:scale-[1.06] ${
                    isHot ? "ring-2 ring-danger ring-offset-2 ring-offset-navy-card" : ""
                  }`}
                  style={{
                    background:
                      intensity === 0
                        ? "rgba(27, 46, 68, 0.55)"
                        : `rgba(255, 107, 107, ${0.12 + intensity * 0.78})`,
                  }}
                />
              );
            })}
          </FragmentRow>
        ))}
      </div>

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        {max > 0 && (
          <p className="text-sm">
            🔥 نقطتك الساخنة: <b>{WEEKDAYS[hot[1]]} {BANDS[hot[0]].label}</b>، {" "}
            <span className="num">{sar(max)}</span> خلال فترة التحليل
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>أقل</span>
          <div
            className="h-2.5 w-28 rounded-full"
            style={{
              background:
                "linear-gradient(to left, rgba(27,46,68,0.55), rgba(255,107,107,0.9))",
            }}
          />
          <span>أكثر</span>
        </div>
      </div>
    </div>
  );
}

// grid rows without wrapper elements
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function LeakCard({
  leak, transactions, delay,
}: { leak: Result["leaks"][number]; transactions: ClassifiedTransaction[]; delay: number }) {
  const severityColor = { high: "border-danger", medium: "border-amber", low: "border-muted" } as const;
  const backing = useMemo(() => {
    const ids = new Set(leak.transactions);
    return transactions
      .filter((t) => ids.has(t.id))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [leak, transactions]);

  return (
    <details
      className={`leak-card bg-navy-card rounded-2xl p-5 border-r-4 ${severityColor[leak.severity]} fade-up`}
      style={{ animationDelay: `${delay}s` }}
    >
      <summary>
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-bold">{leak.titleAr}</h3>
          {leak.monthlyCostSar > 0 && (
            <span className="text-danger font-bold whitespace-nowrap num">
              −{sar(leak.monthlyCostSar)}/شهر
            </span>
          )}
        </div>
        <p className="text-muted text-sm leading-relaxed">{leak.detailAr}</p>
        <p className="text-teal text-xs mt-2">
          ▾ {leak.transactions.length} معاملة خلف هذا الرقم
        </p>
      </summary>
      <div className="mt-3 pt-3 border-t border-navy-soft space-y-1.5">
        {backing.map((t) => (
          <div key={t.id} className="flex justify-between text-sm">
            <span className="text-muted truncate ml-3">
              <span className="num">{t.date}</span>
              {t.time && <span className="num"> · {t.time}</span>} · {t.merchant}
            </span>
            <span className="num shrink-0">{sar(t.amount)}</span>
          </div>
        ))}
        {leak.transactions.length > 5 && (
          <div className="text-muted text-xs pt-1">
            + {leak.transactions.length - 5} معاملة أخرى…
          </div>
        )}
      </div>
    </details>
  );
}

// ---- memory: last analysis snapshot + committed plan live in localStorage ----

type Snapshot = { date: string; leakScore: number; monthlyLeakSar: number };

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function DeltaBanner({ result }: { result: Result }) {
  const [prev, setPrev] = useState<Snapshot | null>(null);
  useEffect(() => {
    setPrev(readJson<Snapshot>("mtl_snapshot"));
    localStorage.setItem(
      "mtl_snapshot",
      JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        leakScore: result.leakScore,
        monthlyLeakSar: Math.round(result.monthlyLeakSar),
      } satisfies Snapshot)
    );
  }, [result]);

  if (!prev || prev.monthlyLeakSar === 0) return null;
  const deltaPct = Math.round(
    ((result.monthlyLeakSar - prev.monthlyLeakSar) / prev.monthlyLeakSar) * 100
  );
  if (Math.abs(deltaPct) < 2) return null;
  const better = deltaPct < 0;
  return (
    <div
      className={`rounded-xl px-5 py-3 mb-6 text-sm border fade-up ${
        better ? "border-teal bg-navy-soft" : "border-amber bg-navy-soft"
      }`}
    >
      {better ? "📉" : "📈"} منذ تحليلك السابق ({prev.date}): تسريبك الشهري{" "}
      <b className={`num ${better ? "text-teal" : "text-amber"}`}>
        {better ? "" : "+"}
        {deltaPct}٪
      </b>{" "}
      ({sar(prev.monthlyLeakSar)} ← {sar(result.monthlyLeakSar)})
      {better ? "، استمر، الخطة تعمل." : "، راجع خطتك أدناه."}
    </div>
  );
}

// ---- the interactive recovery plan: which cup fills first ----

function PlanSection({ result, savings }: { result: Result; savings: number | null }) {
  const fixes = useMemo(() => buildFixes(result.leaks), [result.leaks]);
  const committed = readJson<{ kinds: string[]; date: string }>("mtl_commitments");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(committed?.kinds ?? fixes.map((f) => f.kind))
  );
  const [saved, setSaved] = useState(false);
  const [goals, setGoals] = useState<GoalInput[]>(loadGoals);
  const [shieldMonths, setShieldMonths] = useState<number>(loadShieldMonths);

  const { baselineSaving } = flowNumbers(result);
  const recovered = fixes
    .filter((f) => selected.has(f.kind))
    .reduce((s, f) => s + f.recoverableSar, 0);
  const withPlan = baselineSaving + recovered;

  // the same engine, now with the live plan: shield sizing + goal allocation
  const plan = useMemo(
    () =>
      buildResilience(result.transactions, {
        ...(savings !== null ? { savingsSar: savings } : {}),
        shieldMonths,
        goals,
        monthlySavingSar: withPlan,
      }),
    [result.transactions, savings, shieldMonths, goals, withPlan]
  );

  const horizon = Math.min(36, Math.max(plan.shield.etaMonths ?? 12, 12) + 2);
  // real projection: both lines start from the savings you have today
  const chart = Array.from({ length: horizon + 1 }, (_, m) => ({
    m,
    بدون: Math.round(plan.savingsSar + baselineSaving * m),
    بخطتك: Math.round(plan.savingsSar + withPlan * m),
  }));

  function toggle(kind: string) {
    setSaved(false);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function commit() {
    localStorage.setItem(
      "mtl_commitments",
      JSON.stringify({ kinds: [...selected], date: new Date().toISOString().slice(0, 10) })
    );
    setSaved(true);
  }

  return (
    <div className="bg-navy-card rounded-2xl p-8 mb-6 fade-up border border-teal/40">
      <h2 className="text-xl font-bold mb-1">خطة التوفير: صندوق الطوارئ أولاً، ثم أهدافك 🛡</h2>
      <p className="text-muted text-sm mb-6">
        يُموَّل الصندوق أولاً بـ70٪ من ادخارك حتى يكتمل، ثم تتقاسم أهدافك الباقي بالنسب التي
        تحددها. فعّل أو عطّل أي إصلاح وشاهد أثره فوراً. الأرقام واقعية ولا نَعِد بالمستحيل.
      </p>

      <ShieldGoalsPanel
        plan={plan}
        onShieldMonths={(n) => {
          setShieldMonths(n);
          saveShieldMonths(n);
        }}
        onGoals={(gs) => {
          setGoals(gs);
          saveGoals(gs);
        }}
      />

      <p className="text-muted text-sm mb-6 text-center num" data-testid="plan-summary">
        ادخارك الشهري بخطتك {sar(withPlan)}، منها {sar(recovered)} توفير فعلي من{" "}
        {nFixes(selected.size)} مفعّلة. هذا يضيف{" "}
        <b className="text-teal">{nDays(runwayDaysBought(recovered, plan.floorSar))}</b> إلى رصيد
        أمانك كل شهر
      </p>

      {/* projection */}
      <p className="text-muted text-sm mb-2">
        نمو مدخراتك شهراً بشهر، بدءاً من رصيدك اليوم:{" "}
        <span className="text-teal font-bold">الأخضر</span> بخطتك،
        <span className="text-fg"> الرمادي المتقطع</span> بدونها. الفارق بينهما هو ما تكسبه من معالجة
        التسريبات.
      </p>
      <div className="mb-6" dir="ltr">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chart} margin={{ top: 8, right: 12, left: 12, bottom: 4 }}>
            <CartesianGrid stroke="var(--navy-soft)" vertical={false} />
            <XAxis dataKey="m" stroke="var(--muted)" fontSize={11} />
            <YAxis stroke="var(--muted)" fontSize={11} width={54} />
            <Tooltip
              contentStyle={{ background: "var(--navy-soft)", border: "1px solid var(--teal)", borderRadius: 8 }}
              formatter={(v, name) => [`${Number(v).toLocaleString("en-US")} ر.س`, name]}
              labelFormatter={(m) => `بعد ${nMonths(Number(m))}`}
            />
            <Legend />
            <Line type="monotone" dataKey="بدون" stroke="var(--muted)" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="بخطتك" stroke="var(--teal)" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ordered fixes with toggles */}
      <div className="space-y-3 mb-6">
        {fixes.map((f, i) => {
          const on = selected.has(f.kind);
          return (
            <div
              key={f.kind}
              className={`flex items-start gap-4 rounded-xl p-4 border transition ${
                on ? "border-teal/50 bg-navy-soft" : "border-navy-soft bg-navy opacity-60"
              }`}
            >
              <button
                onClick={() => toggle(f.kind)}
                aria-label={`تفعيل ${f.titleAr}`}
                className={`mt-1 w-11 h-6 rounded-full relative transition shrink-0 ${
                  on ? "bg-teal" : "bg-navy-soft border border-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-fg transition-all ${
                    on ? "right-0.5" : "right-5"
                  }`}
                />
              </button>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-bold">
                    {i + 1}. {f.titleAr}
                  </span>
                  <span className="text-xs bg-navy-card border border-muted/40 text-muted px-2 py-0.5 rounded-full">
                    {f.badgeAr}
                  </span>
                </div>
                <p className="text-muted text-sm">{f.howAr}</p>
                {/* the leak, re-priced in survival time، beside the SAR figure, never instead */}
                {Math.round(runwayDaysBought(f.recoverableSar, plan.floorSar)) > 0 && (
                  <p className={`text-xs mt-1 ${on ? "text-teal" : "text-muted"}`}>
                    يضيف {nDays(runwayDaysBought(f.recoverableSar, plan.floorSar))} إلى أمانك شهرياً
                  </p>
                )}
              </div>
              <div className="text-left shrink-0">
                <div className={`font-bold num ${on ? "text-teal" : "text-muted"}`}>
                  +{sar(f.recoverableSar)}
                </div>
                <div className="text-muted text-xs">شهرياً</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={commit}
          className="bg-teal text-navy font-bold px-8 py-3 rounded-xl hover:opacity-90 transition"
        >
          {saved ? "✓ خطة معتمدة" : "اعتمد هذه الخطة"}
        </button>
        {committed && !saved && (
          <span className="text-muted text-sm">
            لديك خطة معتمدة منذ <span className="num">{committed.date}</span>، عدّلها واعتمدها من جديد
          </span>
        )}
        {saved && (
          <span className="text-teal text-sm">
            سنقارن تحليلك القادم بهذه الخطة، ارفع كشفاً جديداً الشهر القادم لترى تقدمك
          </span>
        )}
      </div>
    </div>
  );
}

// ---- shield + goals: the allocation, visible and editable ----

function ShieldGoalsPanel({
  plan, onShieldMonths, onGoals,
}: {
  plan: ResilienceReport;
  onShieldMonths: (n: number) => void;
  onGoals: (gs: GoalInput[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GoalInput[]>(plan.goals);
  const sum = draft.reduce((s, g) => s + g.sharePct, 0);
  const shieldDone = plan.shield.fundedPct >= 100;

  function startEdit() {
    setDraft(plan.goals.map(({ label, icon, targetSar, sharePct }) => ({ label, icon, targetSar, sharePct })));
    setEditing(true);
  }

  return (
    <div className="bg-navy-soft rounded-xl p-5 mb-6">
      {/* shield: goal #1, structurally، sized in months of the user's own floor */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-2xl">🛡</span>
        <div className="flex-1 min-w-40">
          <div className="font-bold">صندوق الطوارئ · الهدف الأول</div>
          <div className="text-muted text-xs">
            {nMonths(plan.shield.months)} من مصاريفك الأساسية ={" "}
            <span className="num">{sar(plan.shield.targetSar)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="حجم الصندوق بالأشهر">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => onShieldMonths(n)}
              className={`w-8 h-8 rounded-lg text-sm font-bold num transition ${
                n === plan.shield.months
                  ? "bg-teal text-navy"
                  : "bg-navy-card text-muted hover:text-fg"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="h-2.5 bg-navy rounded-full overflow-hidden mb-1.5">
        <div
          className="h-full rounded-full bg-teal transition-all duration-700"
          style={{ width: `${Math.min(100, plan.shield.fundedPct)}%` }}
        />
      </div>
      <p className="text-muted text-xs mb-5">
        {shieldDone ? (
          <>الصندوق مكتمل من سيولتك الحالية ✓، أهدافك تتقاسم كامل ادخارك الشهري</>
        ) : (
          <>
            مموّل <span className="num">{Math.round(plan.shield.fundedPct)}٪</span> من سيولتك الحالية
            {plan.shield.etaMonths !== null && (
              <>، يكتمل خلال {nMonths(plan.shield.etaMonths)} (يأخذ 70٪ من ادخارك،
              وأهدافك تتقاسم 30٪ الباقية)</>
            )}
          </>
        )}
      </p>

      {/* the user's goals, each with its share and honest ETA */}
      {!editing ? (
        <>
          <div className="space-y-2.5">
            {plan.goals.map((g) => (
              <div key={g.label} className="flex flex-wrap items-center gap-3 text-sm" data-testid="goal-row">
                <span className="text-xl">{g.icon}</span>
                <span className="font-bold flex-1 min-w-32">{g.label}</span>
                <span className="text-muted text-xs num">{sar(g.targetSar)}</span>
                <span className="text-xs bg-navy-card rounded-full px-2 py-0.5 num">{g.sharePct}٪</span>
                <span className="w-40 text-left text-xs">
                  {g.etaMonths !== null ? (
                    <>
                      <span className="text-teal font-bold">{nMonths(g.etaMonths)}</span>، {" "}
                      <span className="num">{sar(g.monthlySar)}</span>/شهر
                    </>
                  ) : (
                    <span className="text-danger">لن يكتمل بهذا الإيقاع</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <button onClick={startEdit} className="text-teal text-sm mt-4 hover:underline">
            ✎ تعديل الأهداف والنسب
          </button>
        </>
      ) : (
        <div>
          <div className="space-y-2.5 mb-3">
            {draft.map((g, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xl">{g.icon}</span>
                <input
                  value={g.label}
                  aria-label={`اسم الهدف ${i + 1}`}
                  onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, label: e.target.value } : d)))}
                  className="bg-navy-card border border-navy-soft rounded-lg px-2 py-1 w-32 focus:border-teal outline-none"
                />
                <input
                  type="number"
                  value={g.targetSar}
                  min={100}
                  step={500}
                  aria-label={`مبلغ ${g.label}`}
                  onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, targetSar: Number(e.target.value) } : d)))}
                  className="num bg-navy-card border border-navy-soft rounded-lg px-2 py-1 w-24 text-center focus:border-teal outline-none"
                />
                <span className="text-muted text-xs">ر.س</span>
                <input
                  type="number"
                  value={g.sharePct}
                  min={0}
                  max={100}
                  aria-label={`نسبة ${g.label}`}
                  onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, sharePct: Number(e.target.value) } : d)))}
                  className="num bg-navy-card border border-navy-soft rounded-lg px-2 py-1 w-16 text-center focus:border-teal outline-none"
                />
                <span className="text-muted text-xs">٪</span>
                {draft.length > 1 && (
                  <button
                    onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                    aria-label={`حذف ${g.label}`}
                    className="text-muted hover:text-danger"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {GOAL_PRESETS.filter((p) => !draft.some((d) => d.label === p.label)).map((p) => (
              <button
                key={p.label}
                onClick={() => setDraft([...draft, { ...p, sharePct: 0 }])}
                className="text-xs border border-navy-card bg-navy-card rounded-full px-3 py-1 text-muted hover:text-fg"
              >
                + {p.icon} {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <span
              data-testid="share-sum"
              className={`text-sm font-bold num ${sum === 100 ? "text-teal" : "text-danger"}`}
            >
              المجموع: {sum}٪
            </span>
            <button
              onClick={() => {
                onGoals(draft);
                setEditing(false);
              }}
              disabled={sum !== 100 || draft.some((g) => !g.label || g.targetSar <= 0)}
              className="bg-teal text-navy text-sm font-bold px-5 py-1.5 rounded-lg disabled:opacity-40"
            >
              حفظ
            </button>
            <button onClick={() => setEditing(false)} className="text-muted text-sm hover:text-fg">
              إلغاء
            </button>
            {sum !== 100 && <span className="text-muted text-xs">النسب يجب أن تساوي 100٪</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// Catmull-Rom → bezier, y clamped so smoothing never dips below the baseline
function smoothArea(pts: [number, number][], baseline: number): { line: string; area: string } {
  if (pts.length < 2) return { line: "", area: "" };
  const cl = (y: number) => Math.min(baseline, y);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${cl(p1[1] + (p2[1] - p0[1]) / 6)} ${
      p2[0] - (p3[0] - p1[0]) / 6
    } ${cl(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
  }
  const area = `${d} L ${pts[pts.length - 1][0]} ${baseline} L ${pts[0][0]} ${baseline} Z`;
  return { line: d, area };
}

// موجة الراتب، RTL-native: salary day on the right, the month flows leftward.
// The story is annotated on the chart itself: the burn zone, the peak, the fade.
function PaydayCurve({
  transactions, salaryDates,
}: { transactions: ClassifiedTransaction[]; salaryDates: string[] }) {
  const buckets = useMemo(() => {
    const salaryDays = salaryDates.map((d) => new Date(d + "T00:00:00").getTime() / 86400000);
    const b = new Array(30).fill(0);
    for (const t of transactions) {
      // discretionary only، the curve's story is behavioral burn, not bills/transfers
      if (t.amount <= 0 || !DISCRETIONARY.has(t.category as Category)) continue;
      const td = new Date(t.date + "T00:00:00").getTime() / 86400000;
      const candidates = salaryDays.filter((s) => s <= td);
      if (!candidates.length) continue;
      const offset = Math.floor(td - Math.max(...candidates));
      if (offset >= 0 && offset < 30) b[offset] += t.amount;
    }
    return b.map((v) => Math.round(v / Math.max(1, salaryDates.length)));
  }, [transactions, salaryDates]);

  const W = 600, H = 230;
  const pad = { top: 40, right: 46, bottom: 30, left: 14 };
  const innerW = W - pad.left - pad.right;
  const baseline = H - pad.bottom;
  const maxV = Math.max(...buckets, 1) * 1.12;
  const x = (day: number) => W - pad.right - (day / 29) * innerW; // RTL
  const y = (v: number) => pad.top + (1 - v / maxV) * (baseline - pad.top);

  const pts = buckets.map((v, i) => [x(i), y(v)] as [number, number]);
  const { line, area } = smoothArea(pts, baseline);
  const peakDay = buckets.indexOf(Math.max(...buckets));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="الإنفاق حسب الأيام بعد الراتب">
      <defs>
        <linearGradient id="wave-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--danger)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--danger)" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* burn zone: days 0–4 */}
      <rect
        x={x(4)} y={pad.top - 14} width={x(0) - x(4)} height={baseline - pad.top + 14}
        fill="var(--danger)" opacity="0.07"
      />
      <text x={(x(0) + x(4)) / 2} y={pad.top - 20} textAnchor="middle" fill="var(--danger)" fontSize="12" fontWeight="600">
        منطقة الحرق 🔥
      </text>

      {/* baseline + mid gridline */}
      <line x1={pad.left} y1={baseline} x2={W - pad.right} y2={baseline} stroke="var(--navy-soft)" strokeWidth="1.5" />
      <line x1={pad.left} y1={y(maxV / 2)} x2={W - pad.right} y2={y(maxV / 2)} stroke="var(--navy-soft)" strokeDasharray="3 5" />
      <text x={pad.left} y={y(maxV / 2) - 5} fill="var(--muted)" fontSize="10" className="num">
        {round(maxV / 2)}
      </text>

      {/* salary-day marker */}
      <line x1={x(0)} y1={pad.top - 8} x2={x(0)} y2={baseline} stroke="var(--teal)" strokeDasharray="4 4" strokeWidth="1.5" />
      <text x={x(0)} y={H - 8} textAnchor="middle" fill="var(--teal)" fontSize="12" fontWeight="600">
        💰 يوم الراتب
      </text>

      {/* the wave */}
      <path d={area} fill="url(#wave-fill)" />
      <path d={line} fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinejoin="round" />

      {/* peak callout */}
      <circle cx={x(peakDay)} cy={y(buckets[peakDay])} r="4.5" fill="var(--danger)" stroke="var(--fg)" strokeWidth="1.5" />
      <text x={x(peakDay)} y={y(buckets[peakDay]) - 12} textAnchor="middle" fill="var(--fg)" fontSize="13" fontWeight="700" className="num">
        {sar(buckets[peakDay])}
      </text>

      {/* day ticks, flowing leftward */}
      {[7, 14, 21, 28].map((d) => (
        <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fill="var(--muted)" fontSize="10">
          <tspan className="num">{d}</tspan> يوم
        </text>
      ))}
    </svg>
  );
}

// Clean RTL bars. Color is information: coral = squeezable, slate = committed.
function CategoryChart({ categoryMonthly }: { categoryMonthly: Record<string, number> }) {
  const discAr = useMemo(
    () => new Set([...DISCRETIONARY].map((c) => CATEGORY_AR[c])),
    []
  );
  const data = useMemo(
    () =>
      Object.entries(categoryMonthly)
        .filter(([k]) => k !== "دخل")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7),
    [categoryMonthly]
  );
  const maxV = Math.max(...data.map(([, v]) => v), 1);

  return (
    <div>
      <div className="space-y-3.5">
        {data.map(([name, v]) => {
          const disc = discAr.has(name);
          return (
            <div key={name}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm">
                  {name}
                  {disc && (
                    <span className="text-danger/90 text-[10px] mr-2 border border-danger/40 rounded-full px-1.5 py-px">
                      قابل للضغط
                    </span>
                  )}
                </span>
                <span className="text-sm font-bold num">{sar(v)}</span>
              </div>
              <div className="h-2.5 bg-navy rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${(v / maxV) * 100}%`,
                    background: disc
                      ? "linear-gradient(to left, var(--danger), #d94f6b)"
                      : "#3d5a80",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-5 mt-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm inline-block bg-danger" /> استهلاكي، هنا تعيش التسريبات
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#3d5a80" }} /> التزامات
        </span>
      </div>
    </div>
  );
}
