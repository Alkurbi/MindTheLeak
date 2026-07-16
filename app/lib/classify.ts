// Rules-first classification: salary, SADAD, ATM, fees, transfers, and known
// Saudi merchants are deterministic. Unknown merchants go to Claude (ai.ts).

import type { Transaction, ClassifiedTransaction, SpendClass } from "./types.ts";
import { cleanMerchant } from "./parse.ts";

export const CATEGORIES = [
  "income",
  "groceries",
  "food_delivery",
  "restaurants_cafes",
  "coffee",
  "transport",
  "fuel",
  "telecom",
  "utilities_bills",
  "subscriptions_digital",
  "shopping",
  "electronics",
  "health",
  "education",
  "charity",
  "remittance",
  "government_fees",
  "insurance",
  "installments",
  "bank_fees",
  "cash_atm",
  "transfer",
  "entertainment",
  "rent",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_AR: Record<Category, string> = {
  income: "دخل",
  groceries: "تموينات",
  food_delivery: "توصيل طعام",
  restaurants_cafes: "مطاعم",
  coffee: "قهوة",
  transport: "مواصلات",
  fuel: "وقود",
  telecom: "اتصالات",
  utilities_bills: "فواتير",
  subscriptions_digital: "اشتراكات رقمية",
  shopping: "تسوق",
  electronics: "إلكترونيات",
  health: "صحة",
  education: "تعليم",
  charity: "تبرعات",
  remittance: "حوالات",
  government_fees: "رسوم حكومية",
  insurance: "تأمين",
  installments: "أقساط تمويل",
  bank_fees: "رسوم بنكية",
  cash_atm: "سحب نقدي",
  transfer: "تحويلات",
  entertainment: "ترفيه",
  rent: "إيجار",
  other: "أخرى",
};

// Categories that count as discretionary for the leak detectors.
export const DISCRETIONARY: ReadonlySet<Category> = new Set([
  "food_delivery",
  "restaurants_cafes",
  "coffee",
  "shopping",
  "electronics",
  "subscriptions_digital",
  "entertainment",
] satisfies Category[]);

// Known Saudi + global merchants (substring match on cleaned merchant).
// Third element = canonical merchant name, so "NETFLIX.COM Los Gatos" and
// "NETFLIX.COM Amsterdam" group as one recurring stream.
const KNOWN: [pattern: RegExp, category: Category, canonical?: string][] = [
  // delivery
  [/HUNGERSTATION|هنقرستيشن/, "food_delivery"],
  [/JAHEZ|جاهز/, "food_delivery"],
  [/TOYOU|تويو/, "food_delivery"],
  [/MRSOOL|مرسول/, "food_delivery"],
  [/CAREEM\s*(FOOD|NOW)/, "food_delivery"],
  [/KEETA/, "food_delivery"],
  // food
  [/ALBAIK|البيك/, "restaurants_cafes"],
  [/HERFY|هرفي/, "restaurants_cafes"],
  [/KUDU|كودو/, "restaurants_cafes"],
  [/MCDONALD|ماكدونالدز/, "restaurants_cafes"],
  [/SHAWARMER|شاورمر/, "restaurants_cafes"],
  [/STARBUCKS|ستاربكس/, "coffee"],
  [/COFFEE ADDRESS|COFFEE|كوفي/, "coffee"],
  [/MAMA NORA|ماما نورة/, "restaurants_cafes"],
  [/RESTAURANT|مطعم|MTAAM/, "restaurants_cafes"],
  [/ARAMCO|أرامكو/, "fuel"],
  [/BARNS?\b|بارنز/, "coffee"],
  [/DUNKIN|دانكن/, "coffee"],
  [/DOSE CAFE|دوز/, "coffee"],
  [/HALF MILLION|هاف مليون/, "coffee"],
  // groceries
  [/TAMIMI|التميمي/, "groceries"],
  [/PANDA|بنده/, "groceries"],
  [/DANUBE|الدانوب/, "groceries"],
  [/CARREFOUR|كارفور/, "groceries"],
  [/OTHAIM|العثيم/, "groceries"],
  [/LULU|لولو/, "groceries"],
  [/NANA|نعناع/, "groceries"],
  // transport / fuel
  [/CAREEM|كريم/, "transport"],
  [/UBER|أوبر/, "transport"],
  [/BOLT\b/, "transport"],
  [/ALDREES|الدريس|PETROMIN|بترومين|SASCO|ساسكو|NAFT|نفط/, "fuel"],
  // telecom
  [/\bSTC\b|سلام|MOBILY|موبايلي|ZAIN|زين|LEBARA|ليبارا|VIRGIN MOBILE/, "telecom"],
  // digital subscriptions
  [/NETFLIX|نتفلكس/, "subscriptions_digital", "NETFLIX"],
  [/SPOTIFY|سبوتيفاي/, "subscriptions_digital", "SPOTIFY"],
  [/SHAHID|شاهد/, "subscriptions_digital", "SHAHID"],
  [/OSN\b/, "subscriptions_digital", "OSN"],
  [/ANGHAMI|أنغامي/, "subscriptions_digital", "ANGHAMI"],
  [/APPLE\.?COM|ITUNES|APPLE SERVICES/, "subscriptions_digital", "APPLE.COM/BILL"],
  [/GOOGLE\s*(PLAY|ONE|YOUTUBE)|YOUTUBE PREMIUM/, "subscriptions_digital", "GOOGLE"],
  [/PLAYSTATION|PSN|XBOX|STEAM/, "subscriptions_digital"],
  [/AMAZON PRIME/, "subscriptions_digital", "AMAZON PRIME"],
  [/ICLOUD/, "subscriptions_digital", "ICLOUD"],
  [/CODASHOP/, "subscriptions_digital", "CODASHOP"],
  // shopping
  [/\bNOON\b|نون/, "shopping"],
  [/AMAZON|أمازون/, "shopping"],
  [/SHEIN|شي إن/, "shopping"],
  [/NAMSHI|نمشي/, "shopping"],
  [/ZARA|H&M|BERSHKA/, "shopping"],
  [/JARIR|جرير/, "electronics"],
  [/EXTRA\b|اكسترا/, "electronics"],
  [/SACO|ساكو/, "shopping"],
  [/IKEA|ايكيا/, "shopping"],
  // entertainment
  [/VOX CINEMA|AMC|MUVI|موفي|سينما/, "entertainment"],
  [/BOULEVARD|بوليفارد/, "entertainment"],

  // real-data tail: transliterated Saudi merchants baked from actual Al Rajhi
  // statements (was the Claude-classified 386). Broad patterns where safe so
  // next month's variants match too. ponytail: hand-classified once, not per-call.
  [/\bCAFE\b|كافيه|COFFEE/, "coffee"], // "JARAH ALDAFERI CAFE", "Taim cafe"
  [/BAKERY|\bBAKER\b|مخبز/, "restaurants_cafes"], // "AL HATAB BAKERY"
  [/MTAM|MATAM|MTAAM|BWFYH|BUFEH|بوفيه/, "restaurants_cafes"], // مطعم/بوفيه transliterations
  [/MKASHKASH|مكشكش/, "restaurants_cafes"],
  [/RAISING CANE|BURGER KING|برجر كنج|FAWAL|TARWIQAT|FAS FOO/, "restaurants_cafes"],
  // truncation-aware: Al Rajhi cuts merchant names to ~22 chars, so
  // "Restaurant"→"Restaura"/"Resta", "Market"→"MARKE", "Medical"→"MED C".
  [/\bREST\b|\bRESTA|GRILL|KEBAB|شواء|كباب/, "restaurants_cafes"], // "…Rest" = مطعم truncated
  [/MARKE|ماركت/, "groceries"], // "JUMEIRAH MARKETS", "...ALWAHAH MARKE"
  [/NAJMT ALSARY|نجمة الساري/, "groceries"],
  [/SALLA|سلة/, "shopping"], // Salla e-commerce platform
  [/TAMARA|تمارا|EMKAN|إمكان|TABBY|تابي/, "installments"], // BNPL — financing, not spend
  [/FAKEEH|فقيه|HOSPIT|MEDICAL|\bMED C\b/, "health"],
  [/RAILWAY|SAR TRAIN|قطار|SAPTCO|سابتكو/, "transport"],
];

function baseClass(category: Category, amount: number): SpendClass {
  if (amount < 0) return "income";
  return "planned"; // detectors upgrade to impulsive / recurring_leak
}

// Returns null when rules can't decide — those go to the AI layer.
export function classifyByRules(t: Transaction): ClassifiedTransaction | null {
  const d = t.description.toUpperCase();
  const merchant = cleanMerchant(t.description);

  const rule = (category: Category, canonical?: string): ClassifiedTransaction => ({
    ...t,
    category,
    merchant: canonical ?? (merchant || t.description),
    class: baseClass(category, t.amount),
    confidence: 1,
  });

  // credits: salary is income; transfers-in (own accounts, wallets) are NOT income
  if (t.amount < 0) {
    if (/راتب|SALARY|PAYROLL|WPS|أجر/.test(t.description)) return rule("income");
    if (/TRANSFER|تحويل|حوالة|TOACCT|BARQ|URPAY|STC ?PAY/i.test(d)) return rule("transfer");
    return rule("income"); // remaining credits (refunds etc.) — rare, acceptable
  }

  // credit-card dues / wallet top-ups are money movement, not consumption
  if (/ADVANCE PAYMENT|الئتمانية|الائتمانية|CREDIT CARD/i.test(d)) return rule("installments");
  if (/BARQ|URPAY|STC ?PAY.*(TOPUP|شحن)/i.test(d)) return rule("transfer");

  if (/SADAD|سداد/.test(d)) {
    if (/MOI|ABSHER|أبشر|وزارة|PASSPORT|جوازات|MUROOR|مرور/.test(d))
      return rule("government_fees");
    if (/KAHRABA|كهرباء|ELECTRICITY|WATER|مياه|NWC/.test(d))
      return rule("utilities_bills");
    return rule("utilities_bills");
  }
  if (/ATM|CASH WITHDRAWAL|سحب نقدي|صراف/.test(d)) return rule("cash_atm");
  // before installments: "قسط تأمين" is insurance, not financing
  if (/تأمين|INSURANCE|TAMEENI|TAMINI|TAWUNIYA|التعاونية|BUPA|بوبا|MEDGULF|ميدغلف|TAKAFUL|تكافل|WALAA|ولاء للتأمين|SALAMA INS/.test(d))
    return rule("insurance");
  if (/قسط|INSTALLMENT|تمويل|MURABAHA|مرابحة|TAWARRUQ|تورق/.test(d)) return rule("installments");
  if (/\b(FEE|FEES|CHARGE|COMMISSION)\b|رسوم|عمولة/.test(d)) return rule("bank_fees");
  // rent before generic transfers: "تحويل إيجار EJAR" is rent, not money movement
  if (/إيجار|RENT|EJAR|منصة إيجار/.test(d)) return rule("rent");
  // family support is a committed obligation (remittance), not generic money movement
  if (/WESTERN UNION|ENJAZ|انجاز|REMITTANCE|STC PAY INTL|تحويل دولي|FAMILY SUPPORT|تحويل عائلي|دعم عائلي/.test(d))
    return rule("remittance");
  if (/TRANSFER|تحويل|IBAN|حوالة داخلية/.test(d)) return rule("transfer");
  if (/صيدلية|PHARMACY|NAHDI|النهدي|الدواء|DAWAA|CLINIC|عيادة|مستشفى|HOSPITAL/.test(d))
    return rule("health");
  if (/تبرع|CHARITY|إحسان|EHSAN|ZAKAT|زكاة/.test(d)) return rule("charity");

  for (const [pattern, category, canonical] of KNOWN) {
    if (pattern.test(d) || pattern.test(merchant)) return rule(category, canonical);
  }
  return null;
}
