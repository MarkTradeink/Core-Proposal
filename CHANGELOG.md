# Changelog

All notable changes to this repo are recorded here. Dates are ISO-8601.

## [Unreleased]

### Fix — Module 2's agent chain lost Plan Chapters' data past the first agent (2026-07-26)
Two independent reference bugs compounded into "A1 writes something, A2 and A3 write nothing."

`A2` and `A3` read Plan Chapters' fields (`langName`, `tier`, `rfq`, `briefs`, `tables_*`,
`rules_text`) through bare `$json`. That only works for `A1`, whose immediate predecessor really
is Plan Chapters - `$json` always means "the node right before this one," and for A2 that is A1,
for A3 that is A2. Neither carries those fields, so the expressions silently resolved to
`undefined`. Editing them by hand in the n8n UI to `$('Plan Chapters').item.json...` traded that
bug for a second one: `.item` needs n8n to trace paired-item lineage back through the Agent nodes
in between, which those nodes don't reliably preserve, so the field showed stuck on the unresolved
literal instead of the interpolated prompt. Both are now `$('Plan Chapters').first().json...`,
which needs no lineage - it just reads that node's last output - matching what A4, Assemble Draft
and Apply QA Patches already did correctly.

Separately, `Plan Chapters` itself read `proposal_config` from `$json`, but `Aggregate Grounding`
and `No Grounding` each rebuild their item from scratch (`{ grounding, grounded_on }` only) and
drop everything upstream, `proposal_config` included. Every brief came back empty, A1 was asked to
write zero sections, and correctly wrote zero sections - the symptom looked like a broken agent
but the agent was doing exactly what an empty brief told it to. `Plan Chapters` now reads
`proposal_config` via `$('Build Proposal Config').first().json`; `grounding` was already correct,
since that field really does come from the immediate predecessor.

### Fix — PDF attachment had Gotenberg's internal trace id as its filename (2026-07-26)
`Convert To PDF` called Gotenberg with no filename hint, so the response's `Content-Disposition`
carried Gotenberg's own trace id (a UUID-looking string) instead of the proposal's name — it showed
up as the PDF's filename wherever it landed, which read as unpolished next to the correctly-named
`.docx`. Two fixes, so the result does not depend on Gotenberg's behaviour alone: the request now
sends a `Gotenberg-Output-Filename` header with `doc_name`, and `Collect Artifacts` explicitly sets
`binary.pdf.fileName` (and `docx.fileName`, defensively) to the computed `pdf_file_name` /
`docx_file_name` before either reaches Gmail — the actual attachment name always comes from the
binary object's own property, not from whatever an intermediate service decided to call it.

### Phase 12 — Chapter catalog, five-stage generation, and per-client config in Drive (2026-07-26)
Seven narrative sections covered roughly 40% of a real capital-modernization proposal. The reference
document — a 26-page airport baggage-handling modernization — has 9 top-level chapters and three
levels of hierarchy; Cifral produced 4-8 flat pages. Worse, the structure was baked into two places
at once (a hardcoded `NARRATIVE_SECTIONS` array, mirrored, plus whatever chapters the client's `.docx`
happened to contain), so adding a chapter took five coordinated edits.

- **`schemas/chapter-catalog.json` — the closed vocabulary.** 14 body chapters plus front matter and
  annexes; 105 render keys, 24 tables. Each entry declares its tier, owning agent, content type and
  scope gate. Chapter ids *are* render keys, so the Phase 11 tag contract is unchanged — there are
  just more of them. **New chapters**: executive summary, background, technical solution, operational
  continuity / safety / risk, scope boundaries, next steps. **Split**: scope of supply (deliverables)
  from project execution (services) — they are read by different people for different reasons.
- **Three tiers over one structure.** A quotation (4-8 pp), B standard proposal (15-25 pp), C tender
  (30-60 pp + annexes). Not three documents: one catalog, three filters.
- **Per-client configuration moved to Google Drive.** A `Proposal Config` sheet in the client's own
  folder holds their chapter selection, renames and ordering (`Chapters`), their clause library,
  exclusions, assumptions and client obligations (`Content`), and their house style (`Rules`). Same
  split already used for pricing: the repo owns the formula, Drive owns the data. n8n cannot read
  repo files at runtime, and a salesperson should not need a deployment to add an exclusion. Clients
  with no sheet keep working on catalog defaults, with a warning on the run.
  New registry column `proposal_config_sheet_id`; full reference in `docs/CLIENT-DRIVE-SETUP.md`.
- **Boilerplate stopped going through the LLM.** About half of a proposal is contract text —
  warranty, liability, exclusions, general conditions. It used to be generated, which is
  hallucinating a contractual commitment for no benefit. It now travels from the client's spreadsheet
  into the same paragraph stream as generated text, through the same parser, with no model in
  between. The QA agent sees it as read-only and a patch aimed at it is refused.
- **Module 2 became five stages.** The single agent had `maxTokensToSample: 8192` and had to return
  seven JSON keys; a 20-30 page document does not fit in one reply, so the ceiling was arithmetic,
  not prompting. Now: **A5** resolves chapters and clauses (deterministic — a token matcher, because
  this stage decides which liability text ships), then **A1** technical → **A2** execution and risk →
  **A3** executive and commercial, each with its own budget, then **A4** reviews the assembled draft
  for contradictions, invented commitments and uncovered RFQ requirements. A1→A2→A3 run in sequence
  rather than in parallel: the execution plan must match the architecture, and a summary must
  summarise rather than guess.
- **Grounding widened.** Was 1 500 characters per document and 6 000 total — about a thousand words
  to ground a document that should run to eight thousand. Now 6 000 / 24 000 across up to 10
  documents, split per agent.
- **Gapless numbering.** Chapter numbers are assigned *after* empty and out-of-scope chapters are
  dropped, and the headings use Word multilevel numbering rather than typed numbers, so a proposal
  that omits chapters still reads 1, 2, 3. The contents list is a deterministic loop over what
  actually rendered, not a Word TOC field — the PDF leg runs through headless LibreOffice, which does
  not refresh field TOCs, so a field-based one would ship empty.
- **Version control is calculated** from the same date as the cover and footer. In the reference
  document these had drifted apart (footer 03/02, version table 16/02) — the kind of defect only
  manual assembly produces. The duplicated payment-terms block in the reference master is likewise
  one clause now.
- **Seed `.docx` templates, generated from the catalog** (`npm run templates`). A superset of 105
  conditional blocks that has to agree with the render context key for key is not a thing to maintain
  by hand. Onboarding copies a seed and restyles it; templates still live per-client in Drive.
- **Module 1 extracts what the new chapters need**: current situation, objectives, operational
  constraints, tender requirements with clause references (for the compliance matrix), risks, hot
  buttons, reference documents, and a tier hint. Also `phone`, which the template has had a tag for
  since Phase 11 and never had data for.
- **`scope-catalog.json` v2**: `narrative_section` (one string) → `sections` (an array). The old
  one-to-one mapping is what fused deliverables with execution.
- **`npm run check`** runs everything offline: three core self-checks, the mirror drift check, and
  four real docxtemplater renders reading the real seed config. **`npm run mirror`** copies the three
  logic cores into the five n8n Code nodes that run them — the drift checker used to only detect
  divergence, never fix it.

> **Templates must be rebuilt.** Chapter ids changed, so Phase 11 templates no longer match. There is
> no automatic migration, same as the Google Docs → docxtemplater move; `chapter-catalog.json`
> carries a `legacy_key_map` and `docs/TEMPLATE-GUIDE.md` is rewritten.

### Phase 11 — Document engine: Google Docs text replacement → .docx rendering (2026-07-25)
The proposal came out flat, and not by accident: `replaceAll` on a Google Doc can only swap *text
for text*, so a generated chapter inherited the styling of the paragraph its token sat in — no real
headings, bullets faked with a `•` character, the price summary as three bullet lines. Headings,
lists and tables are **structure**, and structure cannot travel through a text placeholder. Module 4
now renders the client's own **`.docx`** with docxtemplater instead.

- **Templates are Word files.** `template_id_en` / `_es` now point at a `.docx` in the client's Drive
  folder rather than a Google Doc. The client's styles, headers, footers, logo and page setup are
  preserved byte-for-byte instead of being degraded by a Docs conversion on the way in. **Existing
  templates must be rebuilt — there is no automatic migration** (`docs/TEMPLATE-GUIDE.md` is rewritten
  from scratch).
- **Structured render context.** `Compute Proposal Fields` stopped emitting pre-formatted strings and
  now emits paragraphs, bullet arrays and table rows. Module 2 is untouched: a deterministic parser
  turns its plain-text sections (whose format its prompt already pins) into that structure, which
  keeps the inter-module contract stable and costs no extra tokens.
- **Out-of-scope chapters vanish with their headings** via `{#has_*}` blocks — the thing the old
  token scheme explicitly could not do, and the reason `TEMPLATE-GUIDE.md` used to tell authors to
  type headings in UPPERCASE inside the generated text.
- **Real price table.** Module 3 gained `lines[]` (`modules/pricing/pricing_core.js` + its mirrored
  node), one row per priced category. Lines carry both the internal cost basis and the customer-facing
  `sell_amount`; per-line rounding residue is absorbed into the largest line so **the column sums to
  the total exactly**.
- **The subtotal is no longer printed in the document.** It is the pre-margin cost basis, and this
  document is forwarded by the reseller to their own end customer — printing it beside the total
  handed the customer the reseller's margin. The reseller still sees it in the quote email.
- **Money is localised.** `12345.6 EUR` became `12.345,60 €` / `€12,345.60` via `Intl.NumberFormat`,
  matching the proposal's language rather than the server's locale.
- **Both files are attached** — the editable `.docx` the reseller tweaks, and the PDF they forward.
  PDF conversion moved to **Gotenberg** (LibreOffice), which also fixes the pre-existing bug where
  `Convert to PDF` was a plain Drive download with no conversion, producing a Google Doc export named
  `.pdf`.
- **New `modules/proposal/render_context.js`**, mirrored into the node between `PROPOSAL RENDER CORE`
  markers exactly like the pricing core, checkable offline with `node modules/proposal/render_context.js`.
  `schemas/scope-catalog.json`'s dead `template_block` field (`MATERIALS`, `INSTALLATION`, … read by
  nothing) is repopulated with the real docxtemplater flags.

> ⚠️ **Before deploying:** install the community node `n8n-nodes-docxtemplater` (Settings → Community
> Nodes) and add a `gotenberg/gotenberg:8` service beside n8n. Both are covered in `DEPLOYMENT.md`,
> which also gains a Module 4 troubleshooting table.

Two constraints of the render node shaped the design and are worth knowing before editing a template:
it exposes no `nullGetter`, so a tag with no matching key prints the literal word `undefined` (the
context is therefore total — every key always present); and it parses tags as **Jexl** expressions, so
key names avoid `-` and loops iterate named objects rather than bare strings.

**The trap to know about:** loop tags written *inline* (`{#items}{texto}{/items}`) repeat only the
content inside the paragraph and concatenate every item into one run-on paragraph. Tags must sit
**alone on their own lines** for `paragraphLoop` to repeat the whole styled paragraph. This is the
difference between a native bullet list and the exact flat text this phase set out to eliminate, and
it is the first thing to check when a list looks wrong.

### Phase 10 — Live sending: send-as alias + in-thread replies (2026-07-25)
Quotes and proposals are now **delivered**, not parked as Gmail drafts, and they come from a Cifral
address instead of the personal mailbox that receives the RFQs:

- **Send-as alias.** `Map Client Config` derives `client_config.from_alias` from `Client Status` —
  `trial` → `demo@cifral.io`, everything else → `proposal@cifral.io` — and Module 4 / the quote
  branch pass it as the Gmail node's `fromAlias`. This finally gives `trial` behaviour of its own;
  it was cosmetic before.
- **Draft-then-send, not send.** The Gmail node's *Send Message* operation rebuilds `From` from the
  authenticated mailbox and silently discards any alias, while *Create Draft* honours `fromAlias`
  and `threadId`. Delivery is therefore `Create Draft` → new **`Send Draft`** / **`Send Quote`** HTTP
  node calling `gmail/v1/users/me/drafts/send`.
- **Replies land in the RFQ thread.** `Build Envelope` now keeps the trigger's `threadId`,
  `Message-ID` and a `Re: <original subject>` line in a new per-request `email_context`, carried
  beside `client_config` into Module 4. Gmail threads only when the thread id *and* the subject
  match, so the synthetic `Proposal PROP-… — Company` subject is now a fallback for runs with no
  thread (chat trigger, standalone module calls) rather than the default.
- **`send_mode` kill switch.** New per-client Notion column (`send` | `draft`, default `send`).
  `draft` skips the send step and restores exactly the previous behaviour — the per-client rollback
  for the first production deploy. DDL is in `CLIENT-REGISTRY-SCHEMA.md` and **not yet applied**.
- **`appendAttribution: false`** on both mail nodes — outgoing client mail was carrying n8n's own
  promotional footer.
- **Output records delivery.** `proposal-assembly.schema.json` gains `sent`, `sent_message_id`,
  `from_alias`, `thread_id`; the Telegram alerts now say `SENT ✅` / `drafted 📝` with the From and
  To addresses instead of always claiming a draft was created. `sent: false` always means
  "deliberately not sent" — a genuine send failure fails the node and the run.
- **Recipient guard hardened.** Gap G1 ("never the extracted end customer") now protects a real
  send, and Module 4 additionally throws if no `from_alias` resolved rather than falling back to the
  raw mailbox address. `TESTING-MANUAL.md` gains scenarios 13–15 (alias by status, in-thread reply,
  live sending + rollback) and promotes the recipient-safety check to every regression pass.

> ⚠️ **Before deploying:** verify `demo@cifral.io` and `proposal@cifral.io` as "Send mail as"
> addresses on the Gmail account (`DEPLOYMENT.md`), and link the Gmail OAuth2 credential to the two
> new HTTP Request nodes. Gmail rejects an unverified alias at send time, not at draft time.

Known unrelated defect, left for the document-engine work: Module 4's `Convert to PDF` node is a
plain Drive download with no `googleFileConversion` option, so the "PDF" attachment is the raw Google
Doc export with a `.pdf` name.

### Phase 9.1 — Extractor truncation + wider boolean coercion (2026-07-25)
Manual test with a real, detailed RFQ (12 technical requirements + full Included/Excluded scope
list) failed at the Information Extractor with `OUTPUT_PARSING_FAILURE` (`` ```json {...` `` not
valid JSON):
- **Root cause: token cap too low.** Module 1's Anthropic Chat Model had `maxTokensToSample: 800`,
  enough for the small demo fixture but not a real multi-item RFQ; the model's JSON got cut off
  mid-object (`"engineering": "yes"` then nothing), which is unparseable. Raised to `4000`.
- **Wider boolean coercion.** The same failed generation showed the model drifting to `"yes"`
  instead of `"true"` for scope values. `toBool()` in the Validate node now also accepts
  `yes/no`, `included/excluded`, `y/n`, `1/0` (case-insensitive), not just `true/false`, so scope
  extraction survives normal LLM wording variance instead of only the exact literal expected.

### Phase 9 — Multi-client identification, reply-to-sender, status gating (2026-07-24)
The orchestrator now supports more than one client and stops hardcoding `demo_client`:
- **Identify by sender email.** Build Envelope reads the Gmail sender; Map Client Config matches it to
  the registry row via `commercial_contact_email` and sets `client_id` from that row. The chat trigger
  (no sender) falls back to `demo_client` for testing.
- **Reply to the original sender.** `client_config.reply_to` = the actual sender; Module 4's draft and
  the pricing-only quote are addressed there (fallback: `commercial_contact_email`), never the
  extracted end customer.
- **Status gating.** A new `Client OK?` gate rejects unknown senders and `paused`/`churned` clients
  with an admin Telegram alert (`Client Rejected`); `active`/`trial` proceed, and the status is shown
  in the success alerts. Onboarding a trial client is now just a registry row (their sender email in
  `commercial_contact_email`, `Client Status` = `trial`, tier + folder/sheet ids).

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
