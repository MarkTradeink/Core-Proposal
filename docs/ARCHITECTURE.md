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
  "service_tier": "full_pipeline",
  "commercial_contact_email": "sales@demo-client.example",
  "templates": { "en": "1szdkO1M…", "es": null },
  "proposals_folder_id": "1vmm_AQf…",
  "reference_docs_folder_id": "<drive-folder-id>",
  "pricing_sheet_id": "<google-sheet-id>",
  "notification_chat_id": "1748634056"
}
```

Note: `service_tier` is the client's **default** deliverable; the rate card is **not** in
`client_config` — Module 3 reads it at runtime from the client's pricing Google Sheet.

## Three service tiers + per-request routing

The product is sold as three tiers, not four modules: **`pricing_only`** (a price estimate),
**`proposal_only`** (a written proposal, no price), **`full_pipeline`** (both). The four modules are
the internal building blocks (and the website's story), not individually sold units.

Routing is decided **per request**. Module 1 extracts a `request_type` from the reseller's email;
the orchestrator uses it, falling back to the client's `service_tier` when the request is
`unspecified`. So the same client can ask for a price today and a full proposal tomorrow.

## Scope of supply — one per-request selector

Module 1 also extracts a `scope_of_supply` map (item → boolean) against the fixed catalog in
`schemas/scope-catalog.json`. Scope is **per request** (a job can be full-turnkey or supply-only),
and that single map drives three modules in lockstep:

- **Module 3** prices only the in-scope labour categories,
- **Module 2** writes only the in-scope narrative sections,
- **Module 4** renders only the in-scope template blocks (out-of-scope tokens → removed).

Because pricing lines, narrative and document sections all read the same map, they never drift. This
is why there are **no per-client workflows**: client and request variation is expressed as data
(Notion config, pricing sheet, scope map), not as forked code.

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
- **Out `data`:** `alcance_tecnico` + `resumen_comercial` (always), plus any of `plan_implantacion`,
  `repuestos`, `transporte`, `formacion`, `garantia` that are **in scope** for the request. A
  `sections_generated` array records which were written.
- **Scope-aware:** a "Plan Sections" node reads `data.scope_of_supply` and asks the agent to write
  only the in-scope sections (others come back empty and are dropped).
- **Grounding:** a "Load reference docs" step reads `client_config.reference_docs_folder_id` and
  injects excerpts of the client's approved docs / past proposals into the agent context, so the
  sections reflect that client's real prior work rather than generic boilerplate.
- Schema: `schemas/content-generation.schema.json`.

### Module 3 — Pricing & commercial logic (`03-pricing-commercial-logic.json`)
- **In `data`:** `{ materials_cost: number, hours_by_category: { category: number } }` + `client_id`.
  `hours_by_category` has already been **filtered to the request's scope** by the orchestrator.
- **Out `data`:** `{ subtotal, margin_pct, risk_pct, discount_pct, total, payment_terms, priced_categories }`.
- **Rate card from Google Sheets:** a "Read Pricing Sheet" node loads the client's rate card at
  runtime from their pricing Google Sheet (`client_config.pricing_sheet_id`) — pricing *data* is not
  in the repo, so finance can change prices without a deploy. Sheet layout: `docs/PRICING-SHEET-TEMPLATE.md`.
- **Formula (phase-1, intentionally simple — no historical-hours estimation engine):**
  ```
  subtotal = materials_cost + Σ hours_by_category[c] * rate_by_category[c]   # in-scope categories only
  total    = subtotal * (1 + risk_pct) * (1 + margin_pct) * (1 - discount_pct)
  ```
- **Formula in code, data in Sheets:** the formula lives in `modules/pricing/pricing_core.js`
  (readable, self-checkable via `node …/pricing_core.js`) and is mirrored in the Module 3 "Compute
  Pricing" node — **plain JavaScript** (the self-hosted n8n runs JS natively; no Python/Pyodide). A
  missing rate for an in-scope category raises — never a silent wrong quote.
- Schema: `schemas/pricing.schema.json`.

### Module 4 — Proposal assembly (`04-proposal-assembly.json`)
- **In:** outputs of Modules 1 + 2 (+ 3 for full_pipeline; `pricing` is `null` for proposal_only) + `client_id`.
- **Out:** a Google Doc + PDF, an email **sent to `client_config.commercial_contact_email`** (in
  practice the RFQ sender) as a reply inside the original thread, and a Telegram notification to
  `client_config.notification_chat_id`.
- **Scope-aware rendering:** the master template holds every section as a `{{SECCION_*}}` token;
  Module 4 fills the in-scope ones and replaces out-of-scope ones with `""` so the block disappears.
  A visible `{{ALCANCE_SUMINISTRO}}` (Included / Not-included) block lets the reviewing reseller catch
  a wrong scope before sending. Template authoring: `docs/TEMPLATE-GUIDE.md`.
- **Deliberate changes from the legacy demo:**
  - Recipient is the client's own commercial contact (the reseller who forwarded the RFQ), **never**
    the extracted end-customer email (legacy gap G1).
  - Template is selected by `language` from `client_config.templates` with EN fallback (gap G2).
  - Proposal number is deterministic (`PROP-YYYYMMDD-<hash>`), computed in a Code node (bug B2).
- **Delivery:** the reply is **sent**, not left as a draft, from the client's own send-as alias
  (`demo@cifral.io` for `trial` clients, `proposal@cifral.io` otherwise) and threaded onto the
  original RFQ. Mechanically this is *create draft → `drafts.send`*: the Gmail node's Send operation
  rebuilds `From` from the authenticated mailbox and would discard the alias, while its Create Draft
  operation honours both `fromAlias` and `threadId`. `client_config.send_mode = 'draft'` skips the
  send step — the per-client rollback.
- Schema: `schemas/proposal-assembly.schema.json`.

## How the orchestrator composes them (`00-orchestrator-end-to-end.json`)

```
trigger (Gmail / chat)
  → Build Envelope (sender + thread id + "Re: <subject>")
  → Load Client Config (Notion, ONCE)                 ┐ resolve-once
  → Module 1  (Execute Workflow, client_config passed) ┘
  → IF status == "incomplete"
        → Telegram "RFQ needs human review" → stop     (realizes the website's Module-1 promise)
     ELSE Resolve Route (request_type, else service_tier) → Switch:
        • pricing_only  → Module 3 → Build Quote Draft → draft → send → Telegram  (price estimate, no doc)
        • proposal_only → Module 2 → Module 4                                      (document, no pricing block)
        • full_pipeline → Module 2 ∥ Module 3 → Merge → Module 4                   (full document)
```

Pricing inputs are entered manually and **filtered by the request's scope of supply** before
Module 3 (phase-1 has no auto hours-estimation engine).

Two envelope fields carry the email context. `client_config` holds what belongs to the *client*
(`from_alias`, `send_mode`, both derived in "Map Client Config"); a sibling `email_context` holds
what belongs to the *request* (`thread_id`, `message_id`, `reply_subject`). Runs with no originating
thread — the chat trigger, or a module invoked standalone — get a `null` `email_context` and
degrade to a new message with a synthetic subject rather than failing.

Because the orchestrator passes `client_config` through, each `Execute Workflow` sub-call skips its
own Notion lookup. A module called standalone (no `client_config` in the input) performs its own
lookup, so behavior is identical either way.

## Design constraints honored

- **Single demo client.** No multi-tenant config UI, no signup/admin frontend.
- **Pricing stays parametric.** No historical-hours estimation or benchmarking engine.
- **The existing "Customers Manager" CRM is untouched.** The client registry is a *separate* Notion
  database (see `CLIENT-REGISTRY-SCHEMA.md`).
