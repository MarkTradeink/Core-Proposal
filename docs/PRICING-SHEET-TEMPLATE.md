# Pricing Google Sheet — how to build it

Pricing **data** (hourly rates, margin, risk, discount, terms) is no longer stored in this repo.
Each client's rate card lives in a **Google Sheet in that client's Google Drive folder**, next to
their templates, generated proposals and reference docs. Module 3 reads it at runtime, so the
sales/finance team can change prices without touching code or n8n.

The repo keeps only the *formula* (`modules/pricing/pricing_engine.py`), which is versioned and
tested. The sheet supplies the numbers the formula multiplies.

## Where it goes

```
Google Drive / Clients / <Client Name> /
├── Templates/            (Google Docs master template — see TEMPLATE-GUIDE.md)
├── Generated Proposals/  (Module 4 output PDFs/Docs)
├── Reference Docs/       (approved past proposals for Module 2 grounding)
└── Pricing Rules         ← this Google Sheet
```

Copy the Sheet's id from its URL (`https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`)
and paste it into the client's **`pricing_sheet_id`** field in the Notion registry.

## Layout (one tab, three columns)

Put the data on the **first tab** of the sheet. Use exactly these three column headers in row 1:

| type  | key                | value |
|-------|--------------------|-------|
| rate  | engineering        | 85    |
| rate  | assembly           | 55    |
| rate  | commissioning      | 70    |
| rate  | project_management | 95    |
| param | margin_pct         | 0.20  |
| param | risk_pct           | 0.08  |
| param | discount_pct       | 0.0   |
| param | payment_terms      | 30% advance / 40% on delivery / 30% on commissioning |
| param | currency           | EUR   |

Rules:

- **`type = rate`** → `key` is a labour category, `value` is its **hourly rate**. Add as many rate
  rows as the client needs — the engine is generic. The category names must match the cost
  categories the workflow prices: `engineering`, `assembly` (installation), `commissioning`,
  `project_management` (these map from the request's scope of supply — see
  `schemas/scope-catalog.json`).
- **`type = param`** → one of `margin_pct`, `risk_pct`, `discount_pct` (fractions: `0.20` = 20%),
  `payment_terms` (free text), `currency` (ISO code).
- Rows whose category is **not in scope** for a given request are simply not priced — you don't
  remove them from the sheet; the request's scope decides what gets used.

## The formula (for reference)

```
subtotal = materials_cost + Σ (hours[category] × rate[category])   # only in-scope categories
total    = subtotal × (1 + risk_pct) × (1 + margin_pct) × (1 − discount_pct)
```

`materials_cost` and `hours[category]` come per-request (entered manually in the demo — phase 1 has
no automatic hours-estimation engine). The sheet supplies `rate[...]`, `margin_pct`, `risk_pct`,
`discount_pct`, `payment_terms`, `currency`.

## Different clients, different rate structures

This is exactly why the rate card is a sheet and not code. Client A can have 3 rate rows, Client B
can have 10 — the engine sums whatever in-scope categories appear in both the request and the sheet.
If a request references a labour category that has **no rate row** in the client's sheet, Module 3
**fails loudly** ("no rate configured for category X") rather than silently producing a wrong quote —
add the missing rate row and re-run.

## After you create the sheet

1. Share the sheet with the Google account whose credential n8n uses (or the service account).
2. Paste its id into `pricing_sheet_id` in the Notion registry row.
3. In n8n, open Module 3's **Read Pricing Sheet** node once, select the Google Sheets credential,
   and confirm it reads the first tab.
4. Run a `pricing_only` test (see `docs/TESTING-MANUAL.md`).
