# Onboarding a New Client

Concrete steps to bring a new paying client onto the pipeline. Everything is config-driven, so
onboarding is data entry + a rate-card file — no code changes for a standard client.

## 1. Create the Notion registry row

In the client registry ("Projects" DB — see `CLIENT-REGISTRY-SCHEMA.md`), add a row:

- `Client Name`, `client_id` (a unique slug, lowercase, e.g. `acme_intralogistics`).
- `Client Status` = `trial` (or `active`).
- `plan_tier` = `single_module` or `full_pipeline`.
- Check the `module_*` boxes for the modules they bought.
- `commercial_contact_email` = **the reseller/commercial contact who forwards RFQs** (this is the
  draft recipient — never the end customer).
- `notification_chat_id` = their Telegram chat id for alerts.
- Leave template / folder ids for step 4.

## 2. Gather the rate card into a config file

Copy `modules/pricing/example_client_config.json` to a new file for the client and fill in:

- `rate_by_category` — hourly rate per labor category (e.g. `engineering`, `assembly`,
  `commissioning`, `project_management`).
- `margin_pct`, `risk_pct`, `discount_pct` — as fractions (`0.20` == 20%). `discount_pct` defaults to
  `0` unless a standing discount applies.
- `payment_terms` — the commercial terms string (e.g. `"30% advance / 40% on delivery / 30% on
  commissioning"`).
- `currency` — ISO code (e.g. `EUR`).

Validate the config by running the pricing engine against it (see `modules/pricing/`), then keep the
rate card with the client's config. **Do not** invent rates — get them signed off by the client.

## 3. Gather 3–5 past proposals for content grounding

Module 2 grounds generated sections in the client's real prior work. Collect 3–5 of their approved
past proposals (or approved scope/technical documents), put them in a dedicated Google Drive folder,
and record that folder's id as `reference_docs_folder_id` in the registry row. More/better reference
material = more on-brand, less generic output.

## 4. Register the Google Docs template

- Get the client's own proposal template as a Google Doc containing the placeholders the workflows
  replace: `{{NUMERO_PROPUESTA}}`, `{{FECHA}}`, `{{CLIENTE_EMPRESA}}`, `{{CLIENTE_CONTACTO}}`,
  `{{PROYECTO_TIPO}}`, `{{PROYECTO_UBICACION}}`, `{{PROYECTO_PLAZO}}`, `{{REQUISITOS_LISTA}}`,
  `{{ALCANCE_TECNICO}}`, `{{PLAN_IMPLANTACION}}`, `{{RESUMEN_COMERCIAL}}`.
- Record its Doc id as `template_id_en` (and `template_id_es` if they have a Spanish variant).
- Create/choose a Google Drive folder for generated proposals and record it as `proposals_folder_id`.

## 5. Verify

- Run `python scripts/smoke_test.py` (point the fixture at the new `client_id`) to confirm every
  stage's output shape holds.
- Send a test RFQ through the orchestrator and confirm: the draft lands in the **commercial contact's**
  inbox (not the end customer), the correct-language template is used, and the Telegram alert fires.

## Checklist

- [ ] Registry row created with `client_id`, status, plan tier, module checkboxes.
- [ ] `commercial_contact_email` set to the reseller, not the end customer.
- [ ] Rate-card config file filled in and validated by the pricing engine.
- [ ] 3–5 reference proposals in a Drive folder; `reference_docs_folder_id` recorded.
- [ ] Google Docs template(s) with placeholders; `template_id_en`/`_es` recorded.
- [ ] `proposals_folder_id` and `notification_chat_id` recorded.
- [ ] Smoke test passes; test RFQ produces a draft to the right recipient.
