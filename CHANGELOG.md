# Changelog

All notable changes to this repo are recorded here. Dates are ISO-8601.

## [Unreleased]

### Phase 8 — Manual-test fixes + formatting polish (2026-07-24)
Reconciled fixes found during manual testing of the live workflows, plus proposal formatting:
- **Notion property prefix.** The n8n Notion node returns properties flattened as
  `property_<snake_cased_name>`. The orchestrator's "Map Client Config" now reads those keys, and the
  standalone fallbacks in Modules 1–4 tolerate both forms.
- **Pricing node is JavaScript.** Replaced the Python/Pyodide "Compute Pricing" with plain JS (the
  self-hosted n8n has no Python). `modules/pricing/pricing_engine.py` → `modules/pricing/pricing_core.js`
  (same formula, `node …/pricing_core.js` to check). Module 3 reads the sheet tab named `Pricing`.
- **Module 4 Copy Template** sets `sameFolder:false` so the generated doc lands in the proposals
  folder, not next to the template.
- **Module 2 empty-folder guard.** `Search Reference Docs` now has *Always Output Data* + a `Found
  Docs?` IF, so an empty reference-docs folder skips extraction instead of stalling the flow.
- **Scope extraction fixed (root cause: string booleans).** The Information Extractor returns
  `scope_of_supply` values as strings (`"true"`/`"false"`), so Module 1's strict `=== true` check was
  discarding every value and falling back to defaults — collapsing installation/commissioning/PM/
  shipping to `false` and under-pricing full-scope RFQs. The Validate node now coerces string
  booleans and normalizes `language` (`"English"` → `en`). The extractor prompt also maps the
  reseller's Included/Excluded phrases to catalog keys (installation supervision → installation,
  commissioning support → commissioning, freight → shipping, fabrication/procurement → materials, …).
- **Proposal formatting.** Module 2 emits plain text (no markdown) with `•` bullets and no self-made
  headings; Module 4 gives optional sections an uppercase heading and renders the pricing block as a
  self-contained "Economic Proposal" chapter. `docs/TEMPLATE-GUIDE.md` rewritten with a concrete,
  professional template layout (and a note on the Docs-API upgrade for native bullets).

### Phase 7 — Service tiers, per-request scope, Sheets pricing, manual testing (2026-07-23)
Reworked the demo after review, without changing the module boundaries:
- **Three service tiers instead of four module checkboxes.** Notion registry: added `service_tier`
  (`pricing_only` / `proposal_only` / `full_pipeline`) and `pricing_sheet_id`; dropped the four
  `module_*` checkboxes and `plan_tier`. The orchestrator now **routes per request**: Module 1
  extracts `request_type`, and the orchestrator branches (pricing_only → M3 + quote draft;
  proposal_only → M2+M4, no pricing; full_pipeline → M2 ∥ M3 → M4), falling back to `service_tier`.
- **Per-request scope of supply.** New `schemas/scope-catalog.json` defines the canonical scope
  items. Module 1 extracts a `scope_of_supply` map; it drives pricing lines (M3), narrative sections
  (M2) and template blocks (M4) together. Module 4 renders in-scope `{{SECCION_*}}` tokens and removes
  out-of-scope ones; it also prints a visible Scope-of-Supply block for the reviewing reseller.
- **Pricing data moved to Google Sheets.** Module 3 reads the rate card at runtime from the client's
  pricing Google Sheet (`pricing_sheet_id`); removed `example_client_config.json`.
  `modules/pricing/pricing_engine.py` stays as the versioned, self-contained reference formula.
- **Manual testing replaces the Python test suite.** Removed `scripts/` (`deploy_workflows.py`,
  `smoke_test.py`, `check_pricing_sync.py`, `requirements.txt`) and `modules/pricing/tests/`. Added
  `docs/TESTING-MANUAL.md`.
- **New docs:** `PRICING-SHEET-TEMPLATE.md`, `TEMPLATE-GUIDE.md` (master template with conditional
  section tokens), `RESELLER-EMAIL-GUIDE.md` (request instructions + email templates). Updated
  README, ARCHITECTURE, DEPLOYMENT, ONBOARDING, CLIENT-REGISTRY-SCHEMA.

### Phase 6 — Smoke test + deploy script (2026-07-21)
- `scripts/smoke_test.py`: runs a demo_client RFQ fixture through all four contract stages,
  validating each against `schemas/*.json`, executing the pricing engine for real, and asserting
  the business invariants (recipient fix G1, missing-field flagging G3, language template G2,
  deterministic numbering B2). All checks pass offline.
- `scripts/deploy_workflows.py`: pushes `workflows/*.json` to n8n via REST (POST create / PATCH
  update by name), env-gated on `N8N_API_URL`/`N8N_API_KEY` (refuses to run without them),
  retries with exponential backoff, and a `--relink` mode that repoints the orchestrator's
  Execute Workflow nodes to deployed sub-workflow ids by name.
- `scripts/requirements.txt`.

### Phase 5 — Orchestrator + Notion registry (2026-07-21)
- Applied the client-registry schema to the Notion "Projects" DB and seeded the `demo_client` row.
- `workflows/00-orchestrator-end-to-end.json`: resolve-once client config, M1 → (M2 ∥ M3) → M4,
  with an incomplete-RFQ branch to a Telegram review alert.

### Phase 4 — Pricing engine (2026-07-21)
- `modules/pricing/pricing_engine.py` + 14 pytest cases + `example_client_config.json`.
- `workflows/03-pricing-commercial-logic.json` embeds the tested core via Pyodide;
  `scripts/check_pricing_sync.py` guards against drift (fixes gap G5).

### Phase 3 — Module 2 content generation (2026-07-21)
- `workflows/02-technical-content-generation.json`: per-client document grounding (fixes gap G4)
  with a graceful no-folder fallback.

### Phase 2 — Modules 1 & 4 workflows (2026-07-21)
- `workflows/01-data-collection-validation.json`: deterministic missing-field flagging (gap G3),
  snake_case keys (bug B1).
- `workflows/04-proposal-assembly.json`: recipient fix (gap G1), language-driven template (G2),
  deterministic proposal number (B2), config-driven folder/chat.

### Phase 1 — Scaffold, schemas, docs, gap analysis (2026-07-21)
- Created repo structure: `workflows/`, `schemas/`, `modules/pricing/`, `reference/`, `docs/`,
  `scripts/`.
- Added `reference/DEMO-01-RFQ_reference_export.json` (the legacy monolith export, do not modify) and
  `reference/legacy-demo-analysis.md` (written analysis of the 5 known gaps + 4 additional bugs found:
  wrong draft recipient, dead `language` field, no missing-field flagging, ungrounded content,
  untested logic, silent `quantity` key mismatch, non-deterministic proposal numbering).
- Defined the shared contract envelope (`client_id` / `client_config` / `data` / `status` / `errors`)
  and JSON Schemas for all four module I/O contracts under `schemas/`.
- Wrote `README.md`, `docs/ARCHITECTURE.md`, `docs/CLIENT-REGISTRY-SCHEMA.md`, `docs/DEPLOYMENT.md`,
  `docs/ONBOARDING.md`.
- Key architecture decisions: thin separate orchestrator (Module 4 stays a pure assembly module);
  resolve `client_config` once and pass it through; repurpose the empty Notion "Projects" DB as the
  client registry (separate from the untouched "Customers Manager" CRM).
