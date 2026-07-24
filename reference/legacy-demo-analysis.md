# Legacy Demo Analysis — `DEMO-01-RFQ`

Analysis of the single monolithic proof-of-concept (`DEMO-01-RFQ`, live n8n workflow id
`kcGhK4oYmoerVzxo`), captured in `DEMO-01-RFQ_reference_export.json`. This document is the written
record of the gaps that motivated the modular refactor. Each finding names the offending node, what
it does today, why it's a problem, and how the refactor resolves it.

## What the legacy demo does (happy path)

```
Gmail Trigger (subject:RFQ, poll 1/min)
  → Information Extractor (Claude Haiku, RFQ text → JSON)
  → Set Format (proposal number, date, field mapping, rfq_raw)
  → Google Drive Copy (copy hardcoded EN template into hardcoded folder)
  → Update RFQ Data (replace {{PLACEHOLDERS}} in the Google Doc)
  → AI Agent (Claude Sonnet, generate 3 narrative sections)
  → Update Generated Text (replace {{ALCANCE_TECNICO}} etc.)
  → Convert to PDF (Google Drive download as PDF)
  → Create a draft (Gmail draft) → Send a text message (Telegram alert)
```
A second `When chat message received` trigger feeds the same Information Extractor for manual testing.

It proves the end-to-end concept. It is not safe to sell as four separable modules, is single-tenant,
and puts all business logic in untested/unversioned n8n expression strings.

## Findings

### G1 — Draft is sent to the end customer, not the reseller *(CRITICAL, from `_known_gap` on "Create a draft")*
`Create a draft` sets `sendTo = {{ $('Set Format').item.json.cliente_email }}`, i.e. the email
**extracted from the RFQ** — the end customer of Cifral's client. The service model requires the
draft to go back to the reseller/commercial contact who forwarded the RFQ, never to their customer.
- **Fix:** recipient comes from `client_config.commercial_contact_email` (loaded from the Notion
  client registry), never from extracted data. The extracted end-customer email is retained in the
  document body for reference only. Implemented in Module 4 (`04-proposal-assembly.json`).

### G2 — `language` is extracted but never used; template is hardcoded to English *(from `_known_gap` on "Information Extractor" / "Google Drive Copy")*
The extractor detects `language` (`es`/`en`), but nothing reads it. `Google Drive Copy` always copies
`Template_QuoteFast_Cifral_EN`. The signal and a single template ship together — dead field + wrong
language for Spanish RFQs.
- **Fix:** `client_config.templates` is a map keyed by language (`en`/`es`). Module 4 selects the
  template by the detected `language`, falling back to `en` when a variant isn't configured. The
  field now drives behavior instead of being dead weight. (Demo client ships EN only for now; ES is a
  documented TODO — the fallback keeps it correct meanwhile.)

### G3 — No missing-field flagging, despite the website promising it *(from `_known_gap` on "Information Extractor")*
Module 1's public positioning promises to "flag missing information before anyone starts writing."
The demo does no validation — a half-empty RFQ flows straight to proposal generation.
- **Fix:** Module 1 runs a deterministic **Code node** (not the LLM) that checks a required-field list
  (`company`, `contact_name`, `email`, `project.type`, ≥1 `technical_requirement`) and emits
  `status: complete|incomplete` + `missing_fields[]`. The orchestrator branches on `incomplete` and
  raises a Telegram "needs human review" alert instead of assembling a proposal.

### G4 — Content generation has zero grounding *(from `_known_gap` on "AI Agent")*
The `AI Agent` writes the three narrative sections from a generic system prompt with no access to the
client's approved documentation or past proposals. Output is plausible but ungrounded boilerplate.
- **Fix:** Module 2 loads the client's reference-docs folder
  (`client_config.reference_docs_folder_id`) and injects excerpts into the agent context so sections
  are grounded in that client's real prior work. (Demo ships a small grounding fixture; production
  wires the Google Drive read.)

### G5 — Business logic lives as untested n8n expression strings *(from `_known_gap` on "Set Format")*
Proposal numbering and field mapping are n8n expressions inside a `Set` node — no tests, no version
control, no review. This is exactly the logic that should move to tested, versioned code.
- **Fix:** The business-critical pricing calculation is implemented as the versioned reference
  formula (`modules/pricing/pricing_core.js`) and run in workflow 03's JavaScript Code node.
  Proposal numbering and field mapping move into small deterministic Code nodes inside their modules
  (versioned with the workflow JSON). (Phase 7 note: pricing *data* now comes from each client's
  Google Sheet, and the earlier `check_pricing_sync.py` guard was retired with the rest of `scripts/`.)

## Additional bugs found during analysis (not in the original `_known_gap` notes)

### B1 — Silent `quantity` bug in `Set Format`
`requisitos_lista` builds its list with `r.cantidad ? ...`, but the Information Extractor emits
`quantity`, not `cantidad`. `r.cantidad` is always `undefined`, so **quantities never render** in any
proposal. A snake_case-vs-Spanish key mismatch that no test would have caught.
- **Fix:** the refactored contract standardizes snake_case keys (`quantity`, `contact_name`,
  `contact_last_name`) end-to-end, and the mapping reads the same key the extractor writes.

### B2 — Non-deterministic, collision-prone proposal numbering
`numero_propuesta = Nº-{{yyyyMMdd}}-{{ Math.floor(Math.random()*900)+100 }}` uses `Math.random()`.
Re-processing the same RFQ produces a different number every time (not idempotent), and only 900
values per day invites collisions.
- **Fix:** deterministic `PROP-{YYYYMMDD}-{6-char base36 hash of client_id + rfq identity}`. Re-running
  the same RFQ yields the same proposal number, and the function is unit-testable.

### B3 — Inconsistent extractor keys (`contact name` with a space)
The extractor schema uses `"contact name"` / `"contact last name"` (spaces), forcing bracket access
(`client['contact name']`) everywhere and inviting typos.
- **Fix:** snake_case keys (`contact_name`, `contact_last_name`) throughout the new contracts.

### B4 — Single-tenant hardcoding throughout
Hardcoded template id (`1szdkO1M…`), destination folder (`1vmm_AQf…`), and Telegram chat id
(`1748634056`). No `client_id` parameterization anywhere.
- **Fix:** every one of these moves into the Notion client registry / `client_config`, resolved once
  by the orchestrator and passed through the shared contract envelope.

## Summary: gap → module → mechanism

| Gap | Resolved in | Mechanism |
|-----|-------------|-----------|
| G1 recipient | Module 4 | `commercial_contact_email` from registry |
| G2 language/template | Module 4 | `templates[language]` map + EN fallback |
| G3 missing fields | Module 1 | deterministic validation Code node |
| G4 grounding | Module 2 | per-client reference-docs folder |
| G5 untested logic | Module 3 | tested Python pricing engine + sync guard |
| B1 quantity | Modules 1 & 4 | snake_case key parity |
| B2 numbering | Module 4 | deterministic hash-based number |
| B4 hardcoding | Orchestrator | registry lookup + `client_config` passthrough |
