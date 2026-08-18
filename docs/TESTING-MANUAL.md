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
      nothing leaves the mailbox while you work through them. Scenario 15 is where you flip it —
      and it needs a **second, non-demo** row, because the demo tenant does not read that column.
- [ ] ⚠️ **`demo_client` is the exception, and it now SENDS.** Its mode comes from `DEMO_SEND_MODE`
      in `modules/intake/intake_core.js`, not from Notion, and it ships as `send`. Every scenario
      addressed to `demo@cifral.io` therefore delivers a real email to whoever sent the RFQ. Use a
      mailbox you control, or set the constant to `draft` and `npm run mirror` before you start.
- [ ] Chase the intake scenarios (12b) from a mailbox that is **not** in the registry, and expect
      the rate limit to bite on the fourth message of the day from any one address.
- [ ] Both aliases verified as "Send mail as" on the Gmail account (see `DEPLOYMENT.md`) — `demo@`
      is needed from Scenario 5b onwards now that the demo delivers, not only from Scenario 15.
- [ ] Pricing Google Sheet created and shared (see `PRICING-SHEET-TEMPLATE.md`).
- [ ] Community node `n8n-nodes-docxtemplater` installed and Gotenberg reachable (see `DEPLOYMENT.md`).
- [ ] Master **`.docx`** template uploaded to Drive with the tags from `TEMPLATE-GUIDE.md`, and
      `template_id_en` pointing at that Word file (not a Google Doc).

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
- **Build Output → data**: `sent`, `sent_message_id`, `from_alias`, `thread_id`, `sections_rendered`.
- For proposals: open the generated `.docx` in the proposals folder, and both attachments on the mail.

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
- [ ] Generated `.docx` contains: scope-of-supply lists, technical scope, implementation plan,
      warranty, and an economic table (line items / total / terms).
- [ ] Proposal number format `PROP-YYYYMMDD-XXXXXX`; **both** the `.docx` and the PDF attached.
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
- [ ] The `.docx` has the narrative sections and scope-of-supply lists but **no economic chapter** —
      the whole `{#has_pricing}` block, heading included, is gone.
- [ ] Both attachments reach the commercial contact; Telegram fired.

## Scenario 4 — Scope pruning inside a proposal

**Send** a full proposal request but with `Excluded: installation, commissioning, spare parts, training`.

Check:
- [ ] `scope_of_supply` shows those four `false`.
- [ ] Document: **no** implementation plan chapter (installation/commissioning out), no spare-parts /
      training chapters — and each missing chapter takes **its heading with it**, so the numbering
      that remains reads as a deliberate document, not one with holes.
- [ ] Scope-of-supply block lists them under "Not included".
- [ ] Pricing (if full): no assembly/commissioning labour lines.

## Scenario 5 — Incomplete RFQ (missing required fields)

**Send** a proposal/full request that omits the end-customer email and project type.

Check:
- [ ] Module 1: `status = incomplete`, `missing_fields` lists `client.email`, `project.type`, and
      `missing_fields_detail` carries a readable label for each.
- [ ] Route is not taken — no Module 2/3/4 call, **no** document created.
- [ ] **RFQ Needs Review** Telegram fires, listing the missing items by their *labels*.
- [ ] A reply to **the sender** is composed: subject is the original prefixed `Re:`, it lands in the
      original thread, and the body lists the same items in the RFQ's language.
- [ ] Recipient is the **sender**, never the extracted end customer.
- [ ] With `send_mode = draft` it stays a draft and the Telegram says so; with `send` it goes out and
      the Telegram says that instead.
- [ ] A client field marked `required` in the `Fields` tab that the sender omitted appears in the
      email under **the client's own label** ("Oferta nº"), not as `custom_fields.n_oferta`.

## Scenario 5b — Incomplete RFQ on the public intake

**Send** an incomplete RFQ to `demo@cifral.io` from an address that is not in the registry.

Check:
- [ ] The reply **arrives in that mailbox**, in the original thread, from `demo@cifral.io`, listing
      the missing items in the RFQ's language. Asking the prospect for the one field they left out
      is the most useful message this system sends; holding it as a draft is what made the demo
      feel dead.
- [ ] The Telegram alert says the reply was sent, not that it is waiting.
- [ ] Set `DEMO_SEND_MODE = 'draft'`, `npm run mirror`, re-import the orchestrator, re-run → the
      same reply is composed and **stays in Drafts**, and the Telegram says so. Put it back.

## Scenario 5c — The demo was used (lead capture)

**Send** any RFQ to `demo@cifral.io` from an address that is not in the registry.

Check:
- [ ] A **🎯 Demo used — new lead** Telegram fires, carrying the sender's address, the subject and
      the intake address.
- [ ] It arrives **before** the pipeline finishes — kill the run midway and the alert has still
      fired, because the lead matters whether or not the proposal succeeds.
- [ ] It does **not** fire for a registered client on `proposal@cifral.io`.
- [ ] A rate-limited or junk-filtered message does not produce it — those are refused before the
      client is even resolved, and alert separately.

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

## Scenario 7b — A request outside the client's tier (the clamp)

**Send**, to a client whose `service_tier` is `proposal_only`, an RFQ worded so the extractor is
likely to read it as wanting a price ("necesitamos presupuesto para…", a budget question, a cost
breakdown request).

Check:
- [ ] Module 1 may well report `request_type = full_pipeline` or `pricing_only` — that is allowed,
      the extractor is not the thing being tested.
- [ ] `Resolve Route`: `route = proposal_only`, `requested_route` echoes what the extractor said,
      `route_note` explains the substitution.
- [ ] **Module 3 is never called.** The switch takes the `proposal_only` branch.
- [ ] A proposal is produced, same shape as Scenario 3 — no price table.
- [ ] Telegram alert carries `🔀 The request read as '<x>', which is outside this client's
      'proposal_only' tier…`.
- [ ] The old failure mode is gone: no `Error: No pricing source for client '<id>'` from Module 3's
      `Resolve Config` node.

**Then** repeat against a `full_pipeline` client and confirm the feature the clamp must not break:
an explicit "only a price, no proposal" request still routes to `pricing_only`, and an explicit
"proposal only" still routes to `proposal_only` (Scenarios 2 and 3 are these cases).

## Scenario 7c — Contracted for pricing, no rate card (capability backstop)

Only reachable through misconfiguration: the tier says pricing, Drive says otherwise.

**Set** a test client's `service_tier` to `full_pipeline` and **clear** its `pricing_sheet_id`, then
send any RFQ.

Check:
- [ ] `Resolve Route`: `route = proposal_only`, `route_note` names the missing `pricing_sheet_id`.
- [ ] A proposal is produced; Module 3 never runs.

**Then** set `service_tier` to `pricing_only`, still with no `pricing_sheet_id`.

Check:
- [ ] `route = blocked_no_pricing`; the `Pricing Not Configured` Telegram alert fires.
- [ ] **Nothing is produced** — no Module 2, 3 or 4 call, no draft, no send.

Restore the `pricing_sheet_id` afterwards.

## Scenario 8 — Language selection

**Send** the RFQ in Spanish.

Check:
- [ ] Module 1: `language = es`.
- [ ] Module 4 uses `template_id_es` if set, else falls back to `template_id_en`.
- [ ] Narrative sections are written in Spanish.
- [ ] Money reads `3.823,20 €` in Spanish and `€3,823.20` in English — symbol position, decimal
      separator and grouping all follow the language, not the server locale.
- [ ] Scope labels are translated (`Instalación / Montaje`, not `Installation / Assembly`).

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
`service_tier`, template, pricing sheet and `notification_chat_id`. Send everything here to
**`proposal@cifral.io`** — mail to `demo@` resolves by destination instead (Scenario 12b).

- [ ] **Email from demo_client's address** → matched to `demo_client`; its template/sheet/chat used.
- [ ] **Email from acme_client's address** → matched to `acme_client`; ITS template/sheet/chat used.
- [ ] Draft **To:** is the sender in each case.
- [ ] Chat trigger (no sender) still falls back to `demo_client`.
- [ ] With `acme_client` still registered, run Scenario 12b's first case and confirm **none** of
      acme's ids appear in the run: not its template, pricing sheet, config sheet, folders or chat
      id. A stranger is served the demo tenant and nothing else.

## Scenario 12 — Unknown sender & inactive client (gating)

Send these to **`proposal@cifral.io`**, not to `demo@` — `demo@` is public and an unknown sender is
its normal case (Scenario 12b).

- [ ] **Email from an unregistered address** → no proposal; admin Telegram "sender is not in the
      client registry".
- [ ] Set the client's `Client Status` to `paused` (or `churned`) and email from their address →
      no proposal; admin Telegram "client is paused/churned".
- [ ] Set it back to `trial` → processed again; success Telegram shows `(trial)`.

## Scenario 12b — The public intake (`demo@cifral.io`)

The address anyone may write to, and the one that answers by itself. Background and rationale:
[`DEMO-INTAKE.md`](DEMO-INTAKE.md). **Everything here delivers a real email** — send from a mailbox
you can read.

- [ ] **RFQ from an address that is in no registry row, sent to `demo@cifral.io`** → a proposal IS
      produced, against `demo_client`'s demo template, and filed in its proposals folder.
- [ ] The message **arrives** at that unknown sender, threaded onto their message, **From**
      `demo@cifral.io`, with the `.docx` and the PDF attached. Telegram reads `SENT ✅`.
- [ ] Read the covering email as the prospect would: it is in the **RFQ's language**, it says it is
      a demonstration, and it says the template is adapted per client. It must not read as a
      reseller reviewing something "before it goes to the customer".
- [ ] Open the PDF: **DEMO** in the running header, the demo badge in the footer of every page, the
      demonstration line on the cover, and the "About this document" notice page after it.
- [ ] The same address emailing **`proposal@cifral.io`** is still rejected ("sender is not in the
      client registry"). Only the destination changed.
- [ ] A **registered** client emailing `demo@cifral.io` gets `demo_client`'s template, not their own
      — the destination decides.
- [ ] Set `demo_client`'s `send mode` to `draft` in Notion and re-run the first case → it **still
      sends**. The registry value is not consulted for the demo tenant. (Put it back afterwards.)
- [ ] Set `DEMO_SEND_MODE = 'draft'`, `npm run mirror`, re-import, re-run → it **drafts** at every
      branch: proposal, quote and missing-info reply. That is the rollback, and it is one line.
- [ ] Forward an RFQ to `demo@` from Mark's own address (the pre-change workaround) → still works,
      and now also sends.
- [ ] A `pricing_only` RFQ to `demo@` → the quote email quotes the **total only**. Confirm no
      `Subtotal:` line: that is the pre-margin cost basis and the reader here is the customer.

### The guards

- [ ] Send **four** RFQs from the same address within one UTC day → the first three are processed,
      the fourth produces no proposal and a Telegram "sender over the daily RFQ cap" with a detail
      line. Confirm Module 1 never ran on the fourth.
- [ ] Reply to one of your own RFQs with an **out-of-office** autoresponder (or send a message with
      `Precedence: bulk`) → nothing is produced and **no Telegram fires**. The execution log shows
      `Intake Guard: dropped (…)`.
- [ ] Send a message with a body of two words → dropped the same way.
- [ ] Send an RFQ with 12 attachments → refused, Telegram "too many attachments".
- [ ] Send a genuine RFQ with 2 attachments → processed normally.
- [ ] Paste a very long RFQ (over ~20 000 characters) → processed, and Module 1's input ends with
      `[intake guard: truncated …]`.

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

## Scenario 15 — Live sending and the per-client rollback switch

This is the `send_mode` **column** — the per-client kill switch on `proposal@`. Do it with
`commercial_contact_email` pointing at a mailbox you control.

> **`demo_client` cannot be used for this scenario.** The demo tenant does not read that column at
> all: its mode comes from `DEMO_SEND_MODE` in code, which is a different switch with a different
> rollback (Scenario 12b). Use a **second registry row** — `acme_client` from Scenario 11 — with
> `Client Status = active`, and send to `proposal@cifral.io`.

- [ ] Verify both aliases first (`DEPLOYMENT.md`) — otherwise this scenario is expected to fail at
      the send step, which is itself worth seeing once.
- [ ] Set `send_mode` = `send` on `acme_client`, run an RFQ from its registered address.
- [ ] **Send Draft** (or **Send Quote**) executes and returns a message `id` + `threadId`.
- [ ] The email **arrives** in the commercial mailbox, in the RFQ thread, from the right alias.
- [ ] Telegram reads `SENT ✅` and `Delivered as a reply in the original RFQ thread.`
- [ ] `Build Output → data`: `sent = true`, `sent_message_id` set, `draft_id` still recorded.
- [ ] Set `send_mode` back to `draft`, re-run → `Send Draft` is **skipped**, nothing arrives,
      `sent = false`, `sent_message_id = null`, Telegram reads `drafted 📝`.
- [ ] Remove the `send_mode` column value entirely (empty) → defaults to `send`. This permissive
      default is exactly why the demo tenant does not read this property at all
      ([`DEMO-INTAKE.md`](DEMO-INTAKE.md) §3).
- [ ] Repeat once on the `pricing_only` route (Scenario 2) to cover `Send Quote?` / `Send Quote`.

> **Failure mode to confirm once:** point `from_alias` at an unverified address and run in send mode.
> The draft is created but `Send Draft` fails with a Gmail error and the workflow errors out — the
> mail is never delivered from the wrong address. This is why `sent: false` in the output always
> means "deliberately not sent" and never "silently lost".

## Scenario 16 — The document is really structured (not just text that looks like it)

This is the point of the `.docx` engine, and the only way to check it is to open the file in Word.
Run a `full_pipeline` RFQ with `installation`, `commissioning` and `training` excluded, then open the
generated `.docx` from the proposals folder.

- [ ] **View → Navigation Pane** lists every chapter. If a chapter is missing from the pane, its
      heading is bold body text, not a real Heading 1 — fix the template, not the workflow.
- [ ] Click a bullet and press **Tab**: it re-indents as a list item. If it doesn't, the "bullets"
      are literal `•` characters.
- [ ] The implementation-plan, spare-parts and training chapters are **absent along with their
      headings** — no orphan heading, no blank gap.
- [ ] The requirements table has one row per requirement, and the quantity column is populated
      (regression guard for the legacy `quantity`/`qty` bug).
- [ ] The economic table has one row per priced category and the **amount column adds up to the
      total**.
- [ ] There is **no subtotal row**. The subtotal is the pre-margin cost basis and must never reach
      the end customer; the reseller sees it in the quote email instead.
- [ ] Ctrl+F for `undefined` and for `{` — both must find nothing. A hit means a template tag is
      misspelled (the renderer has no null-handling, so unknown tags print literally).
- [ ] Open the PDF attachment beside the `.docx`: headers, footers, logo and page breaks match.
- [ ] Both attachments are on the email — the editable `.docx` and the PDF.

## Scenario 17 — Template robustness

- [ ] Point `template_id_en` at a Google Doc instead of a `.docx` → **Render Docx** fails loudly
      (it is not a zip). Nothing is sent. This is the expected migration error for old templates.
- [ ] Misspell one tag in the template (e.g. `{cliente.empressa}`) → that spot renders `undefined`
      rather than failing. Confirms why Scenario 16's `undefined` search matters.
- [ ] Stop Gotenberg and run again → **Convert To PDF** fails, the run stops, and no half-finished
      proposal is sent.

---

## Scenario 18 — Tiers produce three different documents

Send the same RFQ three times, changing only the tier (set `default_tier` in the client's `Rules`
tab, or have the RFQ state that it answers a tender).

- **A** — around 11 chapters, no background, no technical-solution chapter, no continuity chapter.
- **B** — 14 chapters.
- **C** — adds the glossary and the tender compliance matrix annex.

In all three, chapter numbers run 1, 2, 3… with **no gaps**, and the contents list matches the
chapters actually present. A gap means numbering was assigned before chapters were dropped.

## Scenario 19 — The client's own text reaches the document

The point of the Proposal Config sheet is that a non-developer changes the output.

1. In the client's `Content` tab, change a warranty clause — add a distinctive phrase.
2. Re-run the same RFQ. **Deploy nothing.**
3. The phrase appears in the warranty chapter, word for word.
4. In the `Chapters` tab, rename a chapter and give it an `order` that moves it. Re-run: the heading,
   the contents list and the numbering all follow.

Then check the negative case, which matters more:

- Point a clause at a `chapter_id` that does not exist. The proposal is still produced, the clause is
  dropped, and the Telegram alert carries a config warning naming the row. A typo must cost one
  clause loudly, never apply everything silently.
- Clear `proposal_config_sheet_id` and re-run. The document still comes out — catalog structure, no
  client clauses — and the alert says `config_source: catalog_default` with a warning saying so.

## Scenario 20 — Boilerplate does not pass through an agent

Contract text must be byte-identical to the sheet.

1. Put an unusual, easily-searched sentence in a `condiciones_generales` clause.
2. Run a `full_pipeline` RFQ.
3. Search the output for that sentence. It must appear **exactly**, not paraphrased, not "improved".

Then confirm the QA agent respects the boundary: check `data.qa.findings` in the Module 2 output. If
A4 tried to patch a boilerplate section, there is a warning finding saying the patch was ignored —
and the document still has the original text.

## Scenario 21 — The agent chain stays consistent with itself

This is what the sequential A1 → A2 → A3 ordering buys, so it is worth checking once.

Run a brownfield RFQ ("the line cannot stop", staged replacement). Then read the document and ask:

- Does the execution plan's phasing match the architecture the technical chapter proposed?
- Does the executive summary describe *that* solution, rather than a generic one?
- Does the continuity chapter answer "will you stop my plant?" in plain words?

Then check `data.qa.findings` for `blocker` entries. A blocker means A4 found an invented commitment
or an unanswered RFQ requirement — read it before the proposal goes out.

## Quick offline check (no n8n)

Most of what can break is checkable in one command, in a few seconds, before anything touches Drive
or a customer:

```bash
npm install
npm run check
```

That runs, in order:

| Step | Asserts |
|---|---|
| `pricing_core.js` | The pricing formula, and that the price-table lines sum exactly to the total |
| `chapter_catalog.js` | Every catalog id is a safe Jexl identifier and unique; every table is declared and used; every scope item points at a real chapter; tiers grow A < B ≤ C; numbering has no gaps; the client sheet's include / rename / reorder and `applies_when` filtering all behave |
| `render_context.js` | **Totality** — every catalog key exists in the render context whether or not this request renders it. The render node has no null handling, so a missing key becomes the literal word `undefined` in a customer's document |
| `mirror-cores.js --check` | The three logic cores in `modules/` still match the five n8n Code nodes that run them |
| `render-sample.js` ×4 | Real docxtemplater renders of tiers A/B/C in Spanish and tier B in English, against the real templates, reading the real `demo_client` seed CSVs — failing on `undefined`, on stray braces, and on any config warning |

When the cores and the nodes disagree, fix it in the one safe direction:

```bash
npm run mirror     # repo -> n8n workflow JSON, core region only
```

The mirror script leaves each node's own wrapper alone and inlines `chapter-catalog.json` into the
Code nodes, which cannot read files.

## Regression checklist (after any workflow change)

- [ ] Scenarios 1, 2, 3 still produce the right deliverable for each route.
- [ ] Scenario 5 still blocks incomplete RFQs.
- [ ] Scenario 10 recipient safety still holds. **Do this one every time** — it is the only check
      standing between a config slip and a proposal landing in the end customer's inbox.
- [ ] Scope pruning (Scenario 4) still adds/removes chapters and price lines together.
- [ ] `npm run check` passes — cores, drift, and four real renders.
- [ ] Scenario 19: a change in the client's sheet still reaches the document with nothing deployed.
- [ ] Scenario 20: boilerplate is still verbatim and the QA agent still cannot patch it.
- [ ] Scenario 13 alias still follows Client Status; Scenario 14 replies still thread.
- [ ] Scenario 15 `send_mode` = `draft` still suppresses delivery.
