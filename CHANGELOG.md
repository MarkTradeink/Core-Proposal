# Changelog

All notable changes to this repo are recorded here. Dates are ISO-8601.

## [Unreleased]

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
