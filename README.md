# Cifral — Modular RFQ-to-Proposal Automation

Cifral turns an incoming industrial **RFQ** (request for quote) into a review-ready technical +
commercial **proposal**. This repository is the **source of truth** for the automation: four
independently-invocable [n8n](https://n8n.io) workflows plus a thin orchestrator, each with a
documented JSON input/output contract, backed by tested JavaScript where the logic is
business-critical (pricing, and how proposal data is shaped for the document). The live n8n instance is a *deployment target*, not the canonical definition.

> Status: demo-grade, config-driven for one example client (`demo_client`). Not a multi-tenant
> product. There are zero paying clients yet — this is deliberately kept simple.

## Sold as three service tiers

Customers buy one of three tiers, and any single request can pick a different one:

| Tier | Deliverable | Modules used |
|------|-------------|--------------|
| **Pricing only** | A price estimate | M3 |
| **Proposal only** | A written technical proposal (no price) | M1 + M2 + M4 |
| **Full pipeline** | A priced proposal | M1 + M2 + M3 + M4 |

Module 1 reads a `request_type` from each incoming email, so a client on `full_pipeline` can still
ask for "just a price" on a given RFQ; the client's tier is the fallback default. Each request also
carries a **scope of supply** (materials, engineering, installation, commissioning, spare parts,
warranty, …) that drives pricing lines, narrative chapters and template blocks together — so one
client can send a full-turnkey RFQ today and a supply-only RFQ tomorrow through the *same* workflows.

## What the proposal actually contains

`schemas/chapter-catalog.json` is the canonical superset: **14 body chapters** plus front matter and
annexes, 105 render keys, 24 tables. It filters into three document weights — **A** quotation
(4-8 pp), **B** standard proposal (15-25 pp), **C** tender response (30-60 pp + annexes) — and the
same request's scope of supply prunes it further.

Roughly half of a real proposal is contract boilerplate, a tenth is calculated from data, and only
about a third is genuinely written. Cifral treats those differently: **boilerplate goes from the
client's spreadsheet to the paper with no model anywhere in between**, prices and tables are computed,
and the agents write the part that is actually specific to the project.

Each client's chapter selection, clause library, house style, **own cover variables** and **`.docx`
variants** live in one **Proposal Config Google Sheet** in their own Drive folder — see
[`docs/CLIENT-DRIVE-SETUP.md`](docs/CLIENT-DRIVE-SETUP.md). Renaming a chapter, adding an exclusion,
banning a word, putting the client's ERP offer number on the cover or adding a second template are
all spreadsheet edits, not deployments.

## The four modules ↔ the website's public positioning

The website still tells a four-module story (the internal building blocks). Each maps to one workflow:

| # | Website module | Workflow file | What it does |
|---|----------------|---------------|--------------|
| 1 | **Data collection & validation** — capture the request, extract key variables, flag missing information before anyone writes | `workflows/01-data-collection-validation.json` | RFQ text → structured JSON; flags `missing_fields` and marks the RFQ `complete`/`incomplete`. |
| 2 | **Technical content generation** — draft scope and technical sections from the client's approved docs | `workflows/02-technical-content-generation.json` | Five stages: resolves the chapter set and the client's clause library, then three writing agents by discipline, then a QA review. Grounded in that client's reference documents. |
| 3 | **Pricing & commercial logic** — run the client's cost, margin, and configuration rules automatically | `workflows/03-pricing-commercial-logic.json` | Computes subtotal/total/terms and the price-table line breakdown via the tested pricing core. |
| 4 | **Proposal assembly** — assemble the complete document in the client's own template | `workflows/04-proposal-assembly.json` | Renders the client's own `.docx` template (real Word headings, native lists, price table), exports a PDF, **replies in-thread to the client's own commercial contact** from the client's send-as alias with both files attached, and sends a Telegram alert. |
| — | **Full end-to-end pipeline** | `workflows/00-orchestrator-end-to-end.json` | Thin orchestrator: Notion client lookup → M1 → (M2 ∥ M3) → M4. |

A client buying only one module gets a workflow that behaves **identically** whether called
standalone or from the orchestrator — they share one contract (see below).

## The shared contract envelope

Every module accepts and returns the same envelope; the module-specific payload lives under `data`:

```json
{
  "client_id": "demo_client",
  "client_config": { "…optional; if absent, the module loads it from Notion by client_id…" },
  "data": { "…module-specific payload…" },
  "status": "ok | incomplete | error",
  "errors": []
}
```

- **`client_config` resolve-once, pass-through.** The orchestrator queries the Notion client registry
  **once** and passes `client_config` through the envelope, so sub-workflows skip their own lookup.
  Run standalone (no `client_config`), a module does its own Notion lookup by `client_id`.
- Full per-module contracts are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and enforced by the
  JSON Schemas in [`schemas/`](schemas/).

## Repository layout

```
workflows/   the 4 module workflows + 00-orchestrator (n8n JSON, git-tracked source of truth)
schemas/     I/O envelopes + chapter-catalog.json (the chapter superset) + scope-catalog.json
modules/intake/    intake_core.js       — which intake a message came through, and the guards on it
modules/pricing/   pricing_core.js      — the pricing formula (numbers live in Google Sheets)
modules/proposal/  chapter_catalog.js   — resolves the catalog against a request and a client
                   field_capture.js     — the client's own cover variables, read from the RFQ by
                                          label (deterministic: no model ever touches an identifier)
                   render_context.js    — how proposal data is shaped for the .docx template
templates/   build-templates.js + the seed .docx templates it generates from the catalog
scripts/     mirror-cores.js (repo -> n8n Code nodes), render-sample.js (offline render check),
             check-intake-routing.js (replays the intake chain against the real node source),
             client-docs.js (a client's setup guide + RFQ email template, from their own sheet)
seed/        each client's Proposal Config CSVs (six tabs) — demo_client's are the starting point
reference/   the legacy DEMO-01-RFQ export (do not modify) + written gap analysis
docs/        ARCHITECTURE, CLIENT-DRIVE-SETUP, CLIENT-REGISTRY-SCHEMA, DEMO-INTAKE, DEPLOYMENT,
             ONBOARDING, PRICING-SHEET-TEMPLATE, TEMPLATE-GUIDE, RESELLER-EMAIL-GUIDE,
             TESTING-MANUAL
```

**Two intakes.** `demo@cifral.io` is public — it serves any sender as `demo_client` and can only
ever produce a draft. `proposal@cifral.io` is for registered clients, matched by sender address.
See [`docs/DEMO-INTAKE.md`](docs/DEMO-INTAKE.md).

**The repo owns structure; Drive owns content.** Pricing numbers, chapter selection, clause libraries
and the actual `.docx` templates live in each client's Google Drive folder so they change without a
deploy. The repo owns the workflows, the contracts, the pricing formula, the chapter catalog and the
render context.

Five logic cores live in this repo *and* inside n8n, because a Code node cannot `require` a file.
`npm run mirror` copies them in the one safe direction; `npm run check` fails if they have drifted.

## What's different from the legacy demo

The single monolith `DEMO-01-RFQ` proved the concept but shipped with 5 documented gaps and 4 more
bugs found during analysis (draft sent to the wrong recipient, dead `language` field, no missing-field
flagging, ungrounded content, untested logic, a silent `quantity` bug, non-deterministic proposal
numbers). All are catalogued and mapped to their fix in
[`reference/legacy-demo-analysis.md`](reference/legacy-demo-analysis.md).

## Testing

Testing is **manual** against the live n8n workflows with the `demo_client` — see
[`docs/TESTING-MANUAL.md`](docs/TESTING-MANUAL.md) for every scenario (each service tier, scope
pruning, incomplete-RFQ handling, recipient safety, sending alias, in-thread replies, the
`send_mode` rollback, pricing errors) and what to check.

> ⚠️ Proposals and quotes are **sent**, not parked as drafts. Set a client's `send_mode` to `draft`
> in the Notion registry to hold delivery while you test — see
> [`docs/CLIENT-REGISTRY-SCHEMA.md`](docs/CLIENT-REGISTRY-SCHEMA.md). The exception is public
> traffic: anything arriving at `demo@cifral.io` is forced to draft in code and cannot send.

Most of what can break is checkable offline in a few seconds:

```bash
npm install
npm run check
```

That runs the five core self-checks, verifies the n8n Code nodes have not drifted from the repo,
replays the intake chain end to end against the real node source
([`docs/DEMO-INTAKE.md`](docs/DEMO-INTAKE.md)), and performs four real docxtemplater renders (tiers
A/B/C in Spanish, tier B in English) against the real templates and the real seed config — failing
on the two things that reach a customer silently, the literal word `undefined` and unrendered
braces.

## Deploying to n8n

Import `workflows/*.json` into n8n by hand and link credentials — there is no deploy script. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Onboarding a new client

See [`docs/ONBOARDING.md`](docs/ONBOARDING.md): create the Notion registry row, build the pricing
Google Sheet, create the Proposal Config sheet from the seed CSVs, restyle a seed `.docx` template,
and (optionally) gather past proposals for grounding. No code changes for a standard client.
