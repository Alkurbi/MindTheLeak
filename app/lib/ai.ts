// Claude layer (server-only): merchant classification for the rules-engine tail,
// and the Arabic behavioral narrative. Falls back to deterministic templates when
// no API key is set or the call fails — the demo never depends on the network.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES, type Category } from "./classify.ts";
import type { Stats } from "./detect.ts";
import type { Leak } from "./types.ts";
import type { Goal } from "./plan.ts";
import type { ResilienceReport } from "./resilience.ts";

// the resilience model, compacted for the prompt and the template fallback
function resilienceSummary(r: ResilienceReport) {
  return {
    floorSar: Math.round(r.floorSar),
    savingsSar: Math.round(r.savingsSar),
    runwayMonths: Number(r.runwayMonths.toFixed(1)),
    firstBreak: r.breakEvents[0]
      ? {
          labelAr: r.breakEvents[0].labelAr,
          date: r.breakEvents[0].date,
          dayOffset: r.breakEvents[0].dayOffset,
          consequenceAr: r.breakEvents[0].consequenceAr,
        }
      : null,
    shield: {
      months: r.shield.months,
      targetSar: Math.round(r.shield.targetSar),
      fundedPct: Math.round(r.shield.fundedPct),
    },
  };
}

const MODEL = "claude-opus-4-8";

function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

// ---------- merchant classification ----------

const MerchantBatch = z.object({
  results: z.array(
    z.object({
      merchant: z.string(), // echo back exactly — prevents index misalignment
      reasoning: z.string(), // in-schema chain of thought before the answer
      category: z.enum(CATEGORIES),
      confidence: z.number(),
    })
  ),
});

// module-level cache: classify each unique merchant once per server lifetime
const merchantCache = new Map<string, { category: Category; confidence: number }>();

export async function classifyMerchants(
  merchants: string[]
): Promise<Map<string, { category: Category; confidence: number }>> {
  const result = new Map<string, { category: Category; confidence: number }>();
  const unknown: string[] = [];
  for (const m of new Set(merchants)) {
    const hit = merchantCache.get(m);
    if (hit) result.set(m, hit);
    else unknown.push(m);
  }
  if (!unknown.length) return result;

  const anthropic = client();
  if (!anthropic) {
    unknown.forEach((m) => result.set(m, { category: "other", confidence: 0 }));
    return result;
  }

  const BATCH = 40;
  for (let i = 0; i < unknown.length; i += BATCH) {
    const batch = unknown.slice(i, i + BATCH);
    try {
      const response = await anthropic.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system:
          "You classify merchant names from Saudi bank statements into spending categories. " +
          "Merchants may be Arabic, English, or transliterated Arabic (e.g. MTAAM = مطعم = restaurant, SHRKT = شركة = company). " +
          "Echo each merchant string back EXACTLY as given. Think briefly in `reasoning` before choosing. " +
          "Use confidence < 0.5 when genuinely unsure — never guess confidently.",
        messages: [
          {
            role: "user",
            content: `Classify these merchants:\n${batch.map((m) => `- ${m}`).join("\n")}`,
          },
        ],
        output_config: { format: zodOutputFormat(MerchantBatch) },
      });
      for (const r of response.parsed_output?.results ?? []) {
        const entry = { category: r.category, confidence: r.confidence };
        merchantCache.set(r.merchant, entry);
        result.set(r.merchant, entry);
      }
    } catch {
      // network/API failure: degrade gracefully, never block the demo
    }
    batch.forEach((m) => {
      if (!result.has(m)) result.set(m, { category: "other", confidence: 0 });
    });
  }
  return result;
}

// ---------- Arabic behavioral narrative ----------

const Narrative = z.object({
  headlineInsightAr: z.string(),
  narrativeAr: z.string(),
  tipsAr: z.array(z.string()),
});

const FRAMING_RULES = `أنت محلل سلوك مالي يكتب تقريراً شخصياً بالعربية. قواعد الكتابة (مبنية على أبحاث الاقتصاد السلوكي):
1. الأرقام الملموسة الشخصية هي كل شيء — لا عموميات أبداً.
2. حوّل التسريبات الصغيرة إلى أرقام سنوية ("٢٣ ر.س أسبوعياً = ١١٩٦ ر.س سنوياً"). لا تقل أبداً "فقط X ريال يومياً".
3. دقة مرحة بلا وعظ: "رابع طلب هذا الأسبوع، الساعة ٢:٠٧ فجراً" وليس "أنت مسرف".
4. اشرح الآلية النفسية ليفهم القارئ أن السلوك طبيعي وموثق: "هذا تأثير يوم الراتب — يحدث حتى لأصحاب الدخول المرتفعة".
5. لا مقارنات اجتماعية إطلاقاً ("الناس مثلك ينفقون...") — الأبحاث تثبت أنها تأتي بنتائج عكسية.
6. كل نصيحة يجب أن تكون: فعلاً واحداً محدداً + رقم توفير محدد شهرياً أو سنوياً.
7. الهدف تمكين القارئ، لا إشعاره بالذنب. اختم بما يكسبه، لا بما يخسره.

المطلوب:
- headlineInsightAr: جملة واحدة صادمة ومحددة — أقوى نمط سببي في البيانات (وقت + سلوك + رقم). هذه الجملة هي "لحظة الوعي" الرئيسية.
- narrativeAr: تقرير من ٣ فقرات قصيرة: (١) النمط الأبرز وآليته النفسية، (٢) التسريبات الأخرى بالأرقام، (٣) الصورة الكبيرة: ماذا يعني استرداد هذا المبلغ سنوياً بشكل ملموس (رحلة عمرة، قسط سيارة، صندوق طوارئ).
- tipsAr: ٣ أفعال محددة مرتبة بالأثر، كل واحد بصيغة "افعل X → توفر Y ر.س شهرياً".`;

export async function generateNarrative(
  stats: Stats,
  leaks: Leak[],
  monthlyLeakSar: number,
  leakScore: number,
  goal?: Goal,
  resilience?: ResilienceReport
): Promise<{ headlineInsightAr: string; narrativeAr: string; tipsAr: string[]; aiPowered: boolean }> {
  const summary = resilience ? resilienceSummary(resilience) : undefined;
  const anthropic = client();
  if (anthropic) {
    try {
      const goalLine = goal
        ? `\n\nهدف المستخدم المعلن: «${goal.label}» بمبلغ ${goal.targetSar} ر.س. اربط كل تسريب وكل نصيحة بهذا الهدف تحديداً (الأبحاث: ربط التذكير بهدف مسمى يضاعف فعاليته) — مثلاً "هذا التسريب وحده يؤخر ${goal.label} بـ N أشهر".`
        : "";
      const resilienceLine = summary
        ? `\n\nنموذج الصمود المحسوب من كشف المستخدم (resilience): أرضية بقائه ${summary.floorSar} ر.س شهرياً، وسيولته تغطي ${summary.runwayMonths} شهر لو انقطع دخله اليوم${summary.firstBreak ? `، وأول ما ينكسر: ${summary.firstBreak.labelAr} بعد ${summary.firstBreak.dayOffset} يوماً` : ""}. درع الطوارئ (${summary.shield.months} أشهر من أرضيته) مموّل ${summary.shield.fundedPct}٪. اربط التقرير بهذه الأرقام: افتح بمدة الأمان، وقدّم كل تسريب مسترد كأيام أمان إضافية تُشترى.`
        : "";
      const response = await anthropic.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: FRAMING_RULES + goalLine + resilienceLine,
        messages: [
          {
            role: "user",
            content:
              `بيانات التحليل (${stats.months} شهر من المعاملات):\n` +
              JSON.stringify({ stats, leaks: leaks.map(({ kind, titleAr, detailAr, monthlyCostSar, severity }) => ({ kind, titleAr, detailAr, monthlyCostSar: Math.round(monthlyCostSar), severity })), monthlyLeakSar: Math.round(monthlyLeakSar), leakScore, goal, resilience: summary }, null, 1),
          },
        ],
        output_config: { format: zodOutputFormat(Narrative) },
      });
      const p = response.parsed_output;
      if (p) return { ...p, aiPowered: true };
    } catch {
      // fall through to template
    }
  }
  return { ...templateNarrative(stats, leaks, monthlyLeakSar, goal, summary), aiPowered: false };
}

// Deterministic fallback — built from the same engine numbers, so the demo
// works offline and the "wow" line is always available.
function templateNarrative(
  stats: Stats,
  leaks: Leak[],
  monthlyLeakSar: number,
  goal?: Goal,
  resilience?: ReturnType<typeof resilienceSummary>
) {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const top = leaks[0];
  const resilienceParagraph = resilience
    ? `لو انقطع دخلك اليوم، سيولتك (${fmt(resilience.savingsSar)} ر.س) تغطي أرضية بقائك (${fmt(
        resilience.floorSar
      )} ر.س شهرياً) لمدة ${resilience.runwayMonths} شهر فقط${
        resilience.firstBreak
          ? ` — وأول ما ينكسر: ${resilience.firstBreak.labelAr} بعد ${resilience.firstBreak.dayOffset} يوماً`
          : ""
      }. درع الطوارئ المستهدف (${resilience.shield.months} أشهر من أرضيتك = ${fmt(
        resilience.shield.targetSar
      )} ر.س) مموّل ${resilience.shield.fundedPct}٪ — وكل تسريب تسترده أدناه يشتري أياماً إضافية من هذا الأمان.`
    : null;
  const goalSentence =
    goal && monthlyLeakSar > 0
      ? ` هدفك «${goal.label}» (${fmt(goal.targetSar)} ر.س) يبتعد عنك كل شهر بهذا المقدار — استرداد التسريب وحده يوصلك إليه خلال ${Math.ceil(goal.targetSar / monthlyLeakSar)} شهراً.`
      : "";

  const headlineInsightAr =
    stats.paydayWindowSharePct >= 30 && stats.lateNightCountPerMonth >= 3
      ? `${stats.paydayWindowSharePct}٪ من إنفاقك يحدث في أول ٥ أيام بعد الراتب — ومعظم قراراتك المتهورة تُتخذ بعد الساعة ١٠ مساءً (${Math.round(stats.lateNightCountPerMonth)} عملية شهرياً).`
      : top
      ? top.detailAr
      : "إنفاقك منضبط نسبياً — لكن التفاصيل أدناه تستحق نظرة.";

  const narrativeAr = [
    ...(resilienceParagraph ? [resilienceParagraph] : []),
    `أنت لا تعاني من مشكلة دخل — دخلك ${fmt(stats.monthlyIncomeSar)} ر.س شهرياً. المشكلة في ${fmt(
      monthlyLeakSar
    )} ر.س تتسرب كل شهر عبر أنماط سلوكية لا تلاحظها: ${leaks
      .slice(0, 3)
      .map((l) => l.titleAr)
      .join("، ")}. هذه الأنماط موثقة علمياً وتحدث للجميع — الفرق أنك الآن تراها.`,
    leaks
      .slice(0, 3)
      .map((l) => l.detailAr)
      .join(" "),
    `المجموع: ${fmt(monthlyLeakSar * 12)} ر.س سنوياً قابلة للاسترداد.${goalSentence} الأبحاث تظهر أن مجرد رؤية هذه الأرقام يخفض الإنفاق الاستهلاكي بنسبة ١١٪ خلال سنة.`,
  ].join("\n\n");

  const tipsAr = leaks
    .filter((l) => l.monthlyCostSar > 0)
    .slice(0, 3)
    .map((l) => {
      const save = fmt(l.monthlyCostSar);
      switch (l.kind) {
        case "late_night":
          return `أخّر أي شراء بعد ١٠ مساءً إلى صباح اليوم التالي (قاعدة الـ ١٢ ساعة) → توفر حتى ${save} ر.س شهرياً`;
        case "delivery_streak":
          return `حدد سقف التوصيل بطلبين أسبوعياً → توفر ${save} ر.س شهرياً`;
        case "forgotten_subscription":
          return `راجع اشتراكاتك اليوم وألغِ ما لم تستخدمه آخر ٣٠ يوماً → توفر حتى ${save} ر.س شهرياً`;
        case "payday_spike":
          return `حوّل مبلغ ادخارك تلقائياً يوم الراتب نفسه قبل أن تبدأ بالإنفاق → تحمي ${save} ر.س شهرياً`;
        case "micro_leak":
          return `اجمع مشترياتك الصغيرة في ميزانية أسبوعية واحدة مرئية → توفر حتى ${save} ر.س شهرياً`;
        default:
          return `عالج «${l.titleAr}» → توفر ${save} ر.س شهرياً`;
      }
    });

  return { headlineInsightAr, narrativeAr, tipsAr };
}
