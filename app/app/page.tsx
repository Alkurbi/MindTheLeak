"use client";

import { useEffect, useRef, useState } from "react";
import Dashboard, { type Result } from "./dashboard.tsx";
import { GOAL_PRESETS, loadGoals, saveGoals, loadShieldMonths, type Goal } from "@/lib/plan.ts";
import type { GoalInput } from "@/lib/resilience.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STEPS = [
  "قراءة كشف الحساب وتطبيع البيانات",
  "تصنيف المعاملات — قواعد ثم ذكاء اصطناعي",
  "كشف الأنماط السلوكية السبعة",
  "كتابة تقريرك الشخصي",
];

export default function Home() {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ demo?: boolean; csv?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function analyze(body: { demo?: boolean; csv?: string }, goal: Goal | null) {
    setPending(null);
    setLoading(true);
    setError(null);
    try {
      // the persisted resilience model rides along so the narrative matches the
      // dashboard the user will actually see (edited savings, shield, goals)
      const savedSavings = Number(localStorage.getItem("mtl_savings"));
      const work = fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          goal: goal ?? undefined, // primary goal keeps the single-goal prompt hook
          goals: loadGoals(),
          shieldMonths: loadShieldMonths(),
          ...(Number.isFinite(savedSavings) && localStorage.getItem("mtl_savings") !== null
            ? { savingsSar: savedSavings }
            : {}),
        }),
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "خطأ غير متوقع");
        return data as Result;
      });
      // let the staged progress play out — the reveal deserves a beat
      // (skipped for headless automation so screenshots capture the final state)
      const beat = navigator.webdriver ? 0 : 3400;
      const [data] = await Promise.all([work, sleep(beat)]);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }

  async function onFile(file: File) {
    setPending({ csv: await file.text() });
  }

  // ?demo=1 → straight to the dashboard (handy for the live pitch)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo"))
      analyze({ demo: true }, loadGoals()[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (result) return <Dashboard result={result} onReset={() => setResult(null)} />;

  if (pending && !loading)
    return (
      <GoalStep
        onConfirm={(goals) => {
          if (goals) saveGoals(goals);
          analyze(pending, goals?.[0] ?? null);
        }}
      />
    );

  if (loading)
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-4xl font-bold text-teal mb-8 fade-up">MindTheLeak</h1>
        <LoadingStages />
      </main>
    );

  return (
    <main className="flex-1 flex flex-col">
      {/* hero: thesis right, living metaphor left */}
      <section className="flex-1 grid lg:grid-cols-2 items-center gap-12 max-w-6xl mx-auto w-full px-6 pt-14 pb-10">
        <div className="text-center lg:text-right">
          <h1 className="text-5xl md:text-6xl font-bold text-teal mb-4 tracking-tight fade-up">
            MindTheLeak
          </h1>
          <p
            className="display text-3xl md:text-4xl font-bold leading-snug mb-4 fade-up"
            style={{ animationDelay: "0.1s" }}
          >
            دخلك هو الصنبور —<br />
            والتسريبات تقرر أي كوب يمتلئ أولاً
          </p>
          <p className="text-muted text-lg mb-8 fade-up" style={{ animationDelay: "0.2s" }}>
            كل التطبيقات تخبرك <b className="text-fg">ماذا</b> أنفقت. نحن نخبرك{" "}
            <b className="text-teal">لماذا لا تستطيع الادخار</b> — وكيف تسترد المبلغ.
          </p>

          <div
            className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start fade-up"
            style={{ animationDelay: "0.3s" }}
          >
            <button
              onClick={() => setPending({ demo: true })}
              className="display bg-teal text-navy font-bold px-8 py-4 rounded-xl text-lg hover:opacity-90 hover:scale-[1.02] transition"
            >
              جرّب ببيانات تجريبية
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="display border border-teal text-teal font-bold px-8 py-4 rounded-xl text-lg hover:bg-navy-card transition"
            >
              ارفع كشف حسابك (CSV)
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </div>

          {error && <p className="text-danger mt-5">{error}</p>}

          <p className="text-muted text-sm mt-5 mb-10 fade-up" style={{ animationDelay: "0.4s" }}>
            🔒 لا نطلب بيانات دخول بنكية — ملفك يُحلَّل ولا يُخزَّن
          </p>

          {/* the problem, in three numbers */}
          <div
            className="flex justify-center lg:justify-start gap-10 fade-up"
            style={{ animationDelay: "0.5s" }}
          >
            {[
              { n: "١٫٦٪", label: "معدل ادخار الأسر السعودية", sub: "المستهدف: ١٠٪" },
              { n: "٤٥٪", label: "لا يدخرون شيئاً", sub: "من دخلهم الشهري" },
              { n: "+٣٧٪", label: "قفزة الإنفاق", sub: "في أسبوع الراتب" },
            ].map((s) => (
              <div key={s.label} className="text-center lg:text-right">
                <div className="display text-3xl font-bold text-danger leading-none mb-1">{s.n}</div>
                <div className="text-fg text-xs">{s.label}</div>
                <div className="text-muted text-xs">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="fade-up" style={{ animationDelay: "0.25s" }}>
          <TapAndCups />
        </div>
      </section>

      {/* how it works — the same ٠١٠٢٠٣ language as the dashboard */}
      <section className="border-t border-navy-soft/60">
        <div className="max-w-6xl mx-auto px-6 py-10 grid sm:grid-cols-3 gap-8">
          {[
            { n: "٠١", t: "ارفع كشف حسابك", d: "ملف CSV من تطبيق بنكك — بدون أي بيانات دخول" },
            { n: "٠٢", t: "نشخّص سلوكك", d: "٧ كواشف تسريب مبنية على أبحاث محكّمة، وذكاء اصطناعي يقرأ ما بين المعاملات" },
            { n: "٠٣", t: "تستلم خطتك", d: "مرتبطة بهدفك أنت، بأرقام استرداد واقعية — ونتابع تقدمك مع كل كشف جديد" },
          ].map((s) => (
            <div key={s.n} className="flex gap-4 items-start">
              <span className="display text-4xl font-bold text-teal/35 leading-none select-none">{s.n}</span>
              <div>
                <h3 className="font-bold mb-1">{s.t}</h3>
                <p className="text-muted text-sm leading-relaxed">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

// The deck's metaphor, alive: the tap drips, every cup has a rolling surface,
// and the leak cup is visibly winning the race.
function TapAndCups() {
  const cups = [
    { cx: 18, level: 0.62, color: "#3d5a80", label: "الالتزامات" },
    { cx: 138, level: 0.86, color: "var(--danger)", label: "التسريبات" },
    { cx: 258, level: 0.08, color: "var(--teal)", label: "الادخار" },
  ];
  const top = 172;
  const height = 118;
  // 80px-period wave with ≥80px overhang on both sides (loop shifts -80px)
  const wave = (cx: number, y: number) =>
    `M${cx - 160} ${y} q20 -7 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V310 H${cx - 160} Z`;

  return (
    <svg viewBox="0 0 360 312" className="w-full max-w-xl mx-auto" aria-hidden>
      <defs>
        {cups.map((c, i) => (
          <clipPath key={i} id={`cup-${i}`}>
            <path d={`M ${c.cx} ${top} h 84 l -10 ${height} h -64 z`} />
          </clipPath>
        ))}
      </defs>

      {/* faucet above the leak cup */}
      <rect x="152" y="10" width="56" height="16" rx="5" fill="var(--navy-card)" stroke="var(--teal)" strokeWidth="1.5" />
      <rect x="170" y="26" width="20" height="34" rx="4" fill="var(--navy-card)" stroke="var(--teal)" strokeWidth="1.5" />
      <rect x="160" y="58" width="40" height="12" rx="5" fill="var(--navy-card)" stroke="var(--teal)" strokeWidth="1.5" />
      {/* drops */}
      <circle cx="180" cy="82" r="5.5" fill="var(--teal)" className="drip" />
      <circle cx="180" cy="82" r="5.5" fill="var(--teal)" className="drip" style={{ animationDelay: "0.55s" }} />
      <circle cx="180" cy="82" r="5.5" fill="var(--teal)" className="drip" style={{ animationDelay: "1.1s" }} />

      {cups.map((c, i) => {
        const wy = top + (1 - c.level) * height;
        return (
          <g key={c.label}>
            <g clipPath={`url(#cup-${i})`}>
              <path d={wave(c.cx, wy)} fill={c.color} opacity="0.3" className="wave-b" />
              <path d={wave(c.cx, wy + 3)} fill={c.color} opacity="0.8" className="wave-a" />
            </g>
            <path
              d={`M ${c.cx} ${top} h 84 l -10 ${height} h -64 z`}
              fill="none"
              stroke="var(--muted)"
              strokeOpacity="0.7"
              strokeWidth="2"
            />
            <text x={c.cx + 42} y="308" textAnchor="middle" fill="var(--muted)" fontSize="14">
              {c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// The single strongest evidence-backed lever: a named goal doubles the
// effectiveness of every insight (Karlan et al., Management Science 2016).
// Multiple goals, each with a share of monthly savings — the emergency shield
// is added automatically as goal #1 and isn't chosen here.
function GoalStep({ onConfirm }: { onConfirm: (goals: GoalInput[] | null) => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set([0]));
  const [shares, setShares] = useState<GoalInput[] | null>(null); // null = still picking

  // equal integer split summing to exactly 100
  function toShares(goals: Goal[]): GoalInput[] {
    const base = Math.floor(100 / goals.length);
    return goals.map((g, i) => ({ ...g, sharePct: i === 0 ? 100 - base * (goals.length - 1) : base }));
  }

  if (shares) {
    const sum = shares.reduce((s, g) => s + g.sharePct, 0);
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="max-w-xl w-full fade-up">
          <h2 className="text-3xl font-bold mb-2">كيف نقسم ادخارك بين أهدافك؟</h2>
          <p className="text-muted mb-8">
            درع الطوارئ يُبنى أولاً تلقائياً — هذه النسب تتقاسم ما بعده. عدّلها كما تريد.
          </p>
          <div className="space-y-3 mb-6 text-right">
            {shares.map((g, i) => (
              <div key={g.label} className="flex items-center gap-3 bg-navy-soft rounded-xl px-4 py-3">
                <span className="text-2xl">{g.icon}</span>
                <span className="font-bold flex-1">{g.label}</span>
                <input
                  type="number"
                  value={g.sharePct}
                  min={0}
                  max={100}
                  aria-label={`نسبة ${g.label}`}
                  onChange={(e) =>
                    setShares(shares.map((d, j) => (j === i ? { ...d, sharePct: Number(e.target.value) } : d)))
                  }
                  className="num bg-navy-card border border-navy-soft rounded-lg px-3 py-1.5 w-20 text-center font-bold focus:border-teal outline-none"
                />
                <span className="text-muted text-sm">٪</span>
              </div>
            ))}
          </div>
          <p className={`text-sm font-bold num mb-6 ${sum === 100 ? "text-teal" : "text-danger"}`}>
            المجموع: {sum}٪ {sum !== 100 && "— يجب أن يساوي ١٠٠٪"}
          </p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={() => onConfirm(shares)}
              disabled={sum !== 100}
              className="bg-teal text-navy font-bold px-10 py-4 rounded-xl text-lg hover:opacity-90 transition disabled:opacity-40"
            >
              ابدأ التحليل
            </button>
            <button onClick={() => setShares(null)} className="text-muted px-6 py-4 hover:text-fg transition">
              رجوع
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="max-w-xl w-full fade-up">
        <h2 className="text-3xl font-bold mb-2">قبل أن نحلل — ما الذي تدخر له؟</h2>
        <p className="text-muted mb-8">
          اختر هدفاً أو أكثر — سنربط كل تسريب بأهدافك أنت. الأبحاث تظهر أن الهدف المسمى يضاعف
          أثر أي نصيحة مالية. المبالغ قابلة للتعديل لاحقاً من لوحتك.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {GOAL_PRESETS.map((g, i) => (
            <button
              key={g.label}
              onClick={() =>
                setPicked((p) => {
                  const next = new Set(p);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
              className={`rounded-xl p-4 border transition text-center ${
                picked.has(i)
                  ? "border-teal bg-navy-card text-fg"
                  : "border-navy-card bg-navy-soft text-muted hover:border-muted"
              }`}
            >
              <div className="text-3xl mb-1">{g.icon}</div>
              <div className="text-sm font-bold">{g.label}</div>
              <div className="text-muted text-xs num">{g.targetSar.toLocaleString("en-US")} ر.س</div>
            </button>
          ))}
        </div>

        <div className="flex gap-4 justify-center">
          <button
            onClick={() => {
              const goals = GOAL_PRESETS.filter((_, i) => picked.has(i));
              const withShares = toShares(goals);
              if (goals.length <= 1) onConfirm(withShares); // nothing to split
              else setShares(withShares);
            }}
            disabled={picked.size === 0}
            className="bg-teal text-navy font-bold px-10 py-4 rounded-xl text-lg hover:opacity-90 transition disabled:opacity-40"
          >
            {picked.size > 1 ? "التالي — تقسيم النسب" : "ابدأ التحليل"}
          </button>
          <button
            onClick={() => onConfirm(null)}
            className="text-muted px-6 py-4 hover:text-fg transition"
          >
            تخطَّ
          </button>
        </div>
      </div>
    </main>
  );
}

function LoadingStages() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length)), 820);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="py-10 max-w-sm mx-auto text-right">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-3 mb-4 min-h-7">
          {i < step ? (
            <span className="pop-in bg-teal text-navy rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold shrink-0">
              ✓
            </span>
          ) : i === step ? (
            <span className="animate-spin border-2 border-teal border-t-transparent rounded-full w-6 h-6 shrink-0" />
          ) : (
            <span className="border border-muted/40 rounded-full w-6 h-6 shrink-0" />
          )}
          <span className={i <= step ? "" : "text-muted"}>{label}</span>
        </div>
      ))}
    </div>
  );
}
