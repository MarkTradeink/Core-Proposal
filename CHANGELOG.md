# Changelog

All notable changes to this repo are recorded here. Dates are ISO-8601.

## [Unreleased]

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
