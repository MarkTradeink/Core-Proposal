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
  "templates": { "en": "<drive-id of the EN .docx>", "es": null },
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
- **Module 2** writes only the in-scope chapters,
- **Module 4** renders only the in-scope template blocks (an out-of-scope chapter is dropped whole,
  heading included).

Because pricing lines, narrative and document sections all read the same map, they never drift. This
is why there are **no per-client workflows**: client and request variation is expressed as data
(Notion config, pricing sheet, Proposal Config sheet, scope map), not as forked code.

A scope item maps to one or more chapter ids (`sections` in the scope catalog). It used to map to
exactly one narrative section, which forced `materials` and `engineering` to share a chapter with
`installation` and `commissioning` — fusing *what is delivered* with *how it is executed*. Those are
read by different people for different reasons, so they are now separate chapters.

## The chapter catalog — structure in the repo, selection in Drive

`schemas/chapter-catalog.json` is the **closed vocabulary** of everything a proposal can contain:
14 body chapters, front matter, annexes, 105 render keys, 24 tables. Each entry declares its tier,
its owning agent, its content type and its scope gate. It is closed on purpose — an id that is not
in it has no agent that knows how to write it and no template block to render it.

What the catalog does *not* decide is which of those a given client uses. That lives in the client's
**Proposal Config** Google Sheet (`docs/CLIENT-DRIVE-SETUP.md`): chapters to include, rename and
reorder; their own clauses, exclusions and assumptions; and their writing rules. The split is the one
already used for pricing:

| | Repo (mirrored into Code nodes) | Drive (no deploy) |
|---|---|---|
| Price | `pricing_core.js` — the formula | `Pricing Rules` sheet — the numbers |
| Proposal | `chapter-catalog.json` — the structure | `Proposal Config` sheet — the selection and the text |

n8n cannot read repo files at runtime, so anything a salesperson must be able to change without a
deployment has to live in Drive. A client with no sheet still works: the catalog defaults apply and
the run records a warning saying the client's own boilerplate was not used.

The resolved result (`schemas/proposal-config.schema.json`) travels in the envelope beside
`client_config`, resolved once by the orchestrator after routing — it needs both the extracted scope
and whether the route produces a price.

### Three content types, three risk profiles

| Type | Share | Produced by |
|---|---|---|
| **Boilerplate** | ~50-60% | The client's clause library, selected by rules |
| **Calculated** | ~10% | RFQ + pricing data, deterministically |
| **Generated** | ~30-35% | LLM agents |

Contract text — warranty, liability, exclusions, general conditions — goes from the client's
spreadsheet to the paper without a model anywhere in between. It used to be LLM-written, which is
hallucinating a contractual commitment in exchange for nothing.

### Tiers

One structure filtered three ways: **A** quotation (4-8 pp), **B** standard proposal (15-25 pp),
**C** tender (30-60 pp + annexes). A request can ask for a tier; otherwise the client's
`default_tier` decides. Renaming a chapter or writing a clause applies to all three.

## Module boundaries and I/O contracts

### Module 1 — Data collection & validation (`01-data-collection-validation.json`)
- **In:** `data: { subject, text }` (raw RFQ) + `client_id`.
- **Out `data`:**
  ```json
  {
    "client": { "company", "contact_name", "contact_last_name", "email", "phone|null" },
    "project": { "type", "location|null", "country|null", "desired_deadline|null" },
    "technical_requirements": [ { "item", "quantity|null", "spec|null" } ],
    "current_situation": "string|null",
    "objectives": ["string"],
    "operational_constraints": ["string"],
    "tender_requirements": [ { "ref|null", "requirement" } ],
    "risks": ["string"], "hot_buttons": ["string"],
    "reference_documents": [ { "reference", "title|null", "date|null", "revision|null" } ],
    "tier": "A|B|C|null",
    "notes": "string|null",
    "language": "es|en",
    "status": "complete|incomplete",
    "missing_fields": ["string"]
  }
  ```
- **Nodes:** trigger → Information Extractor (snake_case schema) → **Validate (Code node)**. The Code
  node is deterministic — it does the missing-field flagging the website promises, *not* the LLM.
  Required fields: `company`, `contact_name`, `email`, `project.type`, ≥1 `technical_requirement`.
  The remaining fields feed the narrative chapters — `tender_requirements` becomes the compliance
  matrix, `operational_constraints` and `risks` feed the continuity chapter, `hot_buttons` steers the
  executive summary. Every one of them is null or empty when the email does not support it: an
  invented constraint is worse than a missing one.
- Schema: `schemas/data-collection.schema.json`.

### Module 2 — Technical content generation (`02-technical-content-generation.json`)
- **In:** Module 1 output + `client_id` (+ `proposal_config` on the orchestrated path).
- **Out `data`:** `sections` (render key → plain text) and `tables` (table id → row objects), plus
  `sections_generated`, `agents_run`, `clauses_applied`, `qa` and `grounded_on`.
- Schema: `schemas/content-generation.schema.json`.

**Five stages, not one agent.** The old single call had `maxTokensToSample: 8192` and had to return
seven keys; a 20-30 page document does not fit in one reply, so the ceiling was arithmetic, not
prompting.

| Stage | Does |
|---|---|
| **A5 · Build Proposal Config** | Resolves the catalog against the request and the client's sheet; selects which clauses apply. **Deterministic** — a token matcher, never a model. This stage decides which warranty and liability text ships. |
| **A1 · Technical** | Technical solution, scope of supply, applicable standards, materials and spares tables |
| **A2 · Execution & risk** | Execution, project management, operational continuity, phases, tests, risk register |
| **A3 · Executive & commercial** | Executive summary, background, next steps, recurring services |
| **A4 · QA review** | Reads the assembled draft for contradictions between chapters, invented commitments and uncovered RFQ requirements |

A1 → A2 → A3 run **in sequence, not in parallel**. The ordering is load-bearing: the execution plan
has to match the architecture A1 chose, and an executive summary has to summarise what was written
rather than guess at it. That costs latency and buys coherence.

A4 may patch generated sections. A patch aimed at a boilerplate section is refused and downgraded to
a finding — the client's contract text is not an agent's to rewrite.

- **Grounding:** "Search Reference Docs" reads `client_config.reference_docs_folder_id` and injects
  excerpts of the client's approved past proposals, up to 10 documents at 6 000 characters each
  (24 000 total), split per agent.

### Module 3 — Pricing & commercial logic (`03-pricing-commercial-logic.json`)
- **In `data`:** `{ materials_cost: number, hours_by_category: { category: number } }` + `client_id`.
  `hours_by_category` has already been **filtered to the request's scope** by the orchestrator.
- **Out `data`:** `{ subtotal, margin_pct, risk_pct, discount_pct, total, payment_terms, priced_categories, lines }`.
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
- **Line breakdown:** the result carries a `lines[]` array feeding the proposal's price table. Each
  line has the internal cost basis (`amount`) and the customer-facing price (`sell_amount`, the same
  multiplier as the total), and the sell column sums to `total` exactly — per-line rounding residue
  is absorbed by the largest line. Module 4 renders sell prices only; margin is never itemised.
- Schema: `schemas/pricing.schema.json`.

### Module 4 — Proposal assembly (`04-proposal-assembly.json`)
- **In:** outputs of Modules 1 + 2 (+ 3 for full_pipeline; `pricing` is `null` for proposal_only) + `client_id`.
- **Out:** a rendered `.docx` filed in the client's Drive folder plus its PDF, an email **sent to
  `client_config.commercial_contact_email`** (in practice the RFQ sender) as a reply inside the
  original thread with both files attached, and a Telegram notification to
  `client_config.notification_chat_id`.
- **Rendering:** the client's own **`.docx`** template is rendered with docxtemplater, so their
  styles, headers, footers and logos survive untouched. Module 4 emits a **structured render
  context** — paragraphs, bullet arrays, table rows — and the template owns the styling. Real Word
  headings, native lists and a price table follow from that; none of them can be expressed through
  a text placeholder, which is why the Google Docs find-and-replace pipeline was retired.
- **Scope-aware rendering:** each optional chapter sits inside a `{#has_*}` block, so an
  out-of-scope chapter disappears **with its heading**. A visible Included / Not-included scope list
  lets the reviewing reseller catch a wrong scope before it reaches their customer. Template
  authoring: `docs/TEMPLATE-GUIDE.md`.
- **Render logic in tested code:** the context builder lives in `modules/proposal/render_context.js`
  and is mirrored into the node between `PROPOSAL RENDER CORE` markers — same convention as the
  pricing formula. `node modules/proposal/render_context.js` checks it offline.
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
- **The chapter catalog is closed.** Clients customise by selecting, renaming and reordering what is
  in it, plus five reserved `custom_*` slots whose content comes entirely from their sheet. Adding a
  new agent-written chapter is a repo change, deliberately.
- **Boilerplate never passes through a model.** Contract text travels spreadsheet → render context
  → document, and the QA agent sees it as read-only.

## Keeping the mirrored cores honest

Three pieces of logic live in this repo *and* inside n8n, because a Code node cannot `require` a
file: `pricing_core.js`, `render_context.js` and `chapter_catalog.js` (the last one with the catalog
JSON inlined, in three nodes).

```bash
npm run mirror              # copy repo -> n8n workflow JSON
npm run check               # self-checks + drift check + four real renders
```

`scripts/mirror-cores.js` only touches the region between the `CORE START`/`CORE END` markers; each
node's own wrapper is left alone.
