# Manual testing guide (demo client)

There is no automated test suite — testing is done by hand against the live n8n workflows with the
`demo_client`. This guide lists every scenario worth exercising, how to trigger it, and what to
check. Work top to bottom the first time; afterwards use it as a regression checklist whenever you
change a workflow.

## Before you start — one-time setup

- [ ] All 5 workflows imported into n8n (00 orchestrator + 01–04 modules).
- [ ] In the orchestrator, each **Call Module N** node repointed to the imported sub-workflow (by name).
- [ ] Credentials linked on every node: Gmail, Google Drive, Google Docs, Google Sheets, Anthropic, Telegram, Notion.
- [ ] Notion `demo_client` row filled: `service_tier` = `full_pipeline`, `commercial_contact_email`
      = a mailbox **you** control (this receives the drafts), `template_id_en`, `proposals_folder_id`,
      `pricing_sheet_id`, `notification_chat_id`. (`reference_docs_folder_id` optional.)
- [ ] Pricing Google Sheet created and shared (see `PRICING-SHEET-TEMPLATE.md`).
- [ ] Master template has the tokens from `TEMPLATE-GUIDE.md`.

> Fastest way to iterate: use the orchestrator's **chat trigger** ("When chat message received")
> and paste the RFQ text, instead of sending real emails. Behaviour is identical.

## How to read the results

For each run, open the execution in n8n and inspect node-by-node:
- **Call Module 1 → data**: `request_type`, `scope_of_supply`, `status`, `missing_fields`.
- **Resolve Route → route**: which of the three paths was taken.
- The Gmail **draft** (in your commercial mailbox) and the **Telegram** message.
- For proposals: open the generated Google Doc / PDF in the proposals folder.

---

## Scenario 1 — Full pipeline, full scope (happy path)

**Send** (subject contains `RFQ`), body = Email template A from `RESELLER-EMAIL-GUIDE.md` with all
scope items included.

Check:
- [ ] Module 1: `request_type = full_pipeline`, `status = complete`, `missing_fields = []`,
      `scope_of_supply` mostly `true`.
- [ ] Route = `full_pipeline`; Modules 2 and 3 both run, then Module 4.
- [ ] Draft lands in **commercial_contact_email**, NOT the end customer's email.
- [ ] Google Doc contains: scope-of-supply block, technical scope, implementation plan, warranty,
      and an economic summary (subtotal/total/terms).
- [ ] Proposal number format `PROP-YYYYMMDD-XXXXXX`; PDF attached to the draft.
- [ ] Telegram "New RFQ processed" fired.

## Scenario 2 — Pricing only

**Send** Email template B ("ONLY a price estimate"), scope = materials + engineering, installation &
commissioning excluded.

Check:
- [ ] Module 1: `request_type = pricing_only`.
- [ ] Route = `pricing_only`; **only Module 3 runs** (no Module 2, no Module 4, no Google Doc).
- [ ] Draft is a short **price estimate email** (subtotal / total / terms), to the commercial contact.
- [ ] The quote prices **only engineering** labour + materials — no assembly/commissioning lines
      (verify against the sheet rates).
- [ ] Telegram "Price estimate ready" fired.

## Scenario 3 — Proposal only (no pricing)

**Send** Email template C ("ONLY the technical proposal, no pricing").

Check:
- [ ] Module 1: `request_type = proposal_only`.
- [ ] Route = `proposal_only`; Modules 2 + 4 run, **Module 3 does not**.
- [ ] Google Doc has the narrative sections and scope-of-supply block but **no economic section**
      (the `{{SECCION_ECONOMICA}}` token is removed).
- [ ] Draft + PDF to the commercial contact; Telegram fired.

## Scenario 4 — Scope pruning inside a proposal

**Send** a full proposal request but with `Excluded: installation, commissioning, spare parts, training`.

Check:
- [ ] `scope_of_supply` shows those four `false`.
- [ ] Document: **no** implementation plan section (installation/commissioning out), no spare-parts /
      training sections. Scope-of-supply block lists them under "Not included".
- [ ] Pricing (if full): no assembly/commissioning labour lines.

## Scenario 5 — Incomplete RFQ (missing required fields)

**Send** a proposal/full request that omits the end-customer email and project type.

Check:
- [ ] Module 1: `status = incomplete`, `missing_fields` lists `client.email`, `project.type`.
- [ ] Route is not taken — **RFQ Needs Review** Telegram fires and the run stops.
- [ ] **No** draft and **no** document created.

## Scenario 6 — Pricing-only is more lenient

**Send** a pricing-only request that omits contact name/email and project type but has company +
requirements + scope.

Check:
- [ ] Module 1: `status = complete` (pricing-only doesn't require contact/email/project.type).
- [ ] A price estimate is produced.

## Scenario 7 — Unspecified request type → falls back to service_tier

**Send** a request that doesn't say whether it wants pricing, a proposal, or both.

Check:
- [ ] Module 1: `request_type = unspecified`.
- [ ] Route = the client's `service_tier` (for demo_client, `full_pipeline`).

## Scenario 8 — Language selection

**Send** the RFQ in Spanish.

Check:
- [ ] Module 1: `language = es`.
- [ ] Module 4 uses `template_id_es` if set, else falls back to `template_id_en`.
- [ ] Narrative sections are written in Spanish.

## Scenario 9 — Pricing data errors (fail-loud)

- **Missing rate row:** send a request whose scope includes a category that has **no rate row** in
  the sheet. Expect Module 3 to error `no rate configured for category '<x>'` — not a silent quote.
- **Bad `pricing_sheet_id`:** blank it in Notion and run pricing. Expect a clear error from
  Module 3's *Resolve Config* ("No pricing source ...").

## Scenario 10 — Recipient safety (the important one)

In any proposal run, confirm the Gmail draft's **To:** is the original **sender** (`reply_to`), never
the end customer's extracted email. If both the sender and `commercial_contact_email` are blank,
Module 4 must **throw** rather than fall back to the customer.

## Scenario 11 — Client identification by sender (multi-client)

Add a second registry row (e.g. `acme_client`) with a different `commercial_contact_email`, its own
`service_tier`, template, pricing sheet and `notification_chat_id`.

- [ ] **Email from demo_client's address** → matched to `demo_client`; its template/sheet/chat used.
- [ ] **Email from acme_client's address** → matched to `acme_client`; ITS template/sheet/chat used.
- [ ] Draft **To:** is the sender in each case.
- [ ] Chat trigger (no sender) still falls back to `demo_client`.

## Scenario 12 — Unknown sender & inactive client (gating)

- [ ] **Email from an unregistered address** → no proposal; admin Telegram "unrecognized sender".
- [ ] Set the client's `Client Status` to `paused` (or `churned`) and email from their address →
      no proposal; admin Telegram "client is paused/churned".
- [ ] Set it back to `trial` → processed again; success Telegram shows `(trial)`.

---

## Quick offline check (formula only, no n8n)

You can sanity-check the pricing math without n8n:

```bash
node modules/pricing/pricing_core.js
```

It prices a sample RFQ against an inline rate card and prints the subtotal/total — useful after any
change to the formula. (Remember: in production the numbers come from the client's Google Sheet, not
from this file.)

## Regression checklist (after any workflow change)

- [ ] Scenarios 1, 2, 3 still produce the right deliverable for each route.
- [ ] Scenario 5 still blocks incomplete RFQs.
- [ ] Scenario 10 recipient safety still holds.
- [ ] Scope pruning (Scenario 4) still adds/removes sections and price lines together.
