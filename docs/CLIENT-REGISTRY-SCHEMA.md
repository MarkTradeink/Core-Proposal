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

## Properties

Registry-specific properties the workflows read:

| Property | Notion type | Purpose |
|----------|-------------|---------|
| `Client Name` | Title | Human-readable client name. |
| `client_id` | Rich text | Unique slug used as the lookup key, e.g. `demo_client`. |
| `Client Status` | Select: `active` / `trial` / `paused` / `churned` | Lifecycle state. |
| `service_tier` | Select: `pricing_only` / `proposal_only` / `full_pipeline` | Default deliverable for this client. |
| `commercial_contact_email` | Email | **Draft recipient** — the reseller/commercial contact, never the end customer. |
| `template_id_en` | Rich text | Google Docs master template id for English proposals. |
| `template_id_es` | Rich text | Google Docs master template id for Spanish proposals (may be empty → EN fallback). |
| `proposals_folder_id` | Rich text | Google Drive folder to drop generated proposals into. |
| `reference_docs_folder_id` | Rich text | Google Drive folder of the client's approved docs / past proposals for Module 2 grounding. |
| `pricing_sheet_id` | Rich text | Google Sheet id holding this client's rate card (see `docs/PRICING-SHEET-TEMPLATE.md`). |
| `notification_chat_id` | Rich text | Telegram chat id for the "draft ready" / "needs review" alerts. |
| `Contract Start Date` | Date | Contract start. |
| `notes` | Rich text | Free-form notes. |

The DB's pre-existing `Customer Type`, `Tags`, `End Date`, and native `Status` properties are left in
place but are **not read by any workflow**.

> Neither the **rate card** nor a **template section list** is a Notion column. The rate card lives
> in the client's **pricing Google Sheet** (`pricing_sheet_id`). Which sections appear in a proposal
> is decided **per request** by its scope of supply (extracted by Module 1 against
> `schemas/scope-catalog.json`), not per client — so there is no per-client section column.

## Property → `client_config` mapping

The "Map Client Config" node maps Notion properties into the envelope's `client_config`:

```
Client Name                → client_name
client_id                  → client_id
Client Status              → status
service_tier               → service_tier
commercial_contact_email   → commercial_contact_email
template_id_en/_es         → templates.{en,es}
proposals_folder_id        → proposals_folder_id
reference_docs_folder_id   → reference_docs_folder_id
pricing_sheet_id           → pricing_sheet_id
notification_chat_id       → notification_chat_id
(pricing Google Sheet)     → rate_card  (read at runtime by Module 3, not from Notion)
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

## Seed row — `demo_client`

The `demo_client` row (page `3a4fe158-febb-816c-af5c-fd4f8e78efe0`) already exists from Phase 5.
**Finish it by hand** (TODO):

| Property | Set to |
|----------|--------|
| `service_tier` | `full_pipeline` |
| `pricing_sheet_id` | id of the client's pricing Google Sheet (create per `docs/PRICING-SHEET-TEMPLATE.md`) |
| `commercial_contact_email` | the real reseller/commercial contact (currently a placeholder) |
| `template_id_en` | already set (`1szdkO1M…`) — update the doc to the master-template tokens (`docs/TEMPLATE-GUIDE.md`) |
| `reference_docs_folder_id` | optional — Drive folder of past proposals for grounding |
| `notification_chat_id` | already set (`1748634056`) |

## If you don't have Notion write access

Create the properties manually in the Notion UI using the table above, then fill the `demo_client`
row. The workflows only require the property **names** and **types** to match; "Map Client Config"
maps by name.
