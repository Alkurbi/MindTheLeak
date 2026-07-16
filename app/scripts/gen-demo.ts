// Generates public/demo.csv — 3 months of realistic Saudi transactions engineered
// so every leak detector fires. Deterministic (seeded PRNG) so the demo never changes.
// Run: node scripts/gen-demo.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";

// mulberry32 — tiny seeded PRNG
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260711);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => a + rand() * (b - a);

type Row = { date: Date; desc: string; debit?: number; credit?: number };
const rows: Row[] = [];
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const addDays = (base: Date, n: number) =>
  new Date(base.getTime() + n * 86400000);

const START = d(2026, 4, 5);
const END = d(2026, 7, 9);

const pos = (merchant: string, city = "RIYADH", time?: string) =>
  `شراء نقاط بيع POS ${merchant} ${city} SA${time ? " " + time : ""}`;

// ---- salaries (27th) + rent (28th)
for (const m of [4, 5, 6]) {
  rows.push({ date: d(2026, m, 27), desc: "راتب شهري SALARY WPS TRANSFER", credit: 12000 });
  rows.push({ date: d(2026, m, 28), desc: "تحويل إيجار EJAR PLATFORM RENT", debit: 3500 });
}

// ---- fixed bills + commitments (real life: installments and family eat the slack)
for (const m of [4, 5, 6]) {
  rows.push({ date: d(2026, m, 3), desc: "SADAD ELECTRICITY KAHRABA فاتورة كهرباء", debit: Math.round(between(150, 220)) });
  rows.push({ date: d(2026, m, 5), desc: "STC سداد فاتورة اتصالات", debit: 149 });
  rows.push({ date: d(2026, m, 1), desc: "قسط تمويل شخصي ALRAJHI FINANCE INSTALLMENT", debit: 1400 });
  rows.push({ date: d(2026, m, 28), desc: "تحويل عائلي FAMILY SUPPORT TRANSFER", debit: 700 });
  // load-bearing but invisible until it lapses — the resilience story's marquee obligation
  rows.push({ date: d(2026, m, 8), desc: "قسط تأمين المركبة TAWUNIYA MOTOR INSURANCE", debit: 320 });
}

// ---- subscriptions (5 streams; Netflix+Shahid = zombie pair)
const SUBS: [string, number, number][] = [
  ["NETFLIX.COM", 56, 8],
  ["SHAHID VIP MBC", 29, 12],
  ["SPOTIFY AB", 21.99, 15],
  ["APPLE.COM/BILL ICLOUD", 14.99, 19],
  ["ANGHAMI PLUS", 19.99, 22],
];
for (const m of [4, 5, 6]) {
  for (const [merchant, amount, dayN] of SUBS) {
    if (m === 4 && dayN < 5) continue; // history starts Apr 5
    rows.push({ date: d(2026, m, dayN), desc: pos(merchant, "INTERNET"), debit: amount });
  }
}
// July charges before the 9th land too (fresh "it charged again yesterday" feel)
rows.push({ date: d(2026, 7, 8), desc: pos("NETFLIX.COM", "INTERNET"), debit: 56 });

// ---- groceries: weekly Tamimi/Panda, daytime (planned spending baseline)
for (let t = new Date(START); t <= END; t = addDays(t, 7)) {
  rows.push({
    date: addDays(t, Math.floor(rand() * 2)),
    desc: pos(pick(["TAMIMI MARKETS", "PANDA HYPER", "DANUBE CO"]), "RIYADH", `1${Math.floor(between(0, 9))}:2${Math.floor(rand() * 6)}`),
    debit: Math.round(between(180, 420)),
  });
}

// ---- fuel + transport
for (let t = new Date(START); t <= END; t = addDays(t, 9)) {
  rows.push({ date: t, desc: pos("ALDREES PETROL", "RIYADH"), debit: Math.round(between(80, 140)) });
}
for (let i = 0; i < 14; i++) {
  rows.push({
    date: addDays(START, Math.floor(rand() * 95)),
    desc: pos("CAREEM RIDE", "RIYADH"),
    debit: Math.round(between(18, 55)),
  });
}

// ---- coffee habit: ~5 mornings/week, small amounts → micro-leak volume
for (let t = new Date(START); t <= END; t = addDays(t, 1)) {
  if (rand() < 0.66) {
    rows.push({
      date: t,
      desc: pos(pick(["STARBUCKS", "BARNS COFFEE", "DOSE CAFE", "HALF MILLION"]), "RIYADH", `0${Math.floor(between(7, 10))}:${Math.floor(between(10, 59))}`),
      debit: Math.round(between(14, 32)),
    });
  }
}

// ---- delivery habit: ~5/week, heavy Thu/Fri, mostly 21:30–01:50 → late-night + streak
const DELIVERY = ["HUNGERSTATION", "JAHEZ APP", "TOYOU DELIVERY", "MRSOOL"];
for (let t = new Date(START); t <= END; t = addDays(t, 1)) {
  const dow = t.getUTCDay(); // 4 = Thu, 5 = Fri
  const p = dow === 4 || dow === 5 ? 0.8 : 0.28;
  if (rand() < p) {
    const late = rand() < 0.5;
    const hour = late ? pick(["22", "23", "00", "01"]) : pick(["13", "14", "19", "20"]);
    const min = String(Math.floor(rand() * 60)).padStart(2, "0");
    rows.push({
      date: t,
      desc: pos(pick(DELIVERY), "RIYADH", `${hour}:${min}`),
      debit: Math.round(between(38, 105)),
    });
    if ((dow === 4 || dow === 5) && rand() < 0.25) {
      // second order same night — burst
      rows.push({
        date: t,
        desc: pos(pick(DELIVERY), "RIYADH", `${pick(["23", "00"])}:${String(Math.floor(rand() * 60)).padStart(2, "0")}`),
        debit: Math.round(between(35, 90)),
      });
    }
  }
}

// ---- payday burn: shopping burst in days 0–4 after each salary
const SHOPPING = ["NOON.COM", "SHEIN.COM", "JARIR BOOKSTORE", "EXTRA STORES", "NAMSHI.COM", "AMAZON.SA"];
for (const m of [4, 5, 6]) {
  const burst = 3 + Math.floor(rand() * 3); // 3–5 purchases
  for (let i = 0; i < burst; i++) {
    rows.push({
      date: d(2026, m, 27 + Math.floor(rand() * 5)),
      desc: pos(pick(SHOPPING), "INTERNET", `${pick(["12", "16", "21", "22"])}:${String(Math.floor(rand() * 60)).padStart(2, "0")}`),
      debit: Math.round(between(90, 380)),
    });
  }
  // cinema/entertainment on payday weekend
  rows.push({ date: d(2026, m === 6 ? 7 : m + 1, m === 6 ? 2 : 1), desc: pos("VOX CINEMA", "RIYADH", "21:15"), debit: Math.round(between(90, 160)) });
}

// ---- ATM + fees + pharmacy + charity (texture)
for (const m of [4, 5, 6]) {
  rows.push({ date: d(2026, m, 15), desc: "ATM CASH WITHDRAWAL سحب نقدي صراف", debit: 500 });
  rows.push({ date: d(2026, m, 16), desc: "رسوم خدمة FEE INTERNATIONAL TRANSACTION", debit: Math.round(between(8, 18)) });
  rows.push({ date: d(2026, m, 11), desc: pos("NAHDI PHARMACY صيدلية النهدي"), debit: Math.round(between(45, 130)) });
}
rows.push({ date: d(2026, 5, 20), desc: "تبرع منصة إحسان EHSAN DONATION", debit: 100 });

// ---- render CSV with running balance
rows.sort((a, b) => a.date.getTime() - b.date.getTime());
// opening balance tuned so the demo persona's runway lands near 2 months
let balance = 12400;
const lines = ["transaction_date,description,debit,credit,balance"];
for (const r of rows) {
  balance += (r.credit ?? 0) - (r.debit ?? 0);
  const dt = r.date;
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  lines.push(
    `${dd}/${mm}/${dt.getUTCFullYear()},"${r.desc}",${r.debit?.toFixed(2) ?? ""},${r.credit?.toFixed(2) ?? ""},${balance.toFixed(2)}`
  );
}

const out = join(import.meta.dirname, "..", "public", "demo.csv");
writeFileSync(out, "﻿" + lines.join("\n"), "utf8");
console.log(`wrote ${rows.length} transactions to ${out}`);
