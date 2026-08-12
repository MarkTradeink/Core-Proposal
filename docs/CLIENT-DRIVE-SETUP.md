# The client's Drive folder — how a client's proposals get personalised

Everything about *how a client's proposals read* is configured in that client's own Google Drive
folder, not in this repo. Which chapters they use, what those chapters are called, their contract
clauses, their exclusions, their house style — all of it is data a salesperson can change in a
spreadsheet, with no deployment and no developer.

This is the same split already used for pricing:

| | Repo (versioned, mirrored into the n8n Code nodes) | Drive (editable, no deploy) |
|---|---|---|
| **Price** | `modules/pricing/pricing_core.js` — the formula | `Pricing Rules` sheet — the numbers |
| **Proposal** | `schemas/chapter-catalog.json` — the structure | `Proposal Config` sheet — the selection and the text |

## The folder

```
Google Drive / Clients / <Client Name> /
├── Templates/              the client's .docx variants
├── Generated Proposals/    Module 4 output (.docx + .pdf)
├── Reference Docs/         approved past proposals, for grounding
├── Proposal Config         Google Sheet — this document, SIX tabs
├── <client>-setup-guide    generated from the sheet — what this client is configured to do
├── <client>-rfq-template   generated from the sheet — the email to send, with the exact labels
└── Pricing Rules           Google Sheet — docs/PRICING-SHEET-TEMPLATE.md
```

The two generated documents come from `node scripts/client-docs.js <client_id>`. Regenerate them
whenever the sheet changes — especially the RFQ template, whose labels have to match the `Fields`
tab exactly (see below).

Copy the Proposal Config sheet's id from its URL
(`https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`) into the client's
**`proposal_config_sheet_id`** in the Notion registry.

**A client with no Proposal Config sheet still works.** The chapter structure falls back to the
catalog defaults and the proposal comes out with no client-specific clauses or writing rules. The run
records a warning saying exactly that, so nobody mistakes a default-structure draft for the client's
real boilerplate.

## Getting started

`seed/demo_client/proposal-config/` holds six CSVs with a complete, industry-neutral starting set in
Spanish and English. Create a Google Sheet with six tabs named **exactly** as below and import one
CSV into each (File → Import → *Insert new sheet*, then rename the tab). Share the sheet with the
Google account n8n uses.

| Tab | What it decides |
|---|---|
| **`Client`** | Drive folder ids and document metadata — what used to be Notion columns |
| **`Templates`** | which `.docx` this client renders, and when |
| **`Fields`** | this client's own cover/footer variables |
| **`Chapters`** | which chapters they use, in what order, under what name |
| **`Content`** | their clauses, exclusions, assumptions, obligations and glossary |
| **`Rules`** | their house style |

The tab names are read literally. A tab named `Chapters ` or `Capítulos` is not found, the config
falls back to the catalog defaults, and the only sign is `config_source: catalog_default` in the
Telegram alert — so check that on the first run.

Then replace the seed text with the client's own. The seed is deliberately generic; the value comes
from putting the client's real terms in.

---

## Tab — `Client`

Two columns, `key` and `value`. This is where the ids that used to live in the Notion registry now
live, so that everything about a client's *document* is in one place they can edit.

| `key` | What it does |
|---|---|
| `proposals_folder_id` | Drive folder the generated `.docx` and `.pdf` are written to |
| `reference_docs_folder_id` | Drive folder of approved past proposals, for Module 2's grounding |
| `pricing_sheet_id` | Rate-card sheet. **Module 3 still reads the Notion column** — it never opens this sheet — so set it in both places if you use pricing |
| `document_version` | Version on the cover, in the footer and in the version-control table. Defaults to `1.0` |
| `author` | Initials for the version-control table's *author* column |
| `default_language` | Only used by `scripts/client-docs.js` when generating this client's guide |

Every one of these falls back to its Notion column when the cell is empty, so a client set up before
this tab existed keeps working untouched.

> **What stays in Notion, and why.** Identity and the delivery gates: `client_id`, `Client Status`,
> `send_mode`, `service_tier`, `commercial_contact_email`, `notification_chat_id` and the id of this
> sheet. `commercial_contact_email` *cannot* move here — it is the key the incoming email is matched
> against, and that has to be resolved before anyone knows which sheet to open. The rest stay out on
> purpose: a copy-paste slip in a spreadsheet should not be able to put a client into live sending.

---

## Tab — `Templates`

Which `.docx` gets rendered. A client is not one template per language: they have product lines, and
a tender answers to a different document than a spare-parts quotation.

| Column | What it does |
|---|---|
| `variant` | A name of your choosing, e.g. `retrofit`. Empty means `default` |
| `lang` | `es` or `en` |
| `file_id` | The Drive file id of the `.docx`. A row with no `file_id` is ignored, with a warning |
| `match` | Comma-separated keywords. If one appears in the request, this variant is chosen |
| `default` | `yes` marks the fallback for that language |
| `notes` | For humans |

Selection order, most specific first:

1. a variant the request asked for by name;
2. a `match` keyword found in the request — the project title and type, the notes, and the
   requirement lines (not the raw email, so it behaves the same whether a module runs standalone or
   from the orchestrator);
3. the `default` row for the proposal's language;
4. any row in that language, then the other language;
5. the registry's `template_id_es` / `template_id_en`.

Leave the tab empty and step 5 is all that happens — exactly the old behaviour. Which template was
chosen, and why, is reported in the Telegram alert.

---

## Tab — `Fields`

**This is the tab that makes a cover page theirs.** The catalog owns the chapters; this owns
everything around them that only this client has — an offer number out of their ERP, an asset
number, the legal name in their footer.

Each row becomes a template tag: `{campos.<key>}`.

| Column | What it does |
|---|---|
| `key` | The tag name. Lowercase letters, digits and `_` only — tags are Jexl expressions, so a `-` reads as subtraction and an accent breaks the tag |
| `source` | `static`, `request` or `auto` — see below |
| `value` | For `static`, the literal text. For `auto`, which computed value to use |
| `capture_label` | For `request`: the label(s) to look for, comma-separated alternatives |
| `required` | `yes` stops the proposal when the value is missing |
| `notes` | For humans |

### The three sources

| `source` | Where the value comes from |
|---|---|
| `static` | The `value` cell. Their legal name, a copyright line — things that do not change per request |
| `request` | Read out of the RFQ email by label |
| `auto` | Something the pipeline already computed: `proposal_number`, `date`, `version`, `tier`, `language`, `client_company`, `client_contact`, `client_email`, `client_phone`, `project_title`, `project_type`, `project_location`, `project_deadline` |

### How `request` capture works, and why there is no model in it

These values are **identifiers**. A hallucinated offer number is worse than a missing one: it lands
on the cover of a document that goes to a customer, it looks entirely plausible, and nobody catches
it. So capture is a labelled-value match and nothing else.

- The label must start its line, or follow another label on the same line. Both work, because a
  header block pasted out of an ERP puts several on one line.
- Case, accents and the `º`/`°` ordinal marks are all folded — `Oferta nº`, `OFERTA Nº` and
  `Oferta n°` are the same label.
- The value ends at the next label — **including one this client never declared**, so
  `Oferta nº: 905149921  Versión: 1.0` does not put the version inside the offer number.
- A label with nothing after it counts as absent, not as an empty value.
- The longest matching label wins, so `Project number` beats `Project`.

A `required` field the sender did not supply appends `custom_fields.<key>` to the RFQ's
`missing_fields` and marks it **incomplete** — the run stops for review instead of shipping a cover
with a hole in it.

### Keep the labels and the RFQ template in sync

Capture works by matching a string, so the label in this tab and the label in the email have to be
the same string. Do not maintain that by hand — run:

```bash
node scripts/client-docs.js <client_id>
```

It reads this tab and writes the client's own RFQ email template with the exact labels, plus a setup
guide listing every `{campos.*}` tag their template may use. Written by hand, those two drift the
first time you add a field, and the failure is silent: the cover simply comes out blank.

> A `{campos.*}` tag for a key this tab does *not* declare prints the literal word `undefined` into
> the customer's document. It is the one thing the totality rule cannot cover — there is nothing to
> enumerate — which is why the generated guide lists the valid tags.

---

## Tab 1 — `Chapters`

Which chapters this client uses, in what order, under what name. **Every row is an override**: leave
the sheet empty and the catalog decides everything.

| Column | What it does |
|---|---|
| `chapter_id` | An id from `schemas/chapter-catalog.json`. Applies to chapters *and* subsections. |
| `include` | `yes` forces the chapter in, `no` forces it out. **Empty means "let the catalog decide"** — which is usually what you want, because the catalog already drops chapters that are out of tier or out of scope. |
| `order` | A number that moves the chapter. Chapters are ordered by this value; the catalog uses multiples of ten, so `15` puts something between chapter 1 and chapter 2. Leave empty to keep the default position. |
| `title_es` / `title_en` | Rename the chapter. Empty keeps the catalog title. |
| `tier` | Reserved for per-chapter tier overrides. Leave empty. |
| `notes` | For humans. Nothing reads it. |

An unknown `chapter_id` is ignored and reported as a warning — it does not silently do nothing.

### Adding a chapter the catalog does not have

The catalog is a closed vocabulary: an id that is not in it has no agent that knows how to write it
and no block in the template to render it. For genuinely client-specific chapters there are five
reserved slots, `custom_1` … `custom_5`. Their title comes from this tab and their body from the
`Content` tab, and no agent touches them:

```
chapter_id | include | order | title_es          | title_en
custom_1   | yes     | 15    | Por qué nosotros  | Why us
```

If a client needs a *sixth*, or needs a chapter that an agent should write, that is a catalog change
in the repo — talk to whoever maintains it.

---

## Tab 2 — `Content`

The client's own text. This is where warranty terms, exclusions, assumptions and general conditions
live.

| Column | What it does |
|---|---|
| `kind` | `clause`, `exclusion`, `premise`, `obligation` or `term` — see below. |
| `id` | A stable id, e.g. `exc_04`. Used so a change order can cite "assumption 3", and so you can find the row again. |
| `chapter_id` | Which chapter or subsection this attaches to. |
| `lang` | `es` or `en`. A row only appears in a proposal of that language. Leave empty for both. |
| `applies_when` | When this row applies — see the token list below. Empty means always. |
| `title` | Optional lead-in. For `term` rows this is the term itself. |
| `body` | The text. |

### The five kinds

| `kind` | Where it lands |
|---|---|
| `clause` | Merged into that chapter's prose, in sheet order. |
| `exclusion` | A numbered row in the exclusions table (`10.2`). |
| `premise` | A numbered row in the assumptions table (`10.1`). |
| `obligation` | A numbered row in the client-obligations table (`9.5`). |
| `term` | A row in the glossary — `title` is the term, `body` the definition. |

Numbering is automatic and gapless: the rows that apply to *this* request are numbered 1…n, so
assumption 3 is always the third assumption the customer can actually see.

### Writing the body

Same plain-text convention the generated sections use:

- Paragraphs separated by **one blank line**.
- List items start with a bullet character and **two spaces**: `•  item`.
- No markdown. No `#`, no `**`, no tables.

The text becomes real Word paragraphs and native bullet lists — identical to generated content,
because it goes through the same parser. A spreadsheet cell holds up to 50,000 characters, so even a
long liability clause fits comfortably.

### `applies_when`

Comma-separated tokens. **All of them must match.** It is a fixed token list, never evaluated as
code — this column decides which contract text goes out, and that is not a place for a scripting
language.

| Token | Applies when |
|---|---|
| *(empty)* or `always` | Always |
| `scope:installation` | That scope item is in scope for the request (any key from `schemas/scope-catalog.json`) |
| `tier:B` | The document is exactly tier B |
| `tier:B+` | Tier B or above |
| `lang:es` | The proposal is in that language |
| `country:ES` | The project site is in that country |
| `pricing` / `no_pricing` | The request does or does not carry a price |

```
scope:installation, tier:B+          both must hold
```

An unrecognised token makes the row **not apply**, and raises a warning. A typo costs you one clause,
loudly — it never quietly applies everything.

---

## Tab 3 — `Rules`

House style. These lines are injected into the writing agents' instructions verbatim, so they change
how the generated 30–35% of the document reads.

| `key` | `value` |
|---|---|
| `default_tier` | `A`, `B` or `C` — this client's usual document weight when a request does not say |
| `tone` | e.g. `técnico, sobrio y concreto; sin superlativos` |
| `person` | e.g. `primera persona del plural` |
| `units` | e.g. `Sistema Internacional; decimal con coma` |
| `date_format` | e.g. `dd/mm/aaaa` |
| `forbidden_words` | Comma-separated. Words the agents must never use. |
| `must_mention` | Comma-separated. Points to work in where relevant. |
| `warranty_months`, `validity_days`, `incoterm` | Values the client's clauses refer to |
| `term:<word>` | Preferred wording. `term:cliente final` → `el Cliente` makes the agents say "el Cliente". |

Unknown keys are passed through untouched, so a client can add their own and reference them from a
custom chapter.

`forbidden_words` is the highest-leverage row in this tab. Generated prose drifts toward marketing
adjectives; a short banned list fixes it more reliably than any amount of prompt tuning.

---

## The three tiers

The same catalog produces three document weights. A request can ask for one; otherwise
`default_tier` decides.

| Tier | For | Length |
|---|---|---|
| **A** | A quotation | 4–8 pages, ~11 chapters |
| **B** | A standard proposal | 15–25 pages, 14 chapters |
| **C** | A tender response | 30–60 pages plus annexes |

Tier is a filter over one structure, not three different documents — so a chapter you rename or a
clause you write applies to all three.

---

## Checking your changes

Change something in the sheet and re-run the same RFQ. Nothing is deployed, nothing is cached: the
next proposal picks it up. That round trip — edit a cell, re-run, see the document change — is worth
doing once when you set a client up, because it is also the clearest way to show them what they are
buying.

Watch for these in the Telegram alert:

- **Config warnings.** An unknown `chapter_id`, an unparseable `applies_when`, a clause pointing at a
  chapter that no longer exists. None of them stop the proposal; all of them mean a row of yours is
  being ignored.
- **`config_source: catalog_default`** when you expected `sheet`. The sheet id is missing from the
  registry, or the sheet is not shared with the n8n account.

To check the whole chain offline before touching Drive, put your CSVs in
`seed/<client_id>/proposal-config/` and run `npm run check` — it resolves the catalog against them
and renders real documents in all three tiers, failing on any warning.
