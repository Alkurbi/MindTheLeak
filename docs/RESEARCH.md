# MindTheLeak — Research Digest (2026-07-11)

Distilled from three research sweeps: hackathon strategy, behavioral-finance science, Saudi fintech context. Use this for the pitch, the Q&A, and as the source of truth for detector thresholds.

## The pitch spine (fully sourced)

> "Saudis save 1.6% of income against a 10% Vision 2030 target; 45% save nothing; POS spending jumps ~37% the week salaries land and collapses before payday — and the science says the fix isn't willpower, it's visibility: transaction feedback cuts discretionary spending 11.6% and bank fees 38%."

- Savings rate 1.6% (2018), lowest tier in G20; Vision 2030 FSDP target 10% — KPMG, *Analysis of Household Savings in Saudi Arabia*, 2020.
- 45% of Saudis save nothing; 83% no long-term plan — SEDCO Riyali / Souqalmal 2018, n=2,000.
- 2007–2018 household consumption +38.6% vs income +5.3% — KPMG 2020.
- SAMA weekly POS +30–37% in the salary week after the 27th — Argaam/SAMA weekly bulletins.
- Feedback works: PFM adoption → discretionary spending −11.6% (~$430/mo), persistent 12 months (Levi & Benartzi, JFQA); NSF fees −38.4% in 24 months (Carlin, Olafsson & Pagel, *Rev. Finance* 2023); savings reminders +6%, doubled when tied to a named goal (Karlan et al., *Mgmt Science* 2016).

## Detector thresholds (implemented in `app/lib/detect.ts`)

| Detector | Threshold | Science |
|---|---|---|
| Payday burn | Day 0–4 after salary; flag if day-0 > 1.5× daily median or >30% of monthly discretionary in first 5 days. Exclude bills (≈40% of the spike is timed bills). | Gelman et al., *Science* 2014 (+70% on arrival day, elevated ≥4 days); Olafsson & Pagel, *RFS* 2018 (persists even with high liquidity) |
| Pre-payday crunch | Last 7 days of cycle < 60% of first 7 | Huffman & Barenstein, IZA DP 1430 (−18% final week; present bias, not illiquidity) |
| Late-night impulse | Discretionary 00:00–04:00 hard flag, 22:00–24:00 soft; ≥3/month | eachnight n=1,011 (23% remorse, 31% forgot buying); Slickdeals/OnePoll 2022 |
| Forgotten subscription | Same merchant + amount ±5%, ≥3 occurrences, median gap 28–31 days | Plaid published thresholds; C+R Research 2022 ($86 believed vs $219 actual; 42% pay for forgotten subs) |
| Zombie subscription | Recurring ≥6 mo + same-category duplicate | Einav, Klopack & Mahoney, *AER* 2025: forced decisions quadruple cancellation; friction ≈ doubles seller revenue |
| Micro-leak | Discretionary < SAR 100, >15/mo or >5% of income; annualize | Capital One Shopping (~$254/mo impulse); Gourville pennies-a-day in reverse |
| Delivery streak | ≥4 delivery orders / rolling 7 days | Cleo's productized pattern; SAMA: restaurants/cafés top-3 POS category |
| Fee leak | Regex bank/NSF/FX/late fees | Definitionally waste; Carlin et al. 2023 −38.4% with feedback |

## Insight-framing rules (for the Arabic narrative)

1. **Salience beats valence** — the user's own concrete numbers, not loss/gain wording (Karlan RCT: no framing difference).
2. **Tie to a named goal** — doubles effectiveness ("this = 4 months' delay on your Umrah fund").
3. **Annualize small leaks** — "SAR 23/week = SAR 1,196/yr"; never "only 3 SAR/day".
4. **Playful specificity, no moralizing** — "4th HungerStation this week, 2:07 a.m." not "you waste money".
5. **Explain the mechanism** — "that's the payday effect; it happens to the richest decile too" (normalizes, reduces defensiveness).
6. **No social comparison** — documented backfires (Schultz 2007 boomerang; Beshears, *J. Finance* 2015).

## Hackathon strategy

- Judges' typical weights: innovation 20–30%, impact 20–25%, working prototype 20–25%, feasibility 10–20%, presentation 10–20%. Saudi events (e.g., SAB Hackathon) explicitly score **Saudi Market Fit** — mention Vision 2030 savings target + SAMA open banking.
- 3–5 min pitch: 20–30s problem hook → 20s solution one-liner → **90–120s live demo** → 30s what's real → 20s market/regulatory → 15s team.
- Engineer ONE wow moment in the first minute: the causal, checkable insight ("62% of your leakage is Thursday nights after 10pm — skip 2 of 7 weekly deliveries → +410 SAR/mo").
- Demo discipline: pre-loaded data, cached AI fallback, never mock the core engine, one polished flow only.
- Killer Q&A answers ready:
  - *"Isn't this just Mint/Malaa?"* → They do categorization dashboards; we do causal behavioral diagnosis + quantified counterfactuals. Also: statement upload = zero bank credentials (Malaa/Drahim require open-banking consent up front). Mint shut down Jan 2024 — that's market validation.
  - *"Won't users hate being judged?"* → Framing is empowerment: one specific change, mechanism explained, no shame. Cleo proved the engagement model ($60M+ ARR).
  - *"Where does data come from?"* → Today: statement upload, zero credentials. Tomorrow: SAMA open banking via licensed aggregators (Lean was first fully licensed; Tarabut live). Rails already processing 180M+ API calls/yr.
  - *"What if the AI is wrong?"* → Rules classify the deterministic half (salary, SADAD, ATM, fees); AI handles the messy POS tail with confidence scores; low-confidence routes to "needs review", never guessed.

## Competitor gap

| | Tracking | Behavioral "why" | Arabic | No bank-link needed |
|---|---|---|---|---|
| Malaa (KSA) | ✅ | ❌ | ✅ | ❌ |
| Drahim (KSA) | ✅ | ❌ | ✅ | ❌ |
| Cleo (US/UK) | ✅ | ✅ | ❌ | ❌ |
| Emma (UK) | ✅ | subs only | ❌ | ❌ |
| **MindTheLeak** | ✅ | ✅ | ✅ | ✅ |

## Honest gaps (if asked)

- No published Saudi-specific subscription-waste stat (nearest: UAE, 18% hold 3+ unused subs, YouGov 2024).
- No academic precedent for per-transaction impulse classification — we're research-inspired (Tovanich, *EPJ Data Science* 2021; Gladstone, Matz & Lemaire, *Psych. Science* 2019), first-of-its-kind productization.
