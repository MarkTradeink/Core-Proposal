# Client Registry (Notion) — Schema

The **client registry** is the single lookup each workflow uses to decide which modules are active
for a `client_id` and to load that client's operational config (recipient, template ids, folders,
notification target). The orchestrator queries it **once** per RFQ and passes the result through the
shared `client_config` envelope.

> This is a **new, separate** Notion database. It is **not** the existing "Customers Manager" CRM
> (that one tracks the sales pipeline / outreach and must stay untouched).

## Where it lives

We repurpose the existing empty **"Projects"** database in the *Sales Wiki* teamspace as the client
registry.

- Database: **Projects** — `https://app.notion.com/p/2d7fe158febb8121a687d1d1595c9eee`
- Data source id: `2d7fe158-febb-8189-8ca1-000b610efd7d`

## Properties

Registry-specific properties (the ones the workflows read):

| Property | Notion type | Purpose |
|----------|-------------|---------|
| `Client Name` | Title | Human-readable client name (was the DB's `Name` title). |
| `client_id` | Rich text | Unique slug used as the lookup key, e.g. `demo_client`. |
| `Client Status` | Select: `active` / `trial` / `paused` / `churned` | Lifecycle state. |
| `plan_tier` | Select: `single_module` / `full_pipeline` | Which offering the client bought. |
| `module_data_collection` | Checkbox | Module 1 active for this client. |
| `module_content_generation` | Checkbox | Module 2 active. |
| `module_pricing` | Checkbox | Module 3 active. |
| `module_proposal_assembly` | Checkbox | Module 4 active. |
| `commercial_contact_email` | Email | **Draft recipient** — the reseller/commercial contact, never the end customer. |
| `template_id_en` | Rich text | Google Docs template id for English proposals. |
| `template_id_es` | Rich text | Google Docs template id for Spanish proposals (may be empty → EN fallback). |
| `proposals_folder_id` | Rich text | Google Drive folder to drop generated proposals into. |
| `reference_docs_folder_id` | Rich text | Google Drive folder of the client's approved docs / past proposals for Module 2 grounding. |
| `notification_chat_id` | Rich text | Telegram chat id for the "draft ready" / "needs review" alerts. |
| `Contract Start Date` | Date | Contract start (was the DB's `Start Date`). |
| `notes` | Rich text | Free-form notes. |

The DB's pre-existing `Customer Type`, `Tags`, `End Date`, and native `Status` properties are left in
place but are **not read by any workflow** — they are harmless leftovers from the "Projects" board and
can be removed later if desired.

> The **rate card** is intentionally *not* a Notion column. Rate cards are structured nested data
> (rate-per-category, margins) that live better as a config file. For the demo it is in
> `modules/pricing/example_client_config.json`; in production it ships with the client's config. The
> registry can hold a pointer to it if needed, but the pricing engine consumes the config object.

## Property → `client_config` mapping

The "Load Client Config" node maps Notion properties into the envelope's `client_config`:

```
Client Name                → client_name
client_id                  → client_id
Client Status              → status
plan_tier                  → plan_tier
module_*                   → modules.{data_collection,content_generation,pricing,proposal_assembly}
commercial_contact_email   → commercial_contact_email
template_id_en/_es         → templates.{en,es}
proposals_folder_id        → proposals_folder_id
reference_docs_folder_id   → reference_docs_folder_id
notification_chat_id       → notification_chat_id
(rate card config file)    → rate_card
```

## DDL to apply

Applied via the Notion MCP `update-data-source` tool against data source
`2d7fe158-febb-8189-8ca1-000b610efd7d`:

```sql
RENAME COLUMN "Name" TO "Client Name";
RENAME COLUMN "Start Date" TO "Contract Start Date";
ADD COLUMN "client_id" RICH_TEXT;
ADD COLUMN "Client Status" SELECT('active':green,'trial':blue,'paused':yellow,'churned':gray);
ADD COLUMN "plan_tier" SELECT('single_module':gray,'full_pipeline':green);
ADD COLUMN "module_data_collection" CHECKBOX;
ADD COLUMN "module_content_generation" CHECKBOX;
ADD COLUMN "module_pricing" CHECKBOX;
ADD COLUMN "module_proposal_assembly" CHECKBOX;
ADD COLUMN "commercial_contact_email" EMAIL;
ADD COLUMN "template_id_en" RICH_TEXT;
ADD COLUMN "template_id_es" RICH_TEXT;
ADD COLUMN "proposals_folder_id" RICH_TEXT;
ADD COLUMN "reference_docs_folder_id" RICH_TEXT;
ADD COLUMN "notification_chat_id" RICH_TEXT;
ADD COLUMN "notes" RICH_TEXT;
```

## Seed row — `demo_client`

Seeded from the legacy demo's hardcoded ids:

| Property | Value |
|----------|-------|
| `Client Name` | Demo Client |
| `client_id` | `demo_client` |
| `Client Status` | `trial` |
| `plan_tier` | `full_pipeline` |
| `module_*` | all checked |
| `commercial_contact_email` | *(placeholder — needs the real reseller contact; TODO)* |
| `template_id_en` | `1szdkO1MVKVsIXizYQd_x-6WJMP8OPK50oSif4Uw5LQA` |
| `template_id_es` | *(empty — EN fallback until an ES template exists; TODO)* |
| `proposals_folder_id` | `1vmm_AQf8FGtc7E_ujJsetwNpuzzVXCxc` |
| `reference_docs_folder_id` | *(placeholder — needs the client's docs folder; TODO)* |
| `notification_chat_id` | `1748634056` |

## If you don't have Notion write access

If the DDL cannot be applied from your environment, create the properties manually in the Notion UI
using the table above, then add the `demo_client` row. The workflows only require the property
**names** and **types** to match; the "Load Client Config" node maps by name.
