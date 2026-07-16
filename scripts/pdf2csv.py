# Converts Al Rajhi-style monthly statement PDFs into MindTheLeak's canonical CSV.
# Usage: python scripts/pdf2csv.py  (reads data/Monthly_*.pdf → data/real.csv)

import csv
import glob
import re
import unicodedata
from pathlib import Path

import pdfplumber

DATA = Path(__file__).resolve().parent.parent / "data"

# a transaction line: <balance> <signed amount> <desc...> <DD/MM/YYYY gregorian>
TXN_START = re.compile(
    r"^(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(.*?)\s+(\d{2}/\d{2}/(?:19|20)\d{2})$"
)
HIJRI_DATE = re.compile(r"\s*\d{2}/\d{2}/1[34]\d{2}\s*$")  # trailing hijri date
CARD_REF = re.compile(r"\(\d{6,}-\d{6,}\)")  # (cardnumber-reference)
ARABIC_RUN = re.compile(r"[؀-ۿﭐ-﷿ﹰ-﻿][؀-ۿﭐ-﷿ﹰ-﻿\s]*")


def fix_arabic(text: str) -> str:
    """pdfplumber emits Arabic in visual order with presentation forms.
    NFKC restores base letters; reversing each Arabic run restores logical order."""
    def repair(m: re.Match) -> str:
        run = unicodedata.normalize("NFKC", m.group(0))
        # visual → logical: reverse word order and each word's letters
        return " ".join(w[::-1] for w in run.split()[::-1])
    return ARABIC_RUN.sub(repair, text)


# statement chrome that must never enter a transaction description
FOOTER_KEYWORDS = [
    "كشف الحساب", "اعتراض", "الرصيد الافتتاحي", "رصيد الاغلاق", "رصيد الاقفال",
    "مجموع مبلغ", "عدد عمليات", "اسم العميل", "تفاصيل العملية", "رقم الحساب",
    "العملة", "الفرع", "خمسة عشر", "الفتر", "التاريخ", "ريـال سعودي",
]
PAGE_MARKER = re.compile(r"\d+\s*من\s*\d+")


def is_chrome(line: str) -> bool:
    logical = fix_arabic(line)
    if PAGE_MARKER.search(logical):
        return True
    return any(kw in logical for kw in FOOTER_KEYWORDS)


def clean_desc(head: str, continuation: list[str]) -> str:
    parts = []
    for line in continuation[:3]:  # a real continuation is 1–2 lines; more = page chrome
        if is_chrome(line):
            continue
        line = HIJRI_DATE.sub("", line)
        line = CARD_REF.sub("", line).strip()
        if line:
            parts.append(line)
    head = head.replace("Apple Pay", "").strip()
    head = fix_arabic(head)
    english = " ".join(parts)
    desc = f"{english} {head}".strip()
    return re.sub(r"\s{2,}", " ", desc)


def parse_pdf(path: Path):
    rows = []
    with pdfplumber.open(path) as pdf:
        lines: list[str] = []
        for page in pdf.pages:
            lines.extend((page.extract_text() or "").splitlines())

    current = None  # (balance, amount, head, date, continuation[])
    for line in lines:
        line = line.strip()
        m = TXN_START.match(line)
        if m:
            if current:
                rows.append(current)
            balance, amount, head, date = m.groups()
            current = [balance, amount, head, date, []]
        elif current:
            # continuation belongs to the open transaction unless it's a header/footer
            if re.search(r"[A-Za-z؀-ۿﭐ-﻿]", line):
                current[4].append(line)
    if current:
        rows.append(current)

    out = []
    for balance, amount, head, date, cont in rows:
        amt = float(amount.replace(",", ""))
        out.append(
            {
                "transaction_date": date,
                "description": clean_desc(head, cont),
                "debit": f"{-amt:.2f}" if amt < 0 else "",
                "credit": f"{amt:.2f}" if amt > 0 else "",
                "balance": balance.replace(",", ""),
            }
        )
    return out


def main():
    all_rows = []
    for pdf_path in sorted(DATA.glob("Monthly_*.pdf")):
        rows = parse_pdf(pdf_path)
        print(f"{pdf_path.name}: {len(rows)} transactions")
        all_rows.extend(rows)

    def key(r):
        d, m, y = r["transaction_date"].split("/")
        return (y, m, d)

    all_rows.sort(key=key)
    out = DATA / "real.csv"
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["transaction_date", "description", "debit", "credit", "balance"])
        w.writeheader()
        w.writerows(all_rows)
    print(f"\nwrote {len(all_rows)} transactions to {out}")


if __name__ == "__main__":
    main()
