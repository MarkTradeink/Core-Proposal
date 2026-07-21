# Architecture

## Why this shape

The legacy `DEMO-01-RFQ` was a single n8n workflow that did everything from Gmail trigger to Telegram
alert. It could not be sold as four separable modules, was single-tenant hardcoded, and kept all
business logic as untested n8n expression strings. This repo refactors it into **four
independently-invocable workflows + a thin orchestrator**, each with a documented, schema-enforced
JSON contract, so a client can buy one module or the whole pipeline and get identical behavior.

Two design rules make the modules composable:

1. **Shared envelope.** Every module reads and writes the same wrapper; only `data` differs.
2. **Resolve client config once, pass it through.** The orchestrator does the Notion lookup; modules
   accept the resolved `client_config` and only fall back to their own lookup when run standalone.

## The shared contract envelope

```json
{
  "client_id": "string (required)",
  "client_config": "object | null (optional passthrough; loaded from Notion when absent)",
  "data": "object (module-specific payload — see per-module contracts)",
  "status": "ok | incomplete | error",
  "errors": ["string"]
}
```

`client_config` (resolved from the Notion client registry — see `CLIENT-REGISTRY-SCHEMA.md`) carries:

```json
{
  "client_id": "demo_client",
  "client_name": "Demo Client S.L.",
  "plan_tier": "full_pipeline",
  "modules": {
    "data_collection": true, "content_generation": true,
    "pricing": true, "proposal_assembly": true
  },
  "commercial_contact_email": "sales@demo-client.example",
  "templates": { "en": "1szdkO1M…", "es": null },
  "proposals_folder_id": "1vmm_AQf…",
  "reference_docs_folder_id": "<drive-folder-id>",
  "notification_chat_id": "1748634056",
  "rate_card": { "…see modules/pricing/example_client_config.json…" }
}
```

## Module boundaries and I/O contracts

### Module 1 — Data collection & validation (`01-data-collection-validation.json`)
- **In:** `data: { subject, text }` (raw RFQ) + `client_id`.
- **Out `data`:**
  ```json
  {
    "client": { "company", "contact_name", "contact_last_name", "email" },
    "project": { "type", "location|null", "desired_deadline|null" },
    "technical_requirements": [ { "item", "quantity|null", "spec|null" } ],
    "notes": "string|null",
    "language": "es|en",
    "status": "complete|incomplete",
    "missing_fields": ["string"]
  }
  ```
- **Nodes:** trigger → Information Extractor (snake_case schema) → **Validate (Code node)**. The Code
  node is deterministic — it does the missing-field flagging the website promises, *not* the LLM.
  Required fields: `company`, `contact_name`, `email`, `project.type`, ≥1 `technical_requirement`.
- Schema: `schemas/data-collection.schema.json`.

### Module 2 — Technical content generation (`02-technical-content-generation.json`)
- **In:** Module 1 output + `client_id`.
- **Out `data`:** `{ alcance_tecnico, plan_implantacion, resumen_comercial }`.
- **Grounding:** a "Load reference docs" step reads `client_config.reference_docs_folder_id` and
  injects excerpts of the client's approved docs / past proposals into the agent context, so the
  sections reflect that client's real prior work rather than generic boilerplate.
- Schema: `schemas/content-generation.schema.json`.

### Module 3 — Pricing & commercial logic (`03-pricing-commercial-logic.json`)
- **In `data`:** `{ materials_cost: number, hours_by_category: { category: number } }` + `client_id`
  (loads the rate card / margin rules).
- **Out `data`:** `{ subtotal, margin_pct, risk_pct, discount_pct, total, payment_terms }`.
- **Formula (phase-1, intentionally simple — no historical-hours estimation engine):**
  ```
  subtotal = materials_cost + Σ hours_by_category[c] * rate_by_category[c]
  total    = subtotal * (1 + risk_pct) * (1 + margin_pct) * (1 - discount_pct)
  ```
- **Why Python, not n8n expressions:** pricing is the one place a wrong number costs real money. It
  lives in `modules/pricing/pricing_engine.py` with unit tests (normal, zero-risk/zero-discount
  edges, negative-input rejection, rounding). The workflow's Code node embeds that exact function via
  Pyodide, with a header comment pointing at the repo path; `scripts/check_pricing_sync.py` fails CI
  if the two drift. Everything else (numbering, mapping) is deterministic Code-node logic versioned
  with the workflow JSON — the legacy "logic as untracked Set-node strings" anti-pattern is gone.
- Schema: `schemas/pricing.schema.json`.

### Module 4 — Proposal assembly (`04-proposal-assembly.json`)
- **In:** outputs of Modules 1 + 2 + 3 + `client_id`.
- **Out:** a Google Doc + PDF, a Gmail **draft to `client_config.commercial_contact_email`**, and a
  Telegram notification to `client_config.notification_chat_id`.
- **Deliberate changes from the legacy demo:**
  - Recipient is the client's own commercial contact (the reseller who forwarded the RFQ), **never**
    the extracted end-customer email (legacy gap G1).
  - Template is selected by `language` from `client_config.templates` with EN fallback (gap G2).
  - Proposal number is deterministic (`PROP-YYYYMMDD-<hash>`), computed in a Code node (bug B2).
- Schema: `schemas/proposal-assembly.schema.json`.

## How the orchestrator composes them (`00-orchestrator-end-to-end.json`)

```
trigger (Gmail / chat)
  → Load Client Config (Notion, ONCE)                 ┐ resolve-once
  → Module 1  (Execute Workflow, client_config passed) ┘
  → IF status == "incomplete"
        → Telegram "RFQ needs human review" → stop     (realizes the website's Module-1 promise)
     ELSE
        → Module 2  (Execute Workflow) ┐  run in parallel
        → Module 3  (Execute Workflow) ┘
        → Merge
        → Module 4  (Execute Workflow) → PDF + draft + Telegram
```

Because the orchestrator passes `client_config` through, each `Execute Workflow` sub-call skips its
own Notion lookup. A module called standalone (no `client_config` in the input) performs its own
lookup, so behavior is identical either way.

## Design constraints honored

- **Single demo client.** No multi-tenant config UI, no signup/admin frontend.
- **Pricing stays parametric.** No historical-hours estimation or benchmarking engine.
- **The existing "Customers Manager" CRM is untouched.** The client registry is a *separate* Notion
  database (see `CLIENT-REGISTRY-SCHEMA.md`).
