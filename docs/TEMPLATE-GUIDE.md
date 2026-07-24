# Master proposal template — how to build it

The proposal is produced from **one master Google Docs template per client per language**. It is a
*superset*: it contains every section the client might ever offer. Which sections appear is decided
**per request** by that request's scope of supply — Module 4 fills the in-scope sections and removes
the out-of-scope ones, so a materials-only quote and a full-turnkey proposal come out of the same
template looking clean.

> "Word master template": the template is a **Google Doc**. If you have it in Word (.docx), upload it
> to Drive and open it as a Google Doc. The automation operates on the Google Doc — keep that as the
> source of truth.

## How replacement works (and its one limit)

Module 4 uses the Google Docs node's find-and-replace. That means:

- It can swap a `{{TOKEN}}` for text (multi-line text becomes multiple paragraphs, inheriting the
  token paragraph's font/size/style).
- It **cannot** turn injected text into native Google Docs *bullet lists* or apply *Heading styles*
  to only part of the injected block, and it can't delete a styled heading cleanly.

So the design works *with* that limit:

- **Injected sections are self-contained plain text.** Module 4 writes each optional section as
  `HEADING (uppercase)` + blank line + body, and Module 2 writes list items with a bullet character
  (`•  item`). This gives consistent, professional-looking headings and bullets **without** needing
  native list styling — and the whole block vanishes cleanly when out of scope (it becomes `""`).
- **Always-present chapters get their real styled headings from the template** (see below).

If you later want *native* Google Docs bullets and true styled-heading removal, that needs the Google
Docs API (`batchUpdate`) via an HTTP Request node — a deferred upgrade, noted at the end.

## Placeholders

### Core value tokens (always replaced with a value)
Put each where its value belongs.

| Token | Filled with |
|-------|-------------|
| `{{NUMERO_PROPUESTA}}` | Proposal number (`PROP-YYYYMMDD-XXXXXX`) |
| `{{FECHA}}` | Date |
| `{{CLIENTE_EMPRESA}}` | End-customer company |
| `{{CLIENTE_CONTACTO}}` | End-customer contact name |
| `{{PROYECTO_TIPO}}` | Project type |
| `{{PROYECTO_UBICACION}}` | Project location |
| `{{PROYECTO_PLAZO}}` | Desired deadline |
| `{{REQUISITOS_LISTA}}` | Technical requirements, one `•  ` bullet per line |
| `{{ALCANCE_SUMINISTRO}}` | Scope of Supply — Included / Not-included, `•  ` bullets. Keep near the top; it's what the reseller checks first. |
| `{{ALCANCE_TECNICO}}` | Technical scope narrative (always written) |
| `{{RESUMEN_COMERCIAL}}` | Commercial summary — a short paragraph + `•  ` condition bullets (always written) |

### Scope-gated section tokens (self-titled; vanish when out of scope)
Each is replaced with `HEADING + body` when in scope, or `""` (removed) when not. **Put each on its
own empty line** where the section should sit.

| Token | Appears when scope includes | Catalog key |
|-------|-----------------------------|-------------|
| `{{SECCION_PLAN_IMPLANTACION}}` | installation / commissioning / project_management | `plan_implantacion` |
| `{{SECCION_REPUESTOS}}` | spare_parts | `repuestos` |
| `{{SECCION_TRANSPORTE}}` | shipping | `transporte` |
| `{{SECCION_FORMACION}}` | training | `formacion` |
| `{{SECCION_GARANTIA}}` | warranty | `garantia` |
| `{{SECCION_ECONOMICA}}` | *pricing was run* (full_pipeline; omitted for proposal_only) | — |

`{{SECCION_ECONOMICA}}` self-titles "ECONOMIC PROPOSAL / OFERTA ECONÓMICA" and lists subtotal, total
and payment terms as bullets — **give it its own place in the document flow** (its own page or the
chapter right after the commercial summary), not buried inside the commercial-terms paragraph.

## Recommended layout (concrete)

```
[ Title page ]
  TECHNICAL & COMMERCIAL PROPOSAL            (styled title)
  {{NUMERO_PROPUESTA}}
  {{PROYECTO_TIPO}}
  Prepared for: {{CLIENTE_CONTACTO}}, {{CLIENTE_EMPRESA}} — {{PROYECTO_UBICACION}}
  {{FECHA}}

[ Letter intro paragraph ]  (static text, use {{CLIENTE_CONTACTO}} / {{CLIENTE_EMPRESA}})

1. SCOPE OF SUPPLY            (styled Heading 1)
   {{ALCANCE_SUMINISTRO}}

2. REQUIREMENTS RECEIVED      (styled Heading 1)
   {{REQUISITOS_LISTA}}

3. TECHNICAL SCOPE            (styled Heading 1)
   {{ALCANCE_TECNICO}}
   {{SECCION_PLAN_IMPLANTACION}}
   {{SECCION_REPUESTOS}}
   {{SECCION_TRANSPORTE}}
   {{SECCION_FORMACION}}

4. COMMERCIAL PROPOSAL        (styled Heading 1)
   {{RESUMEN_COMERCIAL}}
   {{SECCION_ECONOMICA}}
   {{SECCION_GARANTIA}}

5. VALIDITY & NEXT STEPS      (styled Heading 1, static text)
[ Signature / footer ]        (static)
```

The numbered chapter headings (1–5) are **real styled headings you type once in the template** — so
they render consistently. The `{{SECCION_*}}` tokens carry their own uppercase sub-heading in the
injected text, so they look like titled sub-sections and disappear cleanly when out of scope.

> Fixing the "1. / 1. / 1." repetition you saw: don't build the chapter numbers with a *numbered
> list* (each heading restarts at 1). Either type the numbers as plain text ("1. ", "2. ") in the
> heading, or use a proper Heading style with the document's outline numbering — not a list that
> restarts.

## Authoring tips

- Style the paragraph each token sits on the way you want the injected text to look (font, size,
  spacing). Injected text inherits that paragraph style.
- A token not found in the document is skipped (0 replacements) — harmless. A client who never offers
  training can just omit `{{SECCION_FORMACION}}`.
- Replacing a token with `""` can leave one blank line. Keep optional tokens on their own line so the
  residue is at most an empty paragraph.
- Keep the template's own text free of the `{{ }}` pattern except for real placeholders.

## Register the template

1. Save the master template as a Google Doc in the client's `Templates/` folder.
2. Put its id in `template_id_en` (and `template_id_es`) in the Notion registry row.
3. Set `proposals_folder_id` to the output folder (Module 4 copies the filled doc there — the
   `sameFolder:false` setting on the Copy Template node ensures it lands in that folder, not next to
   the template).
4. Run a `proposal_only` and a `full_pipeline` test (`docs/TESTING-MANUAL.md`) and eyeball the output.

## Deferred upgrade — native formatting via the Docs API

For fully native bullets, styled sub-headings on optional sections, and true range deletion of
out-of-scope chapters, replace Module 4's Google Docs "update" nodes with an **HTTP Request** node
calling the Google Docs API `documents:batchUpdate` (`replaceAllText` + `createParagraphBullets` +
`deleteContentRange`). It's more powerful but more complex to build and maintain; the current
plain-text + `•` approach is the pragmatic default for the demo.
