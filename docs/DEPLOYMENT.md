# Deployment

This repo is the source of truth. Deploying means pushing the git-tracked `workflows/*.json` to the
live n8n instance. The live instance is a runtime target — never hand-edit workflows there and expect
them to survive; edit here, commit, deploy.

## Prerequisites

1. **n8n REST API access.** Set two environment variables (the deploy script refuses to run without
   them and never fabricates values):
   ```bash
   export N8N_API_URL="https://<your-n8n-host>"   # base URL, no trailing /api/v1
   export N8N_API_KEY="<your-api-key>"            # Settings → n8n API → create key
   ```
2. **Python deps:** `pip install requests` (deploy) and `pip install jsonschema` (smoke test).
3. **Credentials in n8n.** The workflows reference credentials that live in n8n itself (Gmail, Google
   Drive/Docs, Anthropic, Telegram, Notion). The deploy script pushes workflow *definitions*, not
   credentials — create/link those once in the n8n UI. See "Credential setup" below.

## Deploy

```bash
python scripts/deploy_workflows.py
```

The script:
- reads every `workflows/*.json`,
- looks up existing workflows by name via `GET /api/v1/workflows`,
- `POST /api/v1/workflows` to create a new one, or `PATCH /api/v1/workflows/{id}` to update an
  existing one (matched by name),
- prints a per-file created/updated/failed summary and exits non-zero on any failure.

It does **not** activate workflows or overwrite credentials.

## Credential setup (one-time, in the n8n UI)

| Node | Credential |
|------|------------|
| Gmail Trigger / Create a draft | Gmail OAuth2 |
| Google Drive Copy / Convert to PDF | Google Drive OAuth2 |
| Update RFQ Data / Update Generated Text | Google Docs OAuth2 |
| Anthropic Chat Model(s) | Anthropic API key |
| Send a text message | Telegram Bot API |
| Load Client Config | Notion API (integration token with access to the client registry DB) |

After the first deploy, open each workflow once and confirm the credential dropdowns are populated,
then activate the ones with live triggers (the orchestrator / Module 1 Gmail trigger).

## Order of operations for a fresh instance

1. Apply the Notion client-registry schema and seed `demo_client` (see `CLIENT-REGISTRY-SCHEMA.md`).
2. `deploy_workflows.py` to push all five workflows.
3. Link credentials in the n8n UI.
4. Run `scripts/smoke_test.py` locally to confirm the contracts still hold.
5. Activate the orchestrator trigger.

## What is intentionally out of scope

- No CI auto-deploy pipeline is wired here — deploy is a manual, explicit command.
- The deploy script will not run in this repo's dev environment because `N8N_API_URL` / `N8N_API_KEY`
  are not provided; supply them in the target environment.
