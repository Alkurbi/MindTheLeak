import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseStatementCsv, cleanMerchant } from "@/lib/parse.ts";
import { classifyByRules, type Category } from "@/lib/classify.ts";
import { runEngine } from "@/lib/detect.ts";
import { buildResilience } from "@/lib/resilience.ts";
import { classifyMerchants, generateNarrative } from "@/lib/ai.ts";
import type { AnalysisResult, ClassifiedTransaction } from "@/lib/types.ts";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  let csv: string | undefined = body.csv;
  if (body.demo) {
    csv = await readFile(join(process.cwd(), "public", "demo.csv"), "utf8");
  }
  if (!csv) {
    return Response.json({ error: "لم يصل ملف" }, { status: 400 });
  }

  const { transactions, errors } = parseStatementCsv(csv);
  if (transactions.length < 10) {
    return Response.json(
      { error: "الملف لا يحتوي معاملات كافية للتحليل (١٠ على الأقل)", details: errors.slice(0, 5) },
      { status: 400 }
    );
  }

  // rules first; Claude handles the unknown-merchant tail
  const classified: ClassifiedTransaction[] = [];
  const pending: (typeof transactions)[number][] = [];
  for (const t of transactions) {
    const c = classifyByRules(t);
    if (c) classified.push(c);
    else pending.push(t);
  }

  if (pending.length) {
    const merchants = pending.map((t) => cleanMerchant(t.description) || t.description);
    const resolved = await classifyMerchants(merchants);
    pending.forEach((t, i) => {
      const r = resolved.get(merchants[i]) ?? { category: "other" as Category, confidence: 0 };
      classified.push({
        ...t,
        merchant: merchants[i],
        category: r.category,
        confidence: r.confidence,
        class: t.amount < 0 ? "income" : "planned",
      });
    });
  }

  classified.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
  const engine = runEngine(classified);
  // narrative references the same model the dashboard will show: the client's
  // persisted savings/shield/goals when sent, statement defaults otherwise
  const resilience = buildResilience(engine.transactions, {
    ...(typeof body.savingsSar === "number" && body.savingsSar >= 0
      ? { savingsSar: body.savingsSar }
      : {}),
    ...(typeof body.shieldMonths === "number" ? { shieldMonths: body.shieldMonths } : {}),
    ...(Array.isArray(body.goals) ? { goals: body.goals } : {}),
  });
  const narrative = await generateNarrative(
    engine.stats,
    engine.leaks,
    engine.monthlyLeakSar,
    engine.leakScore,
    body.goal, // {label, icon, targetSar} from the onboarding step
    resilience
  );

  const result: AnalysisResult & { stats: typeof engine.stats } = {
    transactions: engine.transactions,
    leaks: engine.leaks,
    leakScore: engine.leakScore,
    monthlyIncomeSar: engine.monthlyIncomeSar,
    monthlyLeakSar: engine.monthlyLeakSar,
    stats: engine.stats,
    ...narrative,
  };
  return Response.json(result);
}
