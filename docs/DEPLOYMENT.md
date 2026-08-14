# Deployment

> **The workflow JSON in this repo mirrors the live n8n layout.** It carries the deployed node
> positions, node ids, `settings` (including the error workflow) and credential references, so an
> import lands laid out the way it was left and with credentials already linked — nothing to drag
> around and nothing to re-pick from a dropdown.
>
> That only stays true if it is maintained in that direction. **After changing a workflow by hand in
> n8n, pull it back** rather than letting the repo drift: the repo is the source of truth for logic,
> and the live instance is the source of truth for layout. Where the two disagree on *logic*, the
> repo wins; where they disagree on *placement*, live wins.

This repo is the source of truth. Deploying means importing the git-tracked `workflows/*.json` into
the live n8n instance **by hand** (there is no deploy script — you manage the import yourself). Edit
here, commit, then re-import the changed workflow.

## Prerequisites (one-time, before importing)

Module 4 renders Word documents, which needs two things the base n8n image doesn't have.

**1. The docxtemplater community node.** In n8n: **Settings → Community Nodes → Install**, package
name `n8n-nodes-docxtemplater`. It bundles docxtemplater and pizzip, so nothing has to be installed
in the container and no environment variable is needed. (This instance already runs other community
node packages, so the mechanism is proven here.)

**2. A Gotenberg service** for the .docx → PDF conversion. Add it beside n8n in your compose file:

```yaml
  gotenberg:
    image: gotenberg/gotenberg:8
    restart: unless-stopped
```

It needs no volumes, no credentials and no published ports — only n8n talks to it, over the internal
network. Module 4's **Convert To PDF** node points at `http://gotenberg:3000/forms/libreoffice/convert`;
if your service name or network differs, change that URL in that one node.

Check it from the n8n container with `curl -F files=@test.docx http://gotenberg:3000/forms/libreoffice/convert -o out.pdf`.

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
| Download Template / Upload Docx To Drive / Search Reference Docs | Google Drive OAuth2 |
| Read Pricing Sheet | Google Sheets OAuth2 |
| Render Docx | none (community node) |
| Convert To PDF | none (Gotenberg needs no auth on the internal network) |
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
3. **Master `.docx` template(s)** with the docxtemplater tags (see `TEMPLATE-GUIDE.md`), uploaded to
   the client's Drive folder — `template_id_en`/`_es` point at a Word file, not a Google Doc.
4. (Optional) **Reference-docs folder** for Module 2 grounding.

## Order of operations for a fresh instance

1. Install the docxtemplater community node and bring up Gotenberg (above).
2. Apply the Notion client-registry schema and fill `demo_client` (see `CLIENT-REGISTRY-SCHEMA.md`),
   including `send_mode` = `draft` so the first runs cannot send anything.
3. Create the pricing sheet and the `.docx` template; record their ids in the registry.
4. Import all five workflows; repoint the orchestrator's Execute Workflow nodes.
5. Link credentials and verify the two sending aliases.
6. Run the manual test scenarios (`TESTING-MANUAL.md`).
7. Activate the orchestrator trigger (Gmail / chat).
8. Once the alias, threading and document checks pass, flip `send_mode` to `send` — per client, one
   at a time.

## What is intentionally out of scope

- No deploy script, no CI auto-deploy — import is a manual, explicit action you control.
- No multi-tenant admin UI — configuration is Notion + Google Drive files.

## Troubleshooting Module 4

| Symptom | Cause |
|---------|-------|
| `undefined` appears in the generated document | A tag name in the template doesn't match the render context. The render node has no `nullGetter`, so unknown tags print literally. Check the spelling against `TEMPLATE-GUIDE.md`. |
| Bullets come out as one run-on paragraph | Loop tags written inline instead of on their own lines. See "The one rule that decides whether lists work" in `TEMPLATE-GUIDE.md`. |
| `Multi error` / `Unopened tag` from Render Docx | Word split a tag across text runs, usually after autocorrect. Retype the tag in one go. |
| Convert To PDF times out or refuses the connection | Gotenberg isn't running or isn't on the same docker network as n8n. |
| Convert To PDF returns 400 | The uploaded file didn't end in `.docx` — Gotenberg picks its converter from the extension. Check `outputFileName` on Render Docx. |
