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

## 3. Create the Proposal Config sheet

This is the sheet that makes the client's proposals *theirs*: which chapters they use, what those
chapters are called, their contract clauses and exclusions, and their house style. Full reference:
`docs/CLIENT-DRIVE-SETUP.md`.

Create a Google Sheet in the client's folder with three tabs named exactly **`Chapters`**,
**`Content`** and **`Rules`**, and import `seed/demo_client/proposal-config/{chapters,content,rules}.csv`
into them as a starting point. Then **replace the seed clauses with the client's own** — the seed is
generic on purpose. Share it with the Google account n8n uses and record the id as
`proposal_config_sheet_id`.

You can validate the content offline before any of it reaches Drive: drop the CSVs in
`seed/<client_id>/proposal-config/` and run `npm run check`, which resolves them against the catalog
and renders real documents in all three tiers, failing on any warning.

Leaving this step out is allowed — the proposal falls back to the catalog structure with no
client-specific text. It is the difference between a well-organised generic document and theirs.

## 4. Build the master proposal template(s)

**Start from the seed, not from a blank page.** `templates/proposal-template-es.docx` and `-en.docx`
already contain all 105 conditional blocks correctly tagged; regenerate them with `npm run templates`
if the catalog has changed.

Copy one, then apply the client's fonts, colours, cover page, header, footer, logo and page setup —
ideally lifted from a proposal they already send. Leave the tags and the loop-tag placement alone.

Upload it to the client's Drive folder and record the file id as `template_id_en` (and
`template_id_es` for a Spanish variant). Set `proposals_folder_id` to the output folder.

Read the "one rule that decides whether lists work" section of `docs/TEMPLATE-GUIDE.md` before you
edit anything — loop tags written inline instead of on their own lines silently collapse every list
into one paragraph, and it looks like a data bug rather than a template one.

## 5. (Optional) Reference docs for grounding

Module 2 grounds generated sections in the client's real prior work. Put 5–10 approved past proposals
in a Drive folder and record its id as `reference_docs_folder_id`. More and better reference material
means more on-brand, less generic output. Leave empty to have Module 2 write conservatively.

This is separate from the Proposal Config sheet and does a different job: the sheet supplies text
that is used **verbatim**, the reference folder supplies examples the agents **learn tone from**.
Contract language belongs in the sheet, never here.

## 6. Verify

Run the manual test scenarios in `docs/TESTING-MANUAL.md` against the new `client_id`. Confirm at
minimum:
- a `full_pipeline` request produces a priced proposal to the **commercial contact** (not the end
  customer), with the right chapters present and out-of-scope chapters absent;
- the client's own clauses appear (search the document for a phrase only their sheet contains) and
  the Telegram alert reports `config_source: sheet` with no config warnings;
- changing a title in the `Chapters` tab and re-running changes the document, with nothing deployed;
- a `pricing_only` request produces just a price estimate;
- an incomplete RFQ is flagged for review instead of producing a document.

## Checklist

- [ ] Registry row: `client_id`, status, `service_tier`, `send_mode`.
- [ ] `commercial_contact_email` set to the reseller, not the end customer.
- [ ] Pricing Google Sheet created, shared, `pricing_sheet_id` recorded.
- [ ] Proposal Config sheet created from the seed CSVs, **clauses replaced with the client's own**,
      shared, `proposal_config_sheet_id` recorded.
- [ ] Master `.docx` template(s) copied from the seed and restyled; `template_id_en`/`_es` recorded.
- [ ] `proposals_folder_id` and `notification_chat_id` recorded.
- [ ] (Optional) reference-docs folder; `reference_docs_folder_id` recorded.
- [ ] Manual test scenarios pass; the reply goes to the right recipient, from the right alias, in
      the original thread.
- [ ] `send_mode` flipped to `send` only after those checks pass.
