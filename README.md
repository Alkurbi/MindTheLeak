# MindTheLeak

Behavioral spending analysis for Saudi bank statements.

Most budgeting apps tell you *what* you spent. This one looks at *how* you
spend — payday bursts, late-night impulse buys, forgotten subscriptions — shows
what those habits cost over a year, and estimates how long your savings would
last if your income stopped.

It runs entirely on your own machine. You import a statement file; nothing goes
to a bank and no account login is involved.

## Try it

```bash
cd app
npm install
npm run dev
```

Open `http://localhost:3000/?demo=1` to load the bundled sample data and see the
dashboard. Add `&static=1` to turn animations off.

To use your own statement, export it as CSV and upload it on the landing page.
It never leaves your machine.

## How it works

- **Parsing** (`app/lib/parse.ts`) — handles Saudi bank export quirks:
  Arabic-Indic digits, RTL marks, debit/credit or signed amounts, `DD/MM/YYYY`
  dates, and messy merchant strings (including names truncated to ~22 chars).
- **Categorizing** (`app/lib/classify.ts`) — matches salary, bills, transfers,
  fees, and known merchants by rule.
- **Leak detection** (`app/lib/detect.ts`) — flags recurring behavioral
  patterns. Each transaction counts toward at most one leak, so the totals never
  double-count.
- **Resilience** (`app/lib/resilience.ts`) — estimates your monthly survival
  floor, how many months your savings would cover it, and what breaks first if
  income stops.

Run the checks with `node app/lib/{parse,detect,resilience}.test.ts` (Node 22.18+).

## Sample data

`app/public/demo.csv` is a generated sample persona (`app/scripts/gen-demo.ts`),
so anyone can try the app end to end without real data.
