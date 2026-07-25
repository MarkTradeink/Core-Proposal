# Onboarding a New Client

Everything is config-driven, so onboarding is data entry across Notion + Google Drive — **no code
changes** for a standard client.

## 1. Create the Notion registry row

In the client registry ("Projects" DB — see `CLIENT-REGISTRY-SCHEMA.md`), add a row:

- `Client Name`, `client_id` (a unique slug, lowercase, e.g. `acme_intralogistics`).
- `Client Status` = `trial` (or `active`). `paused`/`churned` clients are rejected (no output);
  `active` and `trial` are both processed. The status also picks the sending address: `trial` sends
  from `demo@cifral.io`, everything else from `proposal@cifral.io`.
- `send_mode` = `draft` while you validate the client's setup — replies are held in the mailbox
  instead of going out. Switch to `send` (or leave it empty) once you've run the checks.
- `service_tier` = `pricing_only` / `proposal_only` / `full_pipeline` — their **default** deliverable
  (any individual request can still override it).
- `commercial_contact_email` = **the address the client emails you from.** The system matches the
  incoming email's sender against this to identify the client, and replies with the quote/proposal
  **inside that same email thread** — never to the extracted end customer. Must be the real address
  they send from.
- `notification_chat_id` = their Telegram chat id for alerts.
- Leave template / folder / sheet ids for the steps below.

## 2. Create the pricing Google Sheet

In the client's Google Drive folder, create a **Pricing Rules** sheet following
`docs/PRICING-SHEET-TEMPLATE.md` (columns `type | key | value`: rate rows per labour category, param
rows for margin/risk/discount/terms/currency). Share it with the Google account n8n uses, then paste
its id into `pricing_sheet_id`. **Do not invent rates** — get them signed off by the client.

Sanity-check the math locally if you like: `node modules/pricing/pricing_core.js`.

## 3. Build the master proposal template(s)

Create the client's proposal template as a **Google Doc** containing the placeholder tokens from
`docs/TEMPLATE-GUIDE.md` — the always-filled tokens (`{{CLIENTE_EMPRESA}}`, `{{ALCANCE_TECNICO}}`,
`{{ALCANCE_SUMINISTRO}}`, …) and the scope-gated section tokens (`{{SECCION_REPUESTOS}}`,
`{{SECCION_GARANTIA}}`, `{{SECCION_ECONOMICA}}`, …). It is a **superset**: include every section the
client might offer; each request prunes the ones out of scope. Record the Doc id as `template_id_en`
(and `template_id_es` for a Spanish variant). Set `proposals_folder_id` to the output folder.

## 4. (Optional) Reference docs for grounding

Module 2 grounds generated sections in the client's real prior work. Put 3–5 approved past proposals
in a Drive folder and record its id as `reference_docs_folder_id`. More/better reference material =
more on-brand, less generic output. Leave empty to have Module 2 write conservatively.

## 5. Verify

Run the manual test scenarios in `docs/TESTING-MANUAL.md` against the new `client_id`. Confirm at
minimum:
- a `full_pipeline` request produces a priced proposal to the **commercial contact** (not the end
  customer), with the right sections present and out-of-scope sections absent;
- a `pricing_only` request produces just a price estimate;
- an incomplete RFQ is flagged for review instead of producing a document.

## Checklist

- [ ] Registry row: `client_id`, status, `service_tier`, `send_mode`.
- [ ] `commercial_contact_email` set to the reseller, not the end customer.
- [ ] Pricing Google Sheet created, shared, `pricing_sheet_id` recorded.
- [ ] Master Google Docs template(s) with tokens; `template_id_en`/`_es` recorded.
- [ ] `proposals_folder_id` and `notification_chat_id` recorded.
- [ ] (Optional) reference-docs folder; `reference_docs_folder_id` recorded.
- [ ] Manual test scenarios pass; the reply goes to the right recipient, from the right alias, in
      the original thread.
- [ ] `send_mode` flipped to `send` only after those checks pass.
