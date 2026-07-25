# Deployment

This repo is the source of truth. Deploying means importing the git-tracked `workflows/*.json` into
the live n8n instance **by hand** (there is no deploy script — you manage the import yourself). Edit
here, commit, then re-import the changed workflow.

## Import the workflows

1. In n8n: **Workflows → Import from File**, once per file:
   - `workflows/01-data-collection-validation.json`
   - `workflows/02-technical-content-generation.json`
   - `workflows/03-pricing-commercial-logic.json`
   - `workflows/04-proposal-assembly.json`
   - `workflows/00-orchestrator-end-to-end.json`
2. Open the **orchestrator** and repoint each **Call Module N** (Execute Workflow) node to the
   imported sub-workflow — select it by name in the node's workflow dropdown. The exported ids are
   placeholders (`REPOINT_…`) precisely so this is a conscious step.

## Link credentials (one-time, in the n8n UI)

| Node(s) | Credential |
|---------|------------|
| Gmail Trigger / Create Draft / Create Quote Draft | Gmail OAuth2 |
| Send Draft / Send Quote (HTTP Request) | Gmail OAuth2 — set *Authentication* = **Predefined Credential Type**, *Credential Type* = **Gmail OAuth2**, then pick the same credential |
| Copy Template / Convert to PDF / Search Reference Docs | Google Drive OAuth2 |
| Fill RFQ Placeholders / Fill Generated Content | Google Docs OAuth2 |
| Read Pricing Sheet | Google Sheets OAuth2 |
| Anthropic Chat Model(s) | Anthropic API key |
| RFQ Needs Review / Telegram Notify / Quote Alert | Telegram Bot API |
| Load Client Registry | Notion API (integration token with access to the client registry DB) |

Open each workflow once and confirm the credential dropdowns are populated. In **Read Pricing Sheet**
also confirm the sheet/tab selection (the demo reads the first tab).

## Verify the sending aliases (required before live sending)

Replies go out from `demo@cifral.io` (trial clients) or `proposal@cifral.io` (everyone else). Both
must be **verified "Send mail as" addresses** on the Gmail account that owns the Gmail OAuth2
credential — the same mailbox the Gmail Trigger polls.

1. In that Gmail account: **Settings → Accounts and Import → Send mail as → Add another email
   address**.
2. Add `demo@cifral.io` and `proposal@cifral.io`, then click the confirmation link Google mails to
   each one.
3. Confirm both show as *verified* in that list.

Gmail accepts an unverified alias when the **draft** is created but rejects it on **send**, so an
unverified alias surfaces as a failed `Send Draft` / `Send Quote` node — never as a mail quietly
going out from the wrong address. If you change the addresses, edit the `DEMO_FROM_ALIAS` /
`PROD_FROM_ALIAS` constants in **Map Client Config** in *both*
`00-orchestrator-end-to-end.json` and `04-proposal-assembly.json`.

> The OAuth2 credential needs a scope that permits sending (`gmail.modify` or `gmail.compose` — the
> `gmail.readonly` scope is not enough). If `drafts.send` returns 403, re-authorise the credential.

## Per-client data setup (not code)

All client variation is data, so a client is "deployed" by filling in config, not by editing
workflows:

1. **Notion registry** row — `service_tier`, `commercial_contact_email`, template/folder ids,
   `pricing_sheet_id`, `notification_chat_id`, `send_mode` (see `CLIENT-REGISTRY-SCHEMA.md`).
2. **Pricing Google Sheet** in the client's Drive folder (see `PRICING-SHEET-TEMPLATE.md`).
3. **Master Google Docs template(s)** with the placeholder tokens (see `TEMPLATE-GUIDE.md`).
4. (Optional) **Reference-docs folder** for Module 2 grounding.

## Order of operations for a fresh instance

1. Apply the Notion client-registry schema and fill `demo_client` (see `CLIENT-REGISTRY-SCHEMA.md`),
   including `send_mode` = `draft` so the first runs cannot send anything.
2. Create the pricing sheet and master template; record their ids in the registry.
3. Import all five workflows; repoint the orchestrator's Execute Workflow nodes.
4. Link credentials and verify the two sending aliases.
5. Run the manual test scenarios (`TESTING-MANUAL.md`).
6. Activate the orchestrator trigger (Gmail / chat).
7. Once the alias and threading checks pass, flip `send_mode` to `send` — per client, one at a time.

## What is intentionally out of scope

- No deploy script, no CI auto-deploy — import is a manual, explicit action you control.
- No multi-tenant admin UI — configuration is Notion + Google Drive files.
