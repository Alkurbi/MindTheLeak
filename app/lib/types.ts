// Core domain model shared by the analysis engine, AI layer, and UI.

export type Transaction = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  time?: string; // HH:mm when the bank export has it
  description: string; // raw merchant/description text (Arabic, English, or mixed)
  amount: number; // positive = money out (debit), negative = money in (credit)
  balance?: number;
};

export type SpendClass = "planned" | "impulsive" | "recurring_leak" | "income";

export type ClassifiedTransaction = Transaction & {
  class: SpendClass;
  category: string; // normalized category key, e.g. "food_delivery"
  merchant: string; // cleaned merchant name
  confidence: number; // 0..1
};

export type Leak = {
  kind: string; // detector id, e.g. "payday_spike", "late_night", "forgotten_subscription"
  titleAr: string;
  detailAr: string;
  monthlyCostSar: number; // estimated SAR leaked per month
  transactions: string[]; // transaction ids backing this leak
  severity: "high" | "medium" | "low";
};

export type AnalysisResult = {
  transactions: ClassifiedTransaction[];
  leaks: Leak[];
  leakScore: number; // 0..100, higher = leakier
  monthlyIncomeSar: number;
  monthlyLeakSar: number; // total estimated leak per month
  narrativeAr: string; // Claude-written behavioral report in Arabic
  headlineInsightAr: string; // the one-liner for the top of the dashboard
  tipsAr: string[]; // 3 concrete, quantified actions
  aiPowered: boolean; // false when running on the template fallback (no API key)
};
