// CSV statement parser for Saudi bank exports.
// Handles: separate debit/credit columns or signed amount, DD/MM/YYYY dates,
// Arabic-Indic digits, RTL marks, and flexible Arabic/English headers.

import Papa from "papaparse";
import type { Transaction } from "./types.ts";

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function normalizeText(s: string): string {
  return s
    .replace(/[‎‏‪-‮]/g, "") // RTL/LTR marks
    .replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d])
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(/٬/g, "") // Arabic thousands separator
    .trim();
}

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = normalizeText(String(raw)).replace(/[,\s]|SAR|ر\.?س\.?/gi, "");
  if (!s || s === "-") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// Accepts DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD; returns ISO + optional time.
function parseDate(raw: string): { date: string; time?: string } | undefined {
  const s = normalizeText(raw);
  const timeMatch = s.match(/(\d{1,2}):(\d{2})/);
  const time = timeMatch
    ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
    : undefined;

  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time };

  m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    // ponytail: Hijri years (<1500) are rare in exports — flag by skipping, don't convert
    if (Number(y) < 1500) return undefined;
    return { date: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, time };
  }
  return undefined;
}

// Header aliases (lowercased, normalized) → canonical field
const HEADER_MAP: Record<string, string> = {
  // date
  "transaction_date": "date", "transaction date": "date", "date": "date",
  "التاريخ": "date", "تاريخ العملية": "date", "تاريخ": "date",
  // time
  "time": "time", "الوقت": "time",
  // description
  "description": "desc", "details": "desc", "narrative": "desc",
  "البيان": "desc", "الوصف": "desc", "تفاصيل العملية": "desc", "التفاصيل": "desc",
  // amounts
  "debit": "debit", "مدين": "debit", "خصم": "debit",
  "credit": "credit", "دائن": "credit", "إيداع": "credit",
  "amount": "amount", "المبلغ": "amount", "قيمة العملية": "amount",
  // balance
  "balance": "balance", "الرصيد": "balance", "running balance": "balance",
};

export function parseStatementCsv(csvText: string): {
  transactions: Transaction[];
  errors: string[];
} {
  const { data } = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => {
      const key = normalizeText(h).toLowerCase();
      return HEADER_MAP[key] ?? HEADER_MAP[normalizeText(h)] ?? key;
    },
  });

  const transactions: Transaction[] = [];
  const errors: string[] = [];

  data.forEach((row, i) => {
    const dateRaw = row["date"];
    const desc = row["desc"] ? normalizeText(row["desc"]) : "";
    if (!dateRaw || !desc) return; // header repeats / summary rows

    const parsed = parseDate(dateRaw);
    if (!parsed) {
      errors.push(`سطر ${i + 2}: تاريخ غير مفهوم "${dateRaw}"`);
      return;
    }

    const debit = parseNumber(row["debit"]);
    const credit = parseNumber(row["credit"]);
    const signed = parseNumber(row["amount"]);

    // Convention: positive = money out, negative = money in.
    let amount: number | undefined;
    if (debit !== undefined && debit !== 0) amount = Math.abs(debit);
    else if (credit !== undefined && credit !== 0) amount = -Math.abs(credit);
    else if (signed !== undefined) amount = -signed; // banks: positive = credit
    if (amount === undefined || amount === 0) {
      errors.push(`سطر ${i + 2}: مبلغ مفقود`);
      return;
    }

    transactions.push({
      id: `t${i}`,
      date: parsed.date,
      time:
        parsed.time ??
        (row["time"] ? normalizeText(row["time"]) : undefined) ??
        desc.match(/\b(\d{1,2}:\d{2})\b/)?.[1],
      description: desc,
      amount,
      balance: parseNumber(row["balance"]),
    });
  });

  transactions.sort((a, b) =>
    (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))
  );
  return { transactions, errors };
}

// Merchant cleanup: strip POS noise so "POS PURCHASE POS 1234 ALBAIK RIYADH SA"
// and "مدى ALBAIK" both key to "ALBAIK".
export function cleanMerchant(description: string): string {
  let s = normalizeText(description)
    .replace(/\b(\d{1,2}:\d{2})\b/, "")
    // Al Rajhi-style channel tails: "(محلي) شراء عبر نقاط البيع", "(دولي)شراء انترنت"
    .replace(/\(?(محلي|دولي)\)?\s*شراء[^,]*$/g, "")
    .replace(/شراء (عبر )?نقاط البيع|شراء انترنت|عملية تحويل داخلية/g, "")
    // card masks and channel prefixes: "484783******1907 :", "W - VISA/MASTERCARD :"
    .replace(/^[\dX*]*\*+[\dX*]*\s*:\s*/i, "")
    .replace(/^W\s*-\s*[A-Z/]+\s*:\s*/i, "")
    .replace(/^ONLINE PURCHASE FROM\s+/i, "");
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s
      .replace(/^(POS\s*PURCHASE|POS|شراء نقاط بيع|شراء|مدى|MADA|PURCHASE)\s+/i, "")
      .replace(/\b(POS|TERM(INAL)?)\s*#?\d+\b/gi, "")
      .replace(/\b\d{4,}\b/g, "") // terminal / reference numbers
      .replace(/\s+(RIYADH|JEDDAH|DAMMAM|MAKKAH|MADINAH|KHOBAR|SA|SAU|KSA)[\s,]*$/i, "")
      .replace(/[،,\s]+$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return s.toUpperCase();
}
