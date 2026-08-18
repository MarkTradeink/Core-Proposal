# Proposal template guide (.docx)

A client's proposal template is a **Word `.docx` file in their Google Drive folder**. Module 4
renders it with [docxtemplater](https://docxtemplater.com/docs/tag-types/): your styles, headers,
footers, logos and page setup are preserved exactly, and the workflow only fills in content.

The template is a **superset** — it contains every chapter the client might ever offer. Which ones
appear is decided per request by the resolved chapter set (tier + scope + the client's Proposal
Config sheet), so a supply-only quotation and a full tender response come out of the same file
looking clean.

Record the file id in the registry's `template_id_en` / `template_id_es` (see
`CLIENT-REGISTRY-SCHEMA.md`). If `template_id_es` is empty, Spanish RFQs fall back to the English
template.

## Four generated files

```bash
npm install && npm run templates     # regenerate all four from the catalog
```

| File | What it is |
|---|---|
| `templates/proposal-template-es.docx` · `-en.docx` | The neutral **seeds**. All 105 conditional blocks and 24 table loops, correctly tagged and ordered, no branding and no client variables. The starting point for a new client. |
| `templates/demo-proposal-template-es.docx` · `-en.docx` | What **`demo@cifral.io` actually sends**. The same blocks plus `demo_client`'s own cover variables, and marked as a demonstration on the cover, in the header, in the footer of every page and on a notice page of its own. |

### Start from the seed, do not start from scratch

**Copy a seed, restyle it, upload it.**

What you should change: fonts, colours, the cover page, the header and footer, the logo, page setup,
paragraph spacing, table borders. Word styles are yours.

What you should not change: the tags, and the rule that loop tags sit alone on their own line. If you
need a chapter the seed does not have, that is a catalog change (`schemas/chapter-catalog.json`) plus
`npm run templates` — not a hand edit, because a tag the render context does not know about renders
the literal word `undefined` into a customer's document.

### The demo pair is a finished document, not a starting point

It goes straight out to strangers who emailed an RFQ to `demo@cifral.io`
([`DEMO-INTAKE.md`](DEMO-INTAKE.md)), with nobody reading it in between. Two things follow:

- **The demo marking is load-bearing. Do not remove it when restyling.** A prospect must not be able
  to mistake generic seed content for a quotation. The strings live in `UI.<lang>.demo*` in
  `templates/build-templates.js`, and the notice page is `demoNotice()`.
- **It carries `{campos.*}` tags and the seeds do not**, because those are generated from
  `seed/demo_client/proposal-config/fields.csv`. A `{campos.*}` key nobody declares prints the
  literal word `undefined`, so the generator can only emit them for a client whose `Fields` tab it
  can read — which is precisely the mechanism the demo exists to show.

`npm run check` renders both demo templates against `demo_client`'s real configuration, alongside
the four seed renders.

Word autocorrect is the most common cause of a broken template: it turns straight quotes into curly
ones and can split a tag across two internal text runs. If a tag does not render, retype it in one go
without pausing, or paste it as plain text.

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
data. It is not; it is the wrong tag placement.

The tag-only lines disappear from the finished document. They can carry any style; Normal is fine.

## The shape every chapter shares

Each of the 105 blocks below follows the same pattern, which is why the whole template can be
generated:

```
{#has_solucion_tecnica}
{solucion_tecnica.titulo}                     ← Heading 1
{#solucion_tecnica.parrafos}
{texto}                                        ← Normal
{/solucion_tecnica.parrafos}
{#solucion_tecnica.bullets}
{texto}                                        ← List Bullet
{/solucion_tecnica.bullets}

  {#has_solucion_tecnica_arquitectura}
  {solucion_tecnica_arquitectura.titulo}       ← Heading 2
  …same three loops…
  {/has_solucion_tecnica_arquitectura}

{/has_solucion_tecnica}
```

Every id exposes exactly this:

| Tag | Contents |
|-----|----------|
| `{#has_<id>}` … `{/has_<id>}` | Whether the chapter has content — wrap the whole chapter, heading included |
| `{<id>.titulo}` | The chapter title, already translated **and already renamed** if the client's sheet renamed it. Never type a title into the template. |
| `{<id>.numero}` | Its final number (`4`, `4.2`, `A`). Only needed for cross-references — see numbering below. |
| `{#<id>.parrafos}` `{texto}` `{/<id>.parrafos}` | Body paragraphs |
| `{#<id>.bullets}` `{texto}` `{/<id>.bullets}` | List items |
| `{#<id>.has_parrafos}` / `{#<id>.has_bullets}` | Finer-grained gates, rarely needed |

Put the paragraph loop before the bullet loop — that is the order content is written in.

**Block order is document order.** A chapter appears where its block sits in this file; the
`order` column in the client's `Chapters` tab sets the chapter's number, not its position. To move
a chapter, move the whole `{#has_<id>}` … `{/has_<id>}` block. The reserved `custom_1`…`custom_5`
blocks sit at the end of the seed, so a client who uses one almost always wants to move it.

Generated text and the client's own clauses arrive through the **same** loops. The template cannot
tell them apart, and should not try to.

## Numbering: let Word do it

Headings in the seed carry a **multilevel list bound to the heading styles**. Do not type chapter
numbers, and do not put `{<id>.numero}` in a heading.

The reason is that docxtemplater physically deletes the paragraphs of a dropped chapter. Word then
renumbers whatever survives, so a proposal that omits chapters 3 and 4 still reads 1, 2, 3, 4 — no
gaps. Typed numbers would be wrong the moment a chapter is out of scope.

`{<id>.numero}` exists because the render context numbers the surviving chapters the same way, so the
two always agree. Use it in body text ("as described in section {ejecucion_pruebas.numero}"), not in
headings.

## Contents list

A **real Word table of contents**, with page numbers and working links:

```
Field: TOC \h \o "1-2"
```

The seed builds it for you (`npm run templates`), so there is nothing to type.

This used to be a generated loop without page numbers, on the belief that the headless PDF leg could
not refresh field TOCs. That is true of a bare `soffice --convert-to pdf`, but the conversion runs
through **Gotenberg's** LibreOffice route, whose `updateIndexes` property defaults to true and
refreshes indexes before converting. The other half is `<w:updateFields/>` in `word/settings.xml`,
which the seed sets: without it the `.docx` the client opens would show an empty contents list until
someone pressed F9, because docxtemplater writes the new headings without touching the field's
cached result.

Unnumbered front matter is still not listed. The seed pushes every unnumbered heading off the
outline (`outlineLevel: 9`), so the TOC skips it — a contents list that opens with
"Índice ....... 2" is noise.

The render context **still emits** `indice` and `tabla_indice`, so a client template that already
uses the generated loop keeps working unchanged:

```
{#indice}
{numero}  {titulo}
{/indice}
```

> ⚠️ Verify page numbers on the first real run. Everything above is checked offline except the
> pagination itself, which only exists once Gotenberg has converted the document.

## Tables

Put `{#loop}` in the **first cell** of the row to repeat and `{/loop}` in the **last cell of that
same row**. Keep the header row outside the loop. Gate the whole table with `{#has_<loop>}`.

| Item | Qty | Specification |
|------|-----|---------------|
| `{#requisitos}{item}` | `{cantidad}` | `{spec}{/requisitos}` |

Table row loops are the one exception to the tags-on-their-own-line rule: inline tags are correct
here, because docxtemplater detects that the tags span a table row and repeats the row.

## Header block

| Tag | Contents |
|-----|----------|
| `{numero_propuesta}` | `PROP-YYYYMMDD-XXXXXX`, deterministic for a given RFQ |
| `{fecha}` | Date, formatted for the proposal's language |
| `{idioma}` | `es` or `en` |
| `{documento.tier}` | `A`, `B` or `C` |
| `{documento.version}` · `{documento.config_source}` | Document version; `sheet` or `catalog_default` |
| `{cliente.empresa}` `{cliente.contacto}` `{cliente.email}` `{cliente.telefono}` | End-customer details |
| `{proyecto.titulo}` | The project's own title, as the sender words it. Falls back to `{proyecto.tipo}` when the RFQ never names the project — so an older template that used `tipo` is unaffected |
| `{proyecto.tipo}` `{proyecto.ubicacion}` `{proyecto.plazo}` | Project details |
| `{campos.<key>}` | **This client's own variables** — see below |

### The client's own variables: `{campos.*}`

A real cover carries things no catalog can know: an offer number out of the client's ERP, an asset
number, the legal name that goes above it. Those are declared in the `Fields` tab of the client's
Proposal Config sheet (`docs/CLIENT-DRIVE-SETUP.md`) and land here under `campos`:

```
{campos.razon_social}
{campos.n_oferta}          Oferta nº
{campos.atencion}          Att.
```

Four things to know before you type one into a template:

- **Only declared keys exist.** Every key the sheet declares is always present, empty rather than
  absent — the same totality rule as the rest of the context. A key the sheet does *not* declare
  prints the literal word `undefined`, because there is nothing to enumerate.
- **The valid list is generated.** `node scripts/client-docs.js <client_id>` writes that client's
  setup guide, which lists every `{campos.*}` tag their template may use. Read it before editing
  their cover.
- **Values captured from the email are verbatim.** No model touches them. What the sender typed
  after `Oferta nº:` is what prints.
- **The generator can lay them out for you.** `templates/build-templates.js` reads
  `seed/<client_id>/proposal-config/fields.csv` and writes the cover block itself — that is how the
  demo pair gets its variables. A `request` field becomes a labelled line; the first `static` field
  becomes the issuer line above the title; `auto` fields are left off, because each one duplicates
  something the cover already prints under its own tag.

### Which word gets printed: `es:` / `en:` tags

`capture_label` holds comma-separated alternatives, and the capture looks for **all** of them on
every message whatever the language — that has not changed. What was missing was which one to
*print* on a cover.

Position could not answer it, because position carries no language: `Oferta nº, Offer no` puts
Spanish first and `Asset, Activo` puts English first, so an English cover generated from the same
sheet came out reading "Activo". Tag them instead:

```
n_oferta      es:Oferta nº, en:Offer no
n_activo      en:Asset, es:Activo
atencion      es:Att., en:Attn, Atn.
```

The tag is stripped before matching, so all three alternatives still capture in any language.
Untagged rows behave exactly as before — the first alternative prints — so no existing sheet has to
change.

Removing a header tag you do not want — `{proyecto.ubicacion}`, `{proyecto.plazo}` — is just a
delete. The context still emits the key; nothing has to know the template stopped using it.

### RFQ read-back

`{#requisitos}` … `{/requisitos}` exposing `{item}`, `{cantidad}`, `{spec}` (gate with
`{#has_requisitos}`), plus `{#alcance_incluido}` / `{#alcance_excluido}` exposing `{etiqueta}`.

Keep the "not included" list in the template. It is what lets the reviewing reseller catch a
mis-extracted scope before the proposal reaches their customer.

### Economic section

The price chapter is `oferta_economica`, and it disappears entirely on a `proposal_only` request.
Its table is the one body that is not a text section:

| Item | Qty | Unit price | Amount |
|------|-----|-----------|--------|
| `{#pricing.lineas}{concepto}` | `{cantidad}` | `{precio_unitario}` | `{importe}{/pricing.lineas}` |
| **TOTAL** | | | `{pricing.total}` |

Gate it with `{#pricing.has_lineas}`. Payment terms: `{pricing.condiciones_pago}`.

Amounts arrive already formatted for the language (`3.823,20 €` in Spanish, `€3,823.20` in English),
so never apply Word number formatting on top.

> **There is deliberately no subtotal tag.** The internal subtotal is the pre-margin cost basis, and
> this document is forwarded to the end customer — printing it beside the total hands them the
> reseller's margin. The line amounts are sell prices and add up to `{pricing.total}` exactly. The
> reseller still sees the cost subtotal in the quote email the system sends them.

## Full block inventory

Source of truth: `schemas/chapter-catalog.json`. Tier column shows which document weights include the
chapter by default; the client's Proposal Config sheet can override any of it.

### Front matter

| Chapter block | Tier | Content | Subsections |
|---|---|---|---|
| `portada`<br>Portada | ABC | Calculated (—) | — |
| `carta_presentacion`<br>Carta de presentación | BC | Generated (A3) | — |
| `control_version`<br>Control de versión | BC | Calculated (—) | — |
| `indice`<br>Índice | BC | Calculated (—) | — |
| `glosario`<br>Glosario y abreviaturas | C | Boilerplate (A5) | — |

### Body

| Chapter block | Tier | Content | Subsections |
|---|---|---|---|
| `resumen_ejecutivo`<br>Resumen ejecutivo | ABC | Generated (A3) | `resumen_ejecutivo_necesidad` · `resumen_ejecutivo_solucion` · `resumen_ejecutivo_beneficios` · `resumen_ejecutivo_economico` |
| `bases_oferta`<br>Bases de la oferta | ABC | Mixed (A5) | `bases_oferta_documentos` · `bases_oferta_normativa` · `bases_oferta_premisas` |
| `antecedentes`<br>Antecedentes y situación actual | BC | Generated (A3) | `antecedentes_instalacion` · `antecedentes_problematica` · `antecedentes_objetivos` |
| `solucion_tecnica`<br>Solución técnica propuesta | BC | Generated (A1) | `solucion_tecnica_arquitectura` · `solucion_tecnica_funcional` · `solucion_tecnica_control` · `solucion_tecnica_ciberseguridad` · `solucion_tecnica_alternativas` |
| `alcance_suministro`<br>Alcance de suministro | ABC | Generated (A1) | `alcance_suministro_resumen` · `alcance_suministro_hardware` · `alcance_suministro_software` · `alcance_suministro_scada` · `alcance_suministro_ingenieria` · `alcance_suministro_recambios` · `alcance_suministro_documentacion` |
| `ejecucion`<br>Ejecución del proyecto | ABC | Generated (A2) | `ejecucion_inspeccion` · `ejecucion_fases` · `ejecucion_instalacion` · `ejecucion_puesta_marcha` · `ejecucion_pruebas` · `ejecucion_demostracion` · `ejecucion_formacion` · `ejecucion_transporte` · `ejecucion_recepcion` |
| `gestion_proyecto`<br>Gestión de proyecto | BC | Mixed (A2) | `gestion_proyecto_organizacion` · `gestion_proyecto_metodologia` · `gestion_proyecto_comunicacion` · `gestion_proyecto_cambios` · `gestion_proyecto_calidad` · `gestion_proyecto_planificacion` |
| `continuidad_riesgos`<br>Continuidad operativa, seguridad y riesgos | BC | Mixed (A2) | `continuidad_riesgos_estrategia` · `continuidad_riesgos_contingencia` · `continuidad_riesgos_registro` · `continuidad_riesgos_prl` · `continuidad_riesgos_ambiental` |
| `condiciones_sitio`<br>Condiciones técnicas y requisitos del emplazamiento | ABC | Boilerplate (A5) | `condiciones_sitio_area` · `condiciones_sitio_jornadas` · `condiciones_sitio_accesos` · `condiciones_sitio_suministros` · `condiciones_sitio_obligaciones` · `condiciones_sitio_entorno` |
| `limites_alcance`<br>Límites del alcance | ABC | Boilerplate (A5) | `limites_alcance_premisas` · `limites_alcance_exclusiones` · `limites_alcance_interfaces` · `limites_alcance_cambios` |
| `oferta_economica`<br>Oferta económica | ABC | Calculated (—) | `oferta_economica_resumen` · `oferta_economica_opciones` · `oferta_economica_tarifas` · `oferta_economica_no_incluido` · `oferta_economica_pago` · `oferta_economica_moneda` · `oferta_economica_revision` · `oferta_economica_validez` · `oferta_economica_plazo` |
| `garantia_soporte`<br>Garantía y soporte post-venta | ABC | Boilerplate (A5) | `garantia_soporte_alcance` · `garantia_soporte_exclusiones` · `garantia_soporte_sla` · `garantia_soporte_recurrentes` |
| `condiciones_generales`<br>Condiciones generales y reservas | ABC | Boilerplate (A5) | `condiciones_generales_marco` · `condiciones_generales_responsabilidad` · `condiciones_generales_pi` · `condiciones_generales_confidencialidad` · `condiciones_generales_fuerza_mayor` |
| `proximos_pasos`<br>Próximos pasos y aceptación | ABC | Mixed (A3) | — |
| `custom_1`<br>Capítulo personalizado 1 | ABC | Boilerplate (A5) | — |
| `custom_2`<br>Capítulo personalizado 2 | ABC | Boilerplate (A5) | — |
| `custom_3`<br>Capítulo personalizado 3 | ABC | Boilerplate (A5) | — |
| `custom_4`<br>Capítulo personalizado 4 | ABC | Boilerplate (A5) | — |
| `custom_5`<br>Capítulo personalizado 5 | ABC | Boilerplate (A5) | — |

### Annexes

| Chapter block | Tier | Content | Subsections |
|---|---|---|---|
| `anexo_cumplimiento`<br>Matriz de cumplimiento del pliego | C | Generated (A1) | — |
| `anexo_cronograma`<br>Cronograma detallado | C | Calculated (—) | — |
| `anexo_bom`<br>Lista de materiales | C | Generated (A1) | — |
| `anexo_pruebas`<br>Protocolos de prueba FAT/SAT | C | Generated (A2) | — |
| `anexo_planos`<br>Planos y esquemas | C | Boilerplate (A5) | — |
| `anexo_fichas`<br>Fichas técnicas de equipos | C | Boilerplate (A5) | — |
| `anexo_riesgos`<br>Registro de riesgos completo | C | Generated (A2) | — |
| `anexo_referencias`<br>Referencias de proyectos similares | BC | Boilerplate (A5) | — |
| `anexo_cvs`<br>CVs del equipo asignado | C | Boilerplate (A5) | — |
| `anexo_condiciones`<br>Condiciones generales de venta | BC | Boilerplate (A5) | — |
| `anexo_certificados`<br>Certificados y homologaciones | C | Boilerplate (A5) | — |

### Tables

| Loop | Columns |
|---|---|
| `tabla_indice` | `numero` · `titulo` |
| `tabla_versiones` | `version` · `fecha` · `autor` · `cambios` |
| `tabla_glosario` | `termino` · `definicion` |
| `tabla_beneficios` | `indicador` · `actual` · `objetivo` |
| `tabla_documentos_ref` | `referencia` · `titulo` · `fecha` · `revision` |
| `tabla_normativa` | `norma` · `titulo` · `aplicacion` |
| `tabla_alternativas` | `alternativa` · `ventajas` · `inconvenientes` · `decision` |
| `tabla_materiales` | `posicion` · `descripcion` · `cantidad` · `observaciones` |
| `tabla_recambios` | `posicion` · `descripcion` · `cantidad` · `criticidad` |
| `tabla_bom` | `posicion` · `descripcion` · `categoria` · `cantidad` · `observaciones` |
| `tabla_fases` | `fase` · `descripcion` · `duracion` · `entregable` |
| `tabla_pruebas` | `prueba` · `criterio` · `responsable` · `momento` |
| `tabla_equipo` | `rol` · `responsabilidad` · `dedicacion` |
| `tabla_hitos` | `hito` · `descripcion` · `plazo` |
| `tabla_riesgos` | `riesgo` · `probabilidad` · `impacto` · `mitigacion` |
| `tabla_obligaciones` | `numero` · `obligacion` |
| `tabla_premisas` | `numero` · `premisa` |
| `tabla_exclusiones` | `numero` · `exclusion` |
| `tabla_opciones` | `opcion` · `descripcion` · `importe` |
| `tabla_tarifas` | `concepto` · `unidad` · `importe` |
| `tabla_hitos_pago` | `hito` · `porcentaje` · `importe` · `condicion` |
| `tabla_servicios` | `servicio` · `alcance` · `periodicidad` |
| `tabla_pasos` | `paso` · `accion` · `responsable` · `plazo` |
| `tabla_cumplimiento` | `requisito` · `apartado` · `cumple` · `observaciones` |


## Two constraints worth knowing

Both come from the render node (`n8n-nodes-docxtemplater`) and explain choices above:

- **A tag with no matching key renders the literal text `undefined`** — the node does not expose
  docxtemplater's `nullGetter`. Module 4 therefore always emits every key in the catalog, empty
  rather than absent, whether or not this request renders it. If you *do* see `undefined` in an
  output, the tag name is misspelled or refers to something outside the catalog.
- **Tags are evaluated as [Jexl](https://github.com/TomFrost/Jexl) expressions**, not plain lookups.
  So `-` in a tag name would be read as subtraction (all ids use underscores, ASCII, no accents), and
  loops iterate objects with named fields (`{etiqueta}`, `{texto}`) rather than bare strings.

Jexl also means conditionals and transforms work in tags if you ever need them, e.g.
`{idioma == 'es' ? 'Oferta' : 'Offer'}`. Prefer a separate ES and EN template instead — the registry
already supports one per language, and it keeps templates readable for non-developers.

## Checking a new template

Offline, before anything reaches Drive:

```bash
# every tag in the client's own .docx, against the vocabulary that will fill it
node scripts/check-template.js <template.docx> <client_id>

# a real render of that template against that client's real configuration
node scripts/render-sample.js es B <client_id> --template <template.docx>

npm run check          # the seed templates, tiers A/B/C in Spanish and tier B in English
```

`check-template.js` is the one to run after **any** edit in Word. It catches the two things that
survive an edit and reach a customer: a tag nothing fills (`{cliente.empressa}`, or a `{campos.*}`
the client's `Fields` tab does not declare), which prints the literal word `undefined`, and a tag
Word has split across text runs. It reports the split ones as a count, because Word splits almost
every tag it touches and docxtemplater rejoins them — the count only matters on the day one tag
stops rendering.

It fails on the two things that reach a customer silently: the literal word `undefined`, and
unrendered braces.

Then open the generated `.docx` (`templates/sample-*.docx`):

- Word's **navigation pane** lists your chapters — proof the headings are real Heading 1s and not
  just bold text.
- Chapter numbers run 1, 2, 3 with no gaps even though chapters were dropped.
- Bullets can be re-indented with Tab — proof they are a native list, not "•" characters.
- Out-of-scope chapters are gone **along with their headings**.
- The amount column adds up to the total.
- The contents list matches the chapters that are actually there — and in the **PDF**, that it has
  page numbers. If it is empty, Gotenberg's `updateIndexes` did not run; if the `.docx` is empty but
  the PDF is fine, `<w:updateFields/>` was lost when the template was re-saved from Word.
- Any `{campos.*}` you added shows the client's value, not `undefined`.

Then run a real `full_pipeline` RFQ and compare the PDF against the `.docx`: headers, footers, logo
and page breaks should match, and the numbering should survive the conversion.
