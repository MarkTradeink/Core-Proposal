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
├── Templates/              proposal-template-es.docx · proposal-template-en.docx
├── Generated Proposals/    Module 4 output (.docx + .pdf)
├── Reference Docs/         approved past proposals, for grounding
├── Pricing Rules           Google Sheet — docs/PRICING-SHEET-TEMPLATE.md
└── Proposal Config         Google Sheet — this document
```

Copy the Proposal Config sheet's id from its URL
(`https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`) into the client's
**`proposal_config_sheet_id`** in the Notion registry.

**A client with no Proposal Config sheet still works.** The chapter structure falls back to the
catalog defaults and the proposal comes out with no client-specific clauses or writing rules. The run
records a warning saying exactly that, so nobody mistakes a default-structure draft for the client's
real boilerplate.

## Getting started

`seed/demo_client/proposal-config/` holds three CSVs — `chapters.csv`, `content.csv`, `rules.csv` —
with a complete, industry-neutral starting set in Spanish and English. Create a Google Sheet with
three tabs named exactly **`Chapters`**, **`Content`** and **`Rules`**, and import one CSV into each
(File → Import → *Insert new sheet*, then rename the tab). Share the sheet with the Google account
n8n uses.

Then replace the seed text with the client's own. The seed is deliberately generic; the value comes
from putting the client's real terms in.

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
