# Master proposal template — how to build it

The proposal document is produced from **one master Google Docs template per client per language**.
It is a *superset*: it contains every section the client might ever offer. Which sections actually
appear is decided **per request** by that request's scope of supply — Module 4 fills the in-scope
sections and **removes the out-of-scope ones**, so a materials-and-engineering-only quote and a
full-turnkey proposal come out of the same template looking clean, with no empty headings.

> "Word master template": the template is a **Google Doc**. If you have it in Word (.docx), upload
> it to Google Drive and open it as a Google Doc (or File → Save as Google Docs). The automation
> operates on the Google Doc; keep that as the source of truth.

## How it works (why single tokens, not marker pairs)

The n8n Google Docs node can only do find-and-replace. So each section is represented by **one
placeholder token** that Module 4 replaces with either:

- the section's content (a heading line + the generated text) when the item is **in scope**, or
- an empty string when it is **out of scope** — which makes the whole block disappear.

That gives you the "master template + delete the blocks you don't need" behaviour using only
find-and-replace. You author the template once with all tokens; each request self-prunes.

## Placeholders

### Always-filled (core) — plain-value tokens
Put these where the value should appear. They are always replaced with a value.

| Token | Filled with |
|-------|-------------|
| `{{NUMERO_PROPUESTA}}` | Proposal number (e.g. `PROP-20260723-AB12CD`) |
| `{{FECHA}}` | Date |
| `{{CLIENTE_EMPRESA}}` | End-customer company |
| `{{CLIENTE_CONTACTO}}` | End-customer contact name |
| `{{PROYECTO_TIPO}}` | Project type |
| `{{PROYECTO_UBICACION}}` | Project location |
| `{{PROYECTO_PLAZO}}` | Desired deadline |
| `{{REQUISITOS_LISTA}}` | Bulleted list of technical requirements |
| `{{ALCANCE_SUMINISTRO}}` | **Scope of Supply** — an Included / Not-included list. Keep this near the top; it is what the reseller checks first to confirm the scope is right before sending. |
| `{{ALCANCE_TECNICO}}` | Technical scope narrative (always written) |
| `{{RESUMEN_COMERCIAL}}` | Commercial summary narrative (always written) |

### Scope-gated sections — one token each, on its own line
Each of these is replaced with **heading + content** when its scope item is included, or with **""**
(removed) when it is not. Put each token **on its own empty line/paragraph** where that section
should sit in the document flow.

| Token | Appears when scope includes | Catalog key |
|-------|-----------------------------|-------------|
| `{{SECCION_PLAN_IMPLANTACION}}` | installation / commissioning / project_management | `plan_implantacion` |
| `{{SECCION_REPUESTOS}}` | spare_parts | `repuestos` |
| `{{SECCION_TRANSPORTE}}` | shipping | `transporte` |
| `{{SECCION_FORMACION}}` | training | `formacion` |
| `{{SECCION_GARANTIA}}` | warranty | `garantia` |
| `{{SECCION_ECONOMICA}}` | *pricing was run* (full_pipeline; omitted for proposal_only) | — |

The catalog of scope items and their mapping lives in `schemas/scope-catalog.json` — the single
source of truth. To add a new optional section (say, "Civil Works"): add an item there, add a
`{{SECCION_...}}` token here in the template, and extend the small maps in Module 2's *Plan Sections*
node and Module 4's *Compute Proposal Fields* node.

## Authoring tips

- Style the **core** headings (Technical Scope, Commercial Summary) directly in the template — those
  sections are always present, so their headings can be real Google Docs Heading styles.
- For **scope-gated** sections, the heading comes *inside* the injected token text (plain), because
  the whole block must be able to vanish. If you want styled headings for optional sections too, put
  a styled heading in the template above the token AND leave the token to inject only the body — but
  then that heading won't disappear when the section is out of scope. The single-token approach is
  the trade-off that guarantees clean removal. For the demo, single tokens are the recommended
  default.
- A token that isn't found in the document is simply skipped (0 replacements) — harmless. So a
  client whose business never includes training can just leave `{{SECCION_FORMACION}}` out of their
  template.
- Replacing a token with "" can leave one blank line where it sat. Keep optional tokens on their own
  line so the residue is at most an empty paragraph.

## Register the template

1. Save the master template as a Google Doc in the client's `Templates/` folder.
2. Copy its id from the URL and put it in `template_id_en` (and `template_id_es` for a Spanish
   variant) in the Notion registry row.
3. Choose/confirm the `Generated Proposals/` folder and put its id in `proposals_folder_id`.
4. Run a `proposal_only` and a `full_pipeline` test (see `docs/TESTING-MANUAL.md`) and eyeball the
   output: right sections present, out-of-scope sections absent, scope-of-supply block correct.
