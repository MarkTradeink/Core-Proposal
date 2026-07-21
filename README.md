# Cifral — Modular RFQ-to-Proposal Automation

Cifral turns an incoming industrial **RFQ** (request for quote) into a review-ready technical +
commercial **proposal**. This repository is the **source of truth** for the automation: four
independently-invocable [n8n](https://n8n.io) workflows plus a thin orchestrator, each with a
documented JSON input/output contract, backed by tested Python where the logic is business-critical
(pricing). The live n8n instance is a *deployment target*, not the canonical definition.

> Status: demo-grade, config-driven for one example client (`demo_client`). Not a multi-tenant
> product. There are zero paying clients yet — this is deliberately kept simple.

## The four modules ↔ the website's public positioning

Cifral is marketed as four modules that can be bought individually ("start with the single
bottleneck that hurts most") or as a full end-to-end pipeline. Each maps to one workflow:

| # | Website module | Workflow file | What it does |
|---|----------------|---------------|--------------|
| 1 | **Data collection & validation** — capture the request, extract key variables, flag missing information before anyone writes | `workflows/01-data-collection-validation.json` | RFQ text → structured JSON; flags `missing_fields` and marks the RFQ `complete`/`incomplete`. |
| 2 | **Technical content generation** — draft scope and technical sections from the client's approved docs | `workflows/02-technical-content-generation.json` | Generates the 3 narrative sections, grounded in that client's reference documents. |
| 3 | **Pricing & commercial logic** — run the client's cost, margin, and configuration rules automatically | `workflows/03-pricing-commercial-logic.json` | Computes subtotal/total/terms via the tested Python pricing engine. |
| 4 | **Proposal assembly** — assemble the complete document in the client's own template | `workflows/04-proposal-assembly.json` | Fills the client's Google Docs template, exports a PDF, creates a Gmail draft **to the client's own commercial contact**, and sends a Telegram alert. |
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
schemas/     JSON Schema for each module's I/O envelope
modules/pricing/   pricing_engine.py + pytest tests + example_client_config.json (demo rate card)
reference/   the legacy DEMO-01-RFQ export (do not modify) + written gap analysis
docs/        ARCHITECTURE, CLIENT-REGISTRY-SCHEMA, DEPLOYMENT, ONBOARDING
scripts/     deploy_workflows.py, smoke_test.py, check_pricing_sync.py
```

## What's different from the legacy demo

The single monolith `DEMO-01-RFQ` proved the concept but shipped with 5 documented gaps and 4 more
bugs found during analysis (draft sent to the wrong recipient, dead `language` field, no missing-field
flagging, ungrounded content, untested logic, a silent `quantity` bug, non-deterministic proposal
numbers). All are catalogued and mapped to their fix in
[`reference/legacy-demo-analysis.md`](reference/legacy-demo-analysis.md).

## Running the tests

```bash
# 1. Pricing engine unit tests (the business-critical logic)
python -m pytest modules/pricing/tests/ -v

# 2. Guard: the Python pricing engine and the n8n Code node stay in sync
python scripts/check_pricing_sync.py

# 3. End-to-end smoke test: a demo_client RFQ fixture validated against every schema
python scripts/smoke_test.py
```

Dependencies for the scripts: `pip install jsonschema` (pricing engine + tests are stdlib-only).

## Deploying to n8n

`scripts/deploy_workflows.py` pushes `workflows/*.json` to the live n8n instance via its REST API.
It reads `N8N_API_URL` and `N8N_API_KEY` from the environment and refuses to run without them — it
never fabricates credentials. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

```bash
export N8N_API_URL="https://<your-n8n-host>"
export N8N_API_KEY="<your-api-key>"
python scripts/deploy_workflows.py
```

## Onboarding a new client

See [`docs/ONBOARDING.md`](docs/ONBOARDING.md): create the Notion registry row, gather the rate card
into a config file, gather 3–5 past proposals for content grounding, and register the Google Docs
template.
