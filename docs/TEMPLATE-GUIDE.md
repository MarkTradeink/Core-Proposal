# Proposal template guide (.docx)

A client's proposal template is a **Word `.docx` file in their Google Drive folder**. Module 4
renders it with [docxtemplater](https://docxtemplater.com/docs/tag-types/): your styles, headers,
footers, logos and page setup are preserved exactly, and the workflow only fills in content.

The template is a *superset* — it contains every section the client might ever offer. Which sections
appear is decided **per request** by that request's scope of supply, so a materials-only quote and a
full-turnkey proposal come out of the same template looking clean.

Record the file id in the registry's `template_id_en` / `template_id_es` (see
`CLIENT-REGISTRY-SCHEMA.md`). If `template_id_es` is empty, Spanish RFQs fall back to the English
template.

> **This replaces the old Google Docs `{{TOKEN}}` templates.** Those could only swap text for text,
> so a generated chapter inherited the styling of the paragraph its token sat in — no real headings,
> bullets faked with a "•" character, prices as a bullet list. Headings, lists and tables are
> *structure*, and structure cannot travel through a text placeholder. Old templates must be
> rebuilt; there is no automatic migration.

## Build it in Word, not in Google Docs

1. Write the proposal the way you want it to look, with **real Word styles** — Heading 1 for chapter
   titles, a real bullet list, real tables. What the workflow keeps or repeats depends on the style
   you applied, not on how the text looks.
2. Replace the variable parts with the tags below.
3. Save as `.docx` (not `.doc`, not a Google Doc) and upload it to the client's Drive folder.

Word autocorrect is the most common cause of a broken template: it turns straight quotes into curly
ones and can split a tag across two internal text runs. If a tag does not render, retype it in one
go without pausing, or paste it as plain text.

## The one rule that decides whether lists work

**A loop that should repeat a paragraph must have its tags alone on their own lines.**

```
{#alcance_incluido}
{etiqueta}                  ← this line styled "List Bullet"
{/alcance_incluido}
```

That produces one real list item per element. Written inline instead:

```
{#alcance_incluido}{etiqueta}{/alcance_incluido}
```

…docxtemplater repeats only the *content inside* the paragraph, and every item is concatenated into
one run-on paragraph — `Materials & EquipmentEngineering & DesignWarranty`. It looks like corrupt
data. It is not; it is the wrong tag placement. The same rule applies to paragraph loops such as
`{#alcance_tecnico.parrafos}`.

The tag-only lines disappear from the finished document. They can carry any style; Normal is fine.

## Conditional chapters

Wrap a whole chapter — heading included — in a `{#has_…}` block so it vanishes when that section is
out of scope for the request:

```
{#has_plan_implantacion}
4. IMPLEMENTATION PLAN               ← Heading 1
{#plan_implantacion.bullets}
{texto}                              ← "List Bullet"
{/plan_implantacion.bullets}
{/has_plan_implantacion}
```

Because the opening tag sits on its own line, the heading goes with the block. This is precisely what
the old template system could not do — you had to write the heading inside the generated text and
hope it looked like the others.

## Tables

Put `{#loop}` in the **first cell** of the row to repeat and `{/loop}` in the **last cell of that
same row**. Keep the header row outside the loop.

| Item | Qty | Specification |
|------|-----|---------------|
| `{#requisitos}{item}` | `{cantidad}` | `{spec}{/requisitos}` |

Table row loops are the one exception to the rule above: inline tags are correct here, because
docxtemplater detects that the tags span a table row and repeats the row.

## Available tags

Every tag below always exists. A section that is out of scope comes back empty, never missing — so
a template can reference anything without the word `undefined` appearing in a customer's document.

### Header

| Tag | Contents |
|-----|----------|
| `{numero_propuesta}` | `PROP-YYYYMMDD-XXXXXX`, deterministic for a given RFQ |
| `{fecha}` | Date, formatted for the proposal's language |
| `{idioma}` | `es` or `en` |
| `{cliente.empresa}` `{cliente.contacto}` `{cliente.email}` `{cliente.telefono}` | End-customer details extracted from the RFQ |
| `{proyecto.tipo}` `{proyecto.ubicacion}` `{proyecto.plazo}` | Project details |

### Requirements — table loop

`{#requisitos}` … `{/requisitos}`, exposing `{item}`, `{cantidad}`, `{spec}`.
Gate it with `{#has_requisitos}` if an RFQ might not list any.

### Scope of supply — bullet loops

`{#alcance_incluido}` … `{/alcance_incluido}` and `{#alcance_excluido}` … `{/alcance_excluido}`,
each exposing `{etiqueta}` (already translated). Flags: `{#has_alcance_incluido}`,
`{#has_alcance_excluido}`.

Keep the "not included" list in the template. It is what lets the reviewing reseller catch a
mis-extracted scope before the proposal reaches their customer.

### Narrative sections

Seven sections, written by Module 2: `alcance_tecnico`, `resumen_comercial`, `plan_implantacion`,
`repuestos`, `transporte`, `formacion`, `garantia`.

Each exposes the same shape:

| Tag | Contents |
|-----|----------|
| `{#has_<section>}` | Whether the section has any content — wrap the chapter in this |
| `{#<section>.parrafos}` `{texto}` `{/<section>.parrafos}` | Body paragraphs |
| `{#<section>.bullets}` `{texto}` `{/<section>.bullets}` | List items |
| `{#<section>.has_parrafos}` / `{#<section>.has_bullets}` | Finer-grained gates, rarely needed |

Put the paragraph loop before the bullet loop — that is the order Module 2 writes in.

Which scope item switches on which section is recorded in `schemas/scope-catalog.json`
(`template_block`).

### Economic section

Gate the whole chapter with `{#has_pricing}` — a `proposal_only` request produces no prices at all.

```
{#has_pricing}
6. COMMERCIAL OFFER                  ← Heading 1
```

| Item | Qty | Unit price | Amount |
|------|-----|-----------|--------|
| `{#pricing.lineas}{concepto}` | `{cantidad}` | `{precio_unitario}` | `{importe}{/pricing.lineas}` |
| **TOTAL** | | | `{pricing.total}` |

```
Payment terms: {pricing.condiciones_pago}
{/has_pricing}
```

Amounts arrive already formatted for the language (`3.823,20 €` in Spanish, `€3,823.20` in English),
so never apply Word number formatting on top.

> **There is deliberately no subtotal tag.** The internal subtotal is the pre-margin cost basis, and
> this document is forwarded to the end customer — printing it beside the total hands them the
> reseller's margin. The line amounts are sell prices and add up to `{pricing.total}` exactly. The
> reseller still sees the cost subtotal in the quote email the system sends them.

## Two constraints worth knowing

Both come from the render node (`n8n-nodes-docxtemplater`) and explain choices above:

- **A tag with no matching key renders the literal text `undefined`** — the node does not expose
  docxtemplater's `nullGetter`. Module 4 therefore always emits every key, empty rather than absent.
  If you *do* see `undefined` in an output, the tag name is misspelled.
- **Tags are evaluated as [Jexl](https://github.com/TomFrost/Jexl) expressions**, not plain lookups.
  So `-` in a tag name would be read as subtraction (all key names use underscores), and loops
  iterate objects with named fields (`{etiqueta}`, `{texto}`) rather than bare strings.

Jexl also means conditionals and transforms work in tags if you ever need them, e.g.
`{idioma == 'es' ? 'Oferta' : 'Offer'}`. Prefer a separate ES and EN template instead — the registry
already supports one per language, and it keeps templates readable for non-developers.

## Checking a new template

Run a `full_pipeline` RFQ with some scope items excluded, then open the generated `.docx`:

- Word's **navigation pane** lists your chapters — proof the headings are real Heading 1s and not
  just bold text.
- Bullets can be re-indented with Tab — proof they are a native list, not "•" characters.
- Out-of-scope chapters are gone **along with their headings**.
- The amount column adds up to the total.
- Search the document for `undefined` and for `{`. Both should return nothing.

Then compare the PDF against the `.docx`: headers, footers, logo and page breaks should match.
