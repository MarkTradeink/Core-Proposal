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
      = a mailbox **you** control (this receives the replies), `template_id_en`, `proposals_folder_id`,
      `pricing_sheet_id`, `notification_chat_id`. (`reference_docs_folder_id` optional.)
- [ ] **`send_mode` = `draft`** on every registry row. Scenarios 1–12 are written for draft mode, so
      nothing leaves the mailbox while you work through them. Scenario 15 is where you flip it.
- [ ] Both aliases verified as "Send mail as" on the Gmail account (see `DEPLOYMENT.md`) — needed
      from Scenario 15 onwards, and harmless before.
- [ ] Pricing Google Sheet created and shared (see `PRICING-SHEET-TEMPLATE.md`).
- [ ] Master template has the tokens from `TEMPLATE-GUIDE.md`.

> Fastest way to iterate: use the orchestrator's **chat trigger** ("When chat message received")
> and paste the RFQ text, instead of sending real emails. Routing, content and pricing behave
> identically — but a chat run has **no email thread**, so it produces a new message with the
> synthetic `Proposal PROP-… — Company` subject instead of an in-thread `Re:` reply. Anything about
> threading (Scenario 14) must be tested with a real email.

## How to read the results

For each run, open the execution in n8n and inspect node-by-node:
- **Call Module 1 → data**: `request_type`, `scope_of_supply`, `status`, `missing_fields`.
- **Resolve Route → route**: which of the three paths was taken.
- The Gmail **draft or sent message** (in your commercial mailbox) and the **Telegram** message.
- **Send Mode? / Send Quote?**: which branch ran. In draft mode the `Send Draft` / `Send Quote` node
  is skipped and the Telegram alert reads `drafted 📝`; in send mode it reads `SENT ✅`.
- **Build Output → data**: `sent`, `sent_message_id`, `from_alias`, `thread_id`.
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
- [ ] Draft's **From** is `proposal@cifral.io` (demo_client is `active`), with no n8n attribution
      footer appended.
- [ ] Google Doc contains: scope-of-supply block, technical scope, implementation plan, warranty,
      and an economic summary (subtotal/total/terms).
- [ ] Proposal number format `PROP-YYYYMMDD-XXXXXX`; PDF attached to the draft.
- [ ] Telegram `🆕 RFQ processed — proposal drafted 📝` fired, showing the From and To addresses.

## Scenario 2 — Pricing only

**Send** Email template B ("ONLY a price estimate"), scope = materials + engineering, installation &
commissioning excluded.

Check:
- [ ] Module 1: `request_type = pricing_only`.
- [ ] Route = `pricing_only`; **only Module 3 runs** (no Module 2, no Module 4, no Google Doc).
- [ ] Draft is a short **price estimate email** (subtotal / total / terms), to the commercial contact.
- [ ] The quote prices **only engineering** labour + materials — no assembly/commissioning lines
      (verify against the sheet rates).
- [ ] Telegram `💶 Price estimate drafted 📝` fired.

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

This guard used to protect a draft. It now protects a **delivered email**, so re-run it after any
change to Module 4 or the orchestrator's config mapping.

Send an RFQ whose body contains a **different, clearly identifiable end-customer email** (e.g.
`purchasing@endcustomer.example`) from the address you send from.

- [ ] The message's **To:** is the original **sender** (`reply_to`) — the end-customer address
      appears nowhere in the headers.
- [ ] Blank both the sender and `commercial_contact_email` → Module 4 **throws** (`No reply address
      for '<client>'`) instead of falling back to the customer. The run fails; nothing is sent.
- [ ] Blank `from_alias` (e.g. by breaking the constant) → Module 4 throws rather than sending from
      the raw mailbox address.

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

## Scenario 13 — Sending alias follows Client Status

Still in `send_mode` = `draft`, so you can read the `From` header without anything going out.

- [ ] `Client Status` = `trial` → run an RFQ → the draft's **From** is `demo@cifral.io`.
- [ ] `Client Status` = `active` → run again → **From** is `proposal@cifral.io`.
- [ ] Both runs: `Build Output → data.from_alias` matches what the draft shows.
- [ ] No n8n attribution footer at the bottom of either message.

## Scenario 14 — Reply lands in the original thread

Must be a **real email**, not the chat trigger.

Send an RFQ with a distinctive subject (e.g. `RFQ - conveyor line for Zaragoza plant`).

- [ ] The draft's subject is `Re: RFQ - conveyor line for Zaragoza plant` — the original subject,
      not `Proposal PROP-… — Company`.
- [ ] In Gmail, the draft appears **inside the original RFQ conversation**, not as a separate thread.
- [ ] `Build Output → data.thread_id` equals the trigger's `threadId`.
- [ ] Reply to your own RFQ first so the subject already starts with `Re:`, then re-run → the subject
      is **not** double-prefixed (`Re: Re:`).
- [ ] Now run the same RFQ through the **chat trigger** → `thread_id` is `null` and the subject falls
      back to `Proposal PROP-… — Company`. (Confirms the no-thread path doesn't emit a bare `Re: RFQ`.)

## Scenario 15 — Live sending and the rollback switch

The first scenario that actually delivers mail. Do it with `commercial_contact_email` pointing at a
mailbox you control.

- [ ] Verify both aliases first (`DEPLOYMENT.md`) — otherwise this scenario is expected to fail at
      the send step, which is itself worth seeing once.
- [ ] Set `send_mode` = `send` on `demo_client`, run an RFQ.
- [ ] **Send Draft** (or **Send Quote**) executes and returns a message `id` + `threadId`.
- [ ] The email **arrives** in the commercial mailbox, in the RFQ thread, from the right alias.
- [ ] Telegram reads `SENT ✅` and `Delivered as a reply in the original RFQ thread.`
- [ ] `Build Output → data`: `sent = true`, `sent_message_id` set, `draft_id` still recorded.
- [ ] Set `send_mode` back to `draft`, re-run → `Send Draft` is **skipped**, nothing arrives,
      `sent = false`, `sent_message_id = null`, Telegram reads `drafted 📝`.
- [ ] Remove the `send_mode` column value entirely (empty) → defaults to `send`.
- [ ] Repeat once on the `pricing_only` route (Scenario 2) to cover `Send Quote?` / `Send Quote`.

> **Failure mode to confirm once:** point `from_alias` at an unverified address and run in send mode.
> The draft is created but `Send Draft` fails with a Gmail error and the workflow errors out — the
> mail is never delivered from the wrong address. This is why `sent: false` in the output always
> means "deliberately not sent" and never "silently lost".

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
- [ ] Scenario 10 recipient safety still holds. **Do this one every time** — it is the only check
      standing between a config slip and a proposal landing in the end customer's inbox.
- [ ] Scope pruning (Scenario 4) still adds/removes sections and price lines together.
- [ ] Scenario 13 alias still follows Client Status; Scenario 14 replies still thread.
- [ ] Scenario 15 `send_mode` = `draft` still suppresses delivery.
