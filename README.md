# MindTheLeak — اكتشف تسريباتك المالية

> كل التطبيقات تخبرك **ماذا** أنفقت. نحن نخبرك **لماذا لا تستطيع الادخار**.

AI financial-behavior analysis for the Saudi market: upload a bank statement CSV (no bank credentials, no open-banking consent) and get a causal, quantified diagnosis of your "money leaks" — in Arabic.

## Run it

```bash
cd app
npm install
npm run dev          # http://localhost:3000
```

- **Live pitch shortcut:** open `http://localhost:3000/?demo=1` — loads the bundled demo dataset straight into the dashboard (add `&static=1` to skip animations, e.g. for screenshots or a flaky projector).
- **AI narrative (optional):** set `ANTHROPIC_API_KEY` in `app/.env.local` to have Claude (claude-opus-4-8) classify unknown merchants and write the behavioral report. **Without a key the app still fully works** — the engine is deterministic and the narrative falls back to a template built from the same numbers. The demo never depends on Wi-Fi.

## What's real (not mocked)

| Layer | How it works |
|---|---|
| CSV parsing | `app/lib/parse.ts` — Saudi bank export quirks: Arabic-Indic digits, RTL marks, debit/credit or signed amounts, DD/MM/YYYY, merchant-string cleanup |
| Classification | `app/lib/classify.ts` — rules first (salary/SADAD/ATM/fees/transfers + ~60 Saudi merchants); Claude handles the unknown tail with strict-enum structured output, batched, cached per merchant |
| Leak engine | `app/lib/detect.ts` — 7 research-backed detectors (thresholds + citations in `docs/RESEARCH.md`). Every transaction attributed to at most ONE leak — the headline total never double-counts a riyal |
| Narrative | `app/lib/ai.ts` — Claude writes the Arabic report under behavioral-economics framing rules (salience, annualization, mechanism explanation, no shaming, no social comparison) |
| Demo data | `app/scripts/gen-demo.ts` — deterministic (seeded) 3-month persona: 12,000 SAR salary on the 27th, installment + family transfer (thin savings margin), payday burst, late-night delivery habit, 5 forgotten subscriptions |
| Recovery plan | `app/lib/plan.ts` — leaks → ordered fixes with effort levels and honest recovery rates (instant 100%, automation 80%, rule 60%, habit 50%); live months-to-goal projection |
| Memory | localStorage: named goal, committed plan, last-analysis snapshot → delta banner on the next analysis ("تسريبك −18٪ منذ آخر تحليل") |

Self-checks: `node app/lib/parse.test.ts` and `node app/lib/detect.test.ts` (needs Node ≥ 22.18).

## The 7 detectors

1. **حرق ما بعد الراتب** (payday burn) — Gelman et al., *Science* 2014
2. **مشتريات ما بعد ١٠ مساءً** (late-night impulse)
3. **اشتراكات متكررة** (forgotten subscriptions) — Plaid thresholds; C+R Research
4. **اشتراكات متداخلة** (zombie/duplicate subscriptions) — Einav et al., *AER* 2025
5. **عادة التوصيل** (delivery streak, counterfactual: cap at 2/week)
6. **نزيف المبالغ الصغيرة** (micro-leak, annualized)
7. **رسوم بنكية** (fees)

## Pitch script (3 minutes)

**[0:00–0:25] The problem** — "سارة تكسب ١٢ ألف ريال شهرياً، تعرف بالضبط أين ذهب كل ريال… ومع ذلك لا تدخر شيئاً. ٤٥٪ من السعوديين مثلها لا يدخرون إطلاقاً، ومعدل الادخار ١٫٦٪ مقابل مستهدف رؤية 2030: ١٠٪. تطبيقات المصاريف تجيب على سؤال «ماذا أنفقت؟» — لكن أحداً لا يجيب على «لماذا لا أستطيع الادخار؟»"

**[0:25–0:45] The solution** — "MindTheLeak يحلل كشف حسابك — بدون أي بيانات دخول بنكية — ويشخّص سلوكك: متى تنفق باندفاع، وما الذي يحفّزك، وكم يكلفك ذلك بالريال."

**[0:45–2:25] Live demo** — start from the landing (not `?demo=1`) to show the goal step:
1. Goal step: "أول سؤال نسأله: ما الذي تدخر له؟ — عمرة عائلية. من هنا كل شيء يُقاس بهدفها هي" (named goal doubles insight effectiveness — Karlan, *Management Science*)
2. Staged analysis plays → gauge counts up + headline: "٣٩٪ من إنفاقها في أول ٥ أيام بعد الراتب — ومعظم قراراتها المتهورة بعد ١٠ مساءً"
3. Payday curve: "الانفجار يوم ٢٧ — «تأثير يوم الراتب» موثّق في مجلة Science: +٧٠٪ إنفاق يوم وصول الراتب، ويحدث حتى للأغنياء"
4. Heatmap: "ومتى تحدث القرارات المتهورة؟ الخميس ليلاً — النقطة الساخنة"
5. Leak cards — click one open: "٧ تسريبات، كل ريال محسوب مرة واحدة، وكل رقم تقدر تفتحه وتشوف المعاملات خلفه" (checkable = credibility)
6. **The closer — interactive plan:** "أي كوب نملأ أولاً؟ بإيقاعها الحالي تصل للعمرة بعد ١٣ شهراً. فعّلنا الخطة —" *(toggle fixes live, the projection line jumps)* "— ٦ أشهر. والأرقام واقعية: نحسب نسبة نجاح لكل نوع إصلاح، الإلغاء الفوري ١٠٠٪ لكن تغيير العادة ٥٠٪ فقط. ثم تعتمد الخطة، وتحليلها القادم يُقارن بها — التطبيق يتذكر ويتابع."

**[2:15–2:40] What's real** — "كل ما رأيتموه محرك حقيقي يعمل بدون إنترنت. Claude يصنّف التجار غير المعروفين ويكتب التقرير — والعتبات كلها من أبحاث محكّمة."

**[2:40–3:00] Market + close** — "Malaa وDrahim يتطلبان ربط حسابك البنكي ويعرضان لوحات أرقام. نحن نبدأ من ملف CSV ونبيع الوعي، لا الآلة الحاسبة. غداً: ربط مباشر عبر المصرفية المفتوحة — أطر SAMA جاهزة والمرخصون موجودون. كل التطبيقات تخبرك ماذا أنفقت — نحن نخبرك لماذا لا تستطيع الادخار."

**Q&A ammunition:** see `docs/RESEARCH.md` (killer answers for "isn't this just Mint?", "what if AI is wrong?", privacy, data-source).

## Structure

```
MindTheLeak.pptx      — pitch deck (Arabic)
docs/RESEARCH.md      — research digest: science, stats, competitors, strategy
app/                  — Next.js 16 app (RTL Arabic, Tailwind, Recharts, Anthropic SDK)
shots/                — screenshots
```
