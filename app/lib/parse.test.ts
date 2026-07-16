// Self-check: node lib/parse.test.ts
import assert from "node:assert";
import { parseStatementCsv, cleanMerchant, normalizeText } from "./parse.ts";

const csv = `transaction_date,description,debit,credit,balance
15/03/2025,"شراء نقاط بيع POS PURCHASE ALBAIK RIYADH SA",45.00,,12405.50
01/03/2025,"راتب شهري SALARY",,"12,000.00",12450.50
٠٢/03/2025,"HUNGERSTATION RIYADH SA 23:41",89.50,,12361.00`;

const { transactions, errors } = parseStatementCsv(csv);
assert.strictEqual(errors.length, 0, JSON.stringify(errors));
assert.strictEqual(transactions.length, 3);

// sorted by date: salary first
assert.strictEqual(transactions[0].date, "2025-03-01");
assert.strictEqual(transactions[0].amount, -12000); // credit = money in
assert.strictEqual(transactions[1].date, "2025-03-02"); // Arabic-Indic digits normalized
assert.strictEqual(transactions[1].time, "23:41"); // time pulled from description? no — from date col only
assert.strictEqual(transactions[2].amount, 45);
assert.strictEqual(transactions[2].balance, 12405.5);

assert.strictEqual(
  cleanMerchant("شراء نقاط بيع POS PURCHASE ALBAIK RIYADH SA"),
  "ALBAIK"
);
assert.strictEqual(cleanMerchant("مدى HUNGERSTATION 88123 JEDDAH SA"), "HUNGERSTATION");
assert.strictEqual(normalizeText("١٢٣٫٥"), "123.5");

console.log("parse.ts self-check OK");
