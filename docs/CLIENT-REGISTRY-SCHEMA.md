# Client Registry (Notion) — Schema

The **client registry** is the single lookup each workflow uses to load a `client_id`'s operational
config (default service tier, recipient, template ids, folders, pricing sheet, notification target).
The orchestrator queries it **once** per RFQ and passes the result through the shared `client_config`
envelope.

> This is a **separate** Notion database. It is **not** the existing "Customers Manager" CRM (that
> one tracks the sales pipeline / outreach and must stay untouched).

## Where it lives

We repurpose the existing **"Projects"** database in the *Sales Wiki* teamspace as the client
registry.

- Database: **Projects** — `https://app.notion.com/p/2d7fe158febb8121a687d1d1595c9eee`
- Data source id: `2d7fe158-febb-8189-8ca1-000b610efd7d`

## Service tier, not module checkboxes

A client buys one of **three service tiers** — this is the offering, and it is the *default* for
their requests:

| `service_tier` | What the client gets | Modules used |
|----------------|----------------------|--------------|
| `pricing_only` | A price estimate only | M3 |
| `proposal_only` | A written technical proposal, no price | M1 + M2 + M4 |
| `full_pipeline` | Both — priced proposal | M1 + M2 + M3 + M4 |

The four internal modules are still the engineering building blocks (and the website's marketing
story), but they are **not** individually sold, so the registry no longer has per-module checkboxes.
Any single **request** can override the client's default by stating what it wants (`request_type`,
extracted by Module 1); `service_tier` is the fallback when a request doesn't say.

**The override may only narrow.** `service_tier` is a **ceiling**: a `full_pipeline` client can ask
for just a price on one RFQ, but a `proposal_only` client asking for pricing gets a proposal — they
did not buy pricing, and one misread email must not change that. Requests outside the tier fall back
to the tier and the substitution is reported in the Telegram alert.

Behind the clamp, a pricing route still needs a rate card (`pricing_sheet_id` here, or an inline
`client_config.rate_card`). A client contracted for pricing without one is a misconfiguration:
`full_pipeline` degrades to `proposal_only`, `pricing_only` stops with its own alert rather than
Module 3 throwing three modules deep. See `docs/ARCHITECTURE.md` § "Three service tiers".

## Properties

> **What the registry still owns, after the Proposal Config sheet grew a `Client` tab.**
> Notion says **who the client is and whether they may send**; the sheet says **what their document
> is made of**. So `template_id_en/_es`, `proposals_folder_id` and `reference_docs_folder_id` are now
> better set in the sheet (`docs/CLIENT-DRIVE-SETUP.md`) — the columns below stay as the fallback and
> are still read when the sheet's cell is empty, so no existing client breaks.
>
> Two things deliberately do **not** move:
> - `commercial_contact_email` — it is the key the incoming sender is matched against, and that has
>   to resolve before anyone knows which sheet to open.
> - `Client Status` and `send_mode` — the delivery gates. A copy-paste slip in a spreadsheet must not
>   be able to put a client into live sending.
>
> `pricing_sheet_id` also stays authoritative here: Module 3 never opens the Proposal Config sheet.

Registry-specific properties the workflows read:

| Property | Notion type | Purpose |
|----------|-------------|---------|
| `Client Name` | Title | Human-readable client name. |
| `client_id` | Rich text | Unique slug used as the lookup key, e.g. `demo_client`. |
| `Client Status` | Select: `active` / `trial` / `paused` / `churned` | Gates processing: `active`/`trial` are processed; `paused`/`churned` are rejected with an admin alert. Also picks the **sending address**: `trial` → `demo@cifral.io`, everything else → `proposal@cifral.io`. |
| `send_mode` | Select: `send` / `draft` (empty → `send`) | Delivery switch. `send` replies to the reseller for real; `draft` stops at a Gmail draft and sends nothing. The per-client rollback — set it to `draft` to take one client out of live sending without touching the workflows. **Not consulted for `demo_client` or for anything that arrived through `demo@cifral.io`:** those are forced to `draft` in code, because "empty → `send`" is a permissive failure mode and a public address cannot have one ([`docs/DEMO-INTAKE.md`](DEMO-INTAKE.md) §3). |
| `service_tier` | Select: `pricing_only` / `proposal_only` / `full_pipeline` | Default deliverable for this client. |
| `commercial_contact_email` | Email | **Client identity + reply key.** The sender address the client is recognized by (matched against the incoming email's `From`); also the fallback reply address. The draft/quote is sent to the actual sender, never the extracted end customer. Not used as the identity key for mail delivered to `demo@cifral.io` — that route resolves by destination instead. |
| `template_id_en` | Rich text | Fallback `.docx` template id for English proposals. Superseded by the sheet's `Templates` tab when it has a row. |
| `template_id_es` | Rich text | Fallback `.docx` template id for Spanish proposals (may be empty → EN fallback). Superseded by the sheet's `Templates` tab. |
| `proposals_folder_id` | Rich text | Google Drive folder to drop generated proposals into. |
| `reference_docs_folder_id` | Rich text | Google Drive folder of the client's approved docs / past proposals for Module 2 grounding. |
| `pricing_sheet_id` | Rich text | Google Sheet id holding this client's rate card (see `docs/PRICING-SHEET-TEMPLATE.md`). |
| `proposal_config_sheet_id` | Rich text | Google Sheet id holding this client's **Proposal Config** — which chapters they use, their clause library and their writing rules (see `docs/CLIENT-DRIVE-SETUP.md`). Empty is valid: the proposal falls back to the catalog defaults and the run records a warning. |
| `notification_chat_id` | Rich text | Telegram chat id for the "draft ready" / "needs review" alerts. |
| `Contract Start Date` | Date | Contract start. |
| `notes` | Rich text | Free-form notes. |

The DB's pre-existing `Customer Type`, `Tags`, `End Date`, and native `Status` properties are left in
place but are **not read by any workflow**.

> Neither the **rate card** nor the **chapter list** is a Notion column, and neither is a column's
> worth of text. Both live in Google Sheets in the client's Drive folder — `pricing_sheet_id` for the
> rate card, `proposal_config_sheet_id` for the chapter selection, clause library and writing rules —
> because they have to be editable by whoever owns the content, without a deployment.
>
> Which chapters appear in a given proposal is decided **per request** (scope of supply extracted by
> Module 1, plus the tier), filtered through that client's standing preferences from the sheet.

## Client identification & status gating

Identity comes from the address the message was **delivered to** first, and only then from the
sender. Full detail in [`docs/DEMO-INTAKE.md`](DEMO-INTAKE.md).

- **Delivered to `demo@cifral.io`** → `client_id` is **always `demo_client`**, whoever sent it. This
  address is public: an unknown sender is the normal case, not an error. Replies are forced to
  `draft`, and the intake guards (rate limit, junk filter, size cap) apply.
- **Delivered to `proposal@cifral.io`, or anything else** → the "Map Client Config" node finds the
  registry row whose `commercial_contact_email` matches the sender (case-insensitive) — that's the
  `client_id`. This is the original behaviour, unchanged.
- **Chat** trigger (no sender, no destination) → falls back to `demo_client` for local testing.

If both intake addresses appear in the recipients, `demo@` wins: it is the safer route, so an
ambiguous recipient list can never buy live sending.

- **Unknown sender** on the registry route (no row matches) → rejected; an admin Telegram alert
  fires, nothing is produced. On the public route this cannot happen — there is nothing to match.
- **`paused` / `churned`** → rejected the same way (client inactive), on both routes.
- **`active` / `trial`** → processed. The status is shown in the success Telegram alerts so trials are
  visible, and it selects the sending address (below).
- **Rate-limited, oversize, or over the attachment cap** (public route only) → refused before the
  registry is even read, with a Telegram alert. Autoresponders, bounces, mailing-list mail and empty
  bodies are dropped silently at the same point, on every route.

> ⚠️ **`demo_client` is the public tenant.** Its Drive folder is served verbatim to strangers, and
> Module 2 grounds its writing on the documents in `reference_docs_folder_id`. Keep that folder, its
> Proposal Config sheet, its pricing sheet and its `.docx` templates to **generic seed material
> only** — never a real client's proposal, rate card or clause text. Onboarding a real client means
> a new row, never reusing this one.

The reply address (`reply_to`) is the **actual sender**, so the quote/proposal goes back to whoever
emailed the RFQ. To onboard a trial client you only need a registry row with their sender email in
`commercial_contact_email`, `Client Status` = `trial`, and their `service_tier` + folder/sheet ids.

## Sender identity & delivery

Replies are **sent**, not parked as drafts, and they land **inside the reseller's original RFQ
thread** (the workflow keeps the incoming `threadId` and answers with `Re: <original subject>` —
Gmail needs both to thread).

| `Client Status` | Sends from |
|-----------------|------------|
| `trial` | `demo@cifral.io` |
| `active` (and any other processed status) | `proposal@cifral.io` |

Both addresses must be **verified "Send mail as" aliases** on the Gmail account that owns the n8n
Gmail credential — see `docs/DEPLOYMENT.md`. Gmail accepts an unverified alias at draft time but
rejects it on send, so an unverified alias fails loudly at the send step rather than quietly going
out from the wrong address.

> **Why draft-then-send.** The Gmail node's *Send Message* operation rebuilds the `From` header from
> the authenticated mailbox, discarding any alias. Only *Create Draft* honours `fromAlias`, so the
> workflow creates a draft and then fires `drafts.send` over HTTP. That is also what makes
> `send_mode: draft` a clean rollback: it simply skips the second step.

Set `send_mode` to `draft` for a client to keep the old review-before-sending behaviour. Leave it
empty (or `send`) for live delivery.

## Reading these properties safely

Every workflow reads the registry through a `prop()` helper. It normalises whatever n8n's Notion
node emits — a plain string, `{name}`, `{value}`, a raw `{type, select:{name}}`, a rich-text array —
down to **a string or `null`**, with booleans passed through.

That normalisation is load-bearing, not tidiness. Before it existed, `prop()` returned the raw object
for any shape it did not recognise, and two failures went unnoticed for months because both fail
toward the *permissive* answer: a `Select` that never matched a tier fell back to `full_pipeline`,
and an empty rich-text property arriving as `[]` (truthy) read as "configured". A `paused` client
would not have been rejected either. **When adding a property here, never compare its value without
going through `prop()`, and never test it for truthiness raw.**

## Property → `client_config` mapping

The "Map Client Config" node maps Notion properties into the envelope's `client_config`:

```
Client Name                → client_name
client_id                  → client_id
Client Status              → status  (+ derives from_alias: trial → demo@, else proposal@)
send_mode                  → send_mode  (normalised to 'send' | 'draft')
service_tier               → service_tier
commercial_contact_email   → commercial_contact_email
template_id_en/_es         → templates.{en,es}
proposals_folder_id        → proposals_folder_id
reference_docs_folder_id   → reference_docs_folder_id
pricing_sheet_id           → pricing_sheet_id
proposal_config_sheet_id   → proposal_config_sheet_id
notification_chat_id       → notification_chat_id
(pricing Google Sheet)     → rate_card         (read at runtime by Module 3, not from Notion)
(Proposal Config Sheet)    → proposal_config   (read at runtime by the orchestrator, not from Notion)
```

## DDL applied (Phase 7)

> ✅ **Applied** on 2026-07-23 via the Notion MCP `update-data-source` tool against data source
> `2d7fe158-febb-8189-8ca1-000b610efd7d`. Recorded here for reproducibility / disaster recovery.

```sql
ADD COLUMN "service_tier" SELECT('pricing_only':blue,'proposal_only':purple,'full_pipeline':green);
ADD COLUMN "pricing_sheet_id" RICH_TEXT;
DROP COLUMN "module_data_collection";
DROP COLUMN "module_content_generation";
DROP COLUMN "module_pricing";
DROP COLUMN "module_proposal_assembly";
DROP COLUMN "plan_tier";
```

(The Phase 5 DDL that first created the registry — `client_id`, `Client Status`,
`commercial_contact_email`, template/folder/chat columns, etc. — is unchanged; see the repo history.)

## DDL pending — live sending

> ⏳ **Not applied yet.** Run this against the same data source before switching any client to live
> sending. Until the column exists, `send_mode` resolves to its default (`send`) for every client.

```sql
ADD COLUMN "send_mode" SELECT('send':green,'draft':yellow);
ADD COLUMN "proposal_config_sheet_id" RICH_TEXT;
```

`proposal_config_sheet_id` is safe to add at any time: until a client has a value in it, proposals
resolve from the catalog defaults exactly as they did before.

Because the default is `send`, adding the column is not what turns delivery on — deploying the
updated workflows is. If you want a staged rollout, add the column **first** and set every existing
client to `draft`, then flip them to `send` one at a time.

## Seed row — `demo_client`

The `demo_client` row (page `3a4fe158-febb-816c-af5c-fd4f8e78efe0`) already exists from Phase 5.
**Finish it by hand** (TODO):

| Property | Set to |
|----------|--------|
| `service_tier` | `full_pipeline` |
| `send_mode` | `draft` while verifying the alias and threading; `send` once the checks in `docs/TESTING-MANUAL.md` pass |
| `pricing_sheet_id` | id of the client's pricing Google Sheet (create per `docs/PRICING-SHEET-TEMPLATE.md`) |
| `proposal_config_sheet_id` | id of the client's Proposal Config sheet (create per `docs/CLIENT-DRIVE-SETUP.md`, importing `seed/demo_client/proposal-config/*.csv`) |
| `commercial_contact_email` | the real reseller/commercial contact (currently a placeholder) |
| `template_id_en` | already set (`1szdkO1M…`) — update the doc to the master-template tokens (`docs/TEMPLATE-GUIDE.md`) |
| `reference_docs_folder_id` | optional — Drive folder of past proposals for grounding |
| `notification_chat_id` | already set (`1748634056`) |

## If you don't have Notion write access

Create the properties manually in the Notion UI using the table above, then fill the `demo_client`
row. The workflows only require the property **names** and **types** to match; "Map Client Config"
maps by name.
