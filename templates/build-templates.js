#!/usr/bin/env node
// Generate the seed .docx proposal templates from schemas/chapter-catalog.json.
//
//   npm install && node templates/build-templates.js
//
// Why generate instead of hand-building in Word: the template is a SUPERSET of ~105 conditional
// blocks that has to agree exactly with the render context, key for key. A human maintaining that
// by hand is the drift the whole rework is meant to remove. Change the catalog, re-run this, and
// the template follows.
//
// Four files come out:
//
//   proposal-template-es.docx  proposal-template-en.docx        the neutral SEEDS
//   demo-proposal-template-es.docx  demo-proposal-template-en.docx   what demo@cifral.io sends
//
// The seeds are per-client starting points: the onboarding step is to copy one, apply the
// client's fonts, colours, logo, header and footer, and upload it (docs/TEMPLATE-GUIDE.md).
// Styling is theirs; the tags are ours. Nothing here needs regenerating when a client rebrands.
//
// The demo pair is a finished document rather than a starting point, because it goes straight
// out to strangers who emailed an RFQ to demo@cifral.io. It differs from the seeds in two ways
// that both matter:
//
//   1. It says what it is, on the cover, in the header, in the footer and in a notice page of
//      its own — a demonstration built from a demo template, not a commercial offer. A prospect
//      must not be able to mistake generic seed content for a real quotation.
//   2. It carries demo_client's OWN cover variables, read from seed/demo_client/proposal-config/
//      fields.csv. A {campos.*} tag for a key the client's Fields tab does not declare renders
//      the literal word 'undefined', so those tags can only be generated per client — which is
//      exactly the mechanism the demo is meant to show off.
//
// Two mechanics carry the whole design:
//
//   1. Every chapter sits inside {#has_<id>} … {/has_<id>} with the tags ALONE on their own
//      paragraphs, so a chapter that is out of tier or out of scope disappears heading and all.
//   2. Headings carry Word multilevel numbering rather than typed numbers. When docxtemplater
//      deletes a chapter, Word (and LibreOffice, on the PDF leg) renumbers what is left, so the
//      reader never sees a jump from 1 to 4. The {numero} values in the render context are
//      computed the same way, which is what keeps the table of contents honest.

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, TableLayoutType,
  HeadingLevel, AlignmentType, LevelFormat, WidthType, BorderStyle, ShadingType,
  Header, Footer, PageNumber, PageBreak, TableOfContents, convertInchesToTwip,
} = require('docx');

const ROOT = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/chapter-catalog.json'), 'utf8'));
const { parseFieldDefinitions } = require(path.join(ROOT, 'modules/proposal/field_capture'));

// Same CSV reader as scripts/client-docs.js and scripts/render-sample.js — quoted fields,
// embedded commas and newlines.
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}

/**
 * A client's declared cover variables, from their own `Fields` tab.
 *
 * Parsed through the SAME parseFieldDefinitions() the pipeline uses, so a row this generator
 * would put on the cover is exactly a row the capture will fill — a key rejected there (bad
 * name, unknown source, no capture_label) never reaches a template either.
 */
function clientFields(clientId) {
  if (!clientId) return [];
  const file = path.join(ROOT, 'seed', clientId, 'proposal-config', 'fields.csv');
  if (!fs.existsSync(file)) return [];
  return parseFieldDefinitions(readCsv(file), []);
}

const ACCENT = '1F3864';
const RULE = 'BFBFBF';
const HEADER_BG = 'EDF0F5';

const UI = {
  es: {
    proposal: 'PROPUESTA TÉCNICO-COMERCIAL',
    ref: 'Referencia',
    date: 'Fecha',
    client: 'Cliente',
    contact: 'Contacto',
    project: 'Proyecto',
    location: 'Emplazamiento',
    deadline: 'Plazo solicitado',
    prepared: 'Preparado para',
    requirements: 'Requisitos técnicos recogidos en la solicitud',
    included: 'Incluido en el alcance',
    excluded: 'No incluido en el alcance',
    priceTable: 'Desglose económico',
    total: 'TOTAL',
    paymentTerms: 'Condiciones de pago',
    page: 'Página',
    of: 'de',
    confidential: 'Documento confidencial. Su contenido no puede ser reproducido ni comunicado a terceros sin autorización escrita.',
    demoBadge: 'DEMOSTRACIÓN · PLANTILLA DE EJEMPLO',
    demoCover: 'Documento de demostración generado automáticamente. No constituye oferta ni compromiso comercial.',
    demoFields: 'Las líneas de arriba salen de la pestaña «Fields» de la hoja de configuración de este cliente. Cada cliente declara las suyas.',
    demoTitle: 'Sobre este documento',
    demoIntro: 'Este documento lo ha generado Cifral de forma automática a partir del RFQ que usted envió a demo@cifral.io. Es una demostración: la estructura, los capítulos y el mecanismo son reales, pero el contenido, los precios, los plazos y las condiciones proceden de una plantilla de ejemplo con datos genéricos. No es una oferta y nada de lo que contiene es vinculante.',
    demoWhatReal: 'Lo que sí es real es cómo se ha hecho:',
    demoRealBullets: [
      'El texto específico del proyecto lo han escrito agentes a partir de su solicitud; el articulado contractual no lo escribe ningún modelo: sale tal cual de la hoja de cálculo del cliente.',
      'Los capítulos que aparecen, su orden y su título los decide la configuración de este cliente junto con el peso del documento y el alcance de suministro solicitado.',
      'El índice, la numeración de capítulos y las referencias cruzadas los genera Word: si un capítulo no aplica, desaparece y el resto se renumera solo.',
      'Las tablas de precios se calculan con la tarifa y las reglas de margen del cliente.',
      'La portada admite las variables propias del cliente: número de oferta, activo, razón social, persona de contacto.',
    ],
    demoAdaptTitle: 'Qué cambia en una implantación real',
    demoAdapt: 'Esta plantilla se sustituye por la de su empresa: su portada, su logotipo, sus tipografías, sus encabezados y su pie de página se conservan exactamente, y el sistema sólo rellena el contenido. Los capítulos, sus títulos, las cláusulas fijas, las variables de portada y las reglas de estilo se configuran desde una hoja de cálculo, sin tocar código ni desplegar nada.',
    demoContact: '¿Quiere verlo con su plantilla y su texto? Responda al correo que acompaña a este documento.',
  },
  en: {
    proposal: 'TECHNICAL & COMMERCIAL PROPOSAL',
    ref: 'Reference',
    date: 'Date',
    client: 'Client',
    contact: 'Contact',
    project: 'Project',
    location: 'Site',
    deadline: 'Requested deadline',
    prepared: 'Prepared for',
    requirements: 'Technical requirements stated in the request',
    included: 'Included in the scope',
    excluded: 'Not included in the scope',
    priceTable: 'Price breakdown',
    total: 'TOTAL',
    paymentTerms: 'Payment terms',
    page: 'Page',
    of: 'of',
    confidential: 'Confidential document. Its content may not be reproduced or disclosed to third parties without written authorisation.',
    demoBadge: 'DEMONSTRATION · SAMPLE TEMPLATE',
    demoCover: 'Automatically generated demonstration document. It is not an offer and carries no commercial commitment.',
    demoFields: 'The lines above come from the «Fields» tab of this client\u2019s configuration sheet. Every client declares their own.',
    demoTitle: 'About this document',
    demoIntro: 'Cifral generated this document automatically from the RFQ you sent to demo@cifral.io. It is a demonstration: the structure, the chapters and the mechanism are real, but the content, prices, lead times and terms come from a sample template filled with generic data. It is not an offer and nothing in it is binding.',
    demoWhatReal: 'What is real is how it was produced:',
    demoRealBullets: [
      'The project-specific text was written by agents from your own request; the contractual wording is written by no model at all — it comes straight out of the client\u2019s spreadsheet.',
      'Which chapters appear, in what order and under what title is decided by this client\u2019s configuration together with the document weight and the scope of supply requested.',
      'The contents list, the chapter numbering and the cross-references are generated by Word: a chapter that does not apply disappears and the rest renumber themselves.',
      'Price tables are computed from the client\u2019s own rate card and margin rules.',
      'The cover carries the client\u2019s own variables: offer number, asset number, legal entity, attention line.',
    ],
    demoAdaptTitle: 'What changes in a real deployment',
    demoAdapt: 'This template is replaced by your own: your cover, your logo, your fonts, your headers and your footer are preserved exactly, and the system only fills in the content. Chapters, their titles, the fixed clauses, the cover variables and the house style rules are all configured from a spreadsheet — no code, no deployment.',
    demoContact: 'Want to see it with your template and your wording? Reply to the email this document came with.',
  },
};

// --------------------------------------------------------------------------- helpers

// A bare paragraph carrying nothing but a docxtemplater tag. These lines vanish from the rendered
// document — and they MUST be alone on their line: written inline, docxtemplater repeats only the
// text inside the paragraph and every list item collapses into one run-on line.
const tag = (t) => new Paragraph({ children: [new TextRun({ text: t, size: 14, color: '9AA5B1' })], spacing: { before: 0, after: 0 } });

const body = (children, opts = {}) => new Paragraph({ children, spacing: { after: 120 }, ...opts });

function heading(text, level, numbering) {
  return new Paragraph({
    heading: level,
    numbering,
    // The contents list is a real Word TOC field collecting outline levels 1-2. Front matter and
    // the fixed pages are Heading 1s for the navigation pane's sake but carry no chapter number,
    // and a contents list that opens with 'Indice ....... 2' is noise — so anything unnumbered is
    // pushed off the outline and the TOC never sees it. Same rule the generated list used.
    outlineLevel: numbering ? undefined : 9,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 320 : 220, after: 120 },
    children: [new TextRun(text)],
  });
}

function label(lang, col) {
  const entry = catalog.column_labels[col];
  return (entry && entry[lang]) || col;
}

function cell(children, width, opts = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children,
    ...opts,
  });
}

// Table-row loops are the one place inline tags are correct: docxtemplater detects that the tags
// span a table row and repeats the row itself.
function loopTable(tableId, lang) {
  const def = catalog.tables[tableId];
  const cols = def.columns;
  const TOTAL = 9360; // 6.5in at 1440 dxa/in
  const w = Math.floor(TOTAL / cols.length);
  const widths = cols.map((_, i) => (i === cols.length - 1 ? TOTAL - w * (cols.length - 1) : w));

  const header = new TableRow({
    tableHeader: true,
    children: cols.map((c, i) => cell(
      [new Paragraph({ children: [new TextRun({ text: label(lang, c), bold: true, color: ACCENT })] })],
      widths[i],
      { shading: { type: ShadingType.CLEAR, fill: HEADER_BG } },
    )),
  });

  const dataRow = new TableRow({
    children: cols.map((c, i) => {
      const open = i === 0 ? `{#${tableId}}` : '';
      const close = i === cols.length - 1 ? `{/${tableId}}` : '';
      return cell([new Paragraph({ children: [new TextRun(`${open}{${c}}${close}`)] })], widths[i]);
    }),
  });

  return new Table({
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows: [header, dataRow],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
  });
}

// The body of any chapter or subsection: prose, then bullets, then its tables. Identical shape for
// every id, which is what lets the whole template be generated.
function contentBlock(entry, lang) {
  const id = entry.id;
  const out = [
    tag(`{#${id}.parrafos}`),
    body([new TextRun('{texto}')]),
    tag(`{/${id}.parrafos}`),
    tag(`{#${id}.bullets}`),
    new Paragraph({ children: [new TextRun('{texto}')], bullet: { level: 0 }, spacing: { after: 60 } }),
    tag(`{/${id}.bullets}`),
  ];
  for (const t of entry.tables || []) {
    if (!catalog.tables[t]) continue;
    out.push(tag(`{#has_${t}}`));
    out.push(loopTable(t, lang));
    out.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    out.push(tag(`{/has_${t}}`));
  }
  return out;
}

function chapterBlock(entry, lang, { numbered }) {
  const id = entry.id;
  const out = [tag(`{#has_${id}}`)];
  out.push(heading(`{${id}.titulo}`, HeadingLevel.HEADING_1,
    numbered ? { reference: numbered, level: 0 } : undefined));
  out.push(...contentBlock(entry, lang));

  for (const s of entry.sections || []) {
    out.push(tag(`{#has_${s.id}}`));
    out.push(heading(`{${s.id}.titulo}`, HeadingLevel.HEADING_2,
      numbered ? { reference: numbered, level: 1 } : undefined));
    out.push(...contentBlock(s, lang));
    out.push(tag(`{/has_${s.id}}`));
  }

  out.push(tag(`{/has_${id}}`));
  return out;
}

// --------------------------------------------------------------------------- fixed pages

function coverPage(lang, opts) {
  const t = UI[lang];
  const demo = !!(opts && opts.demo);
  const fields = (opts && opts.fields) || [];
  const line = (k, v) => new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: `${k}:  `, bold: true, color: ACCENT }), new TextRun(v)],
  });

  // The client's own cover variables, from their Fields tab. Only keys that tab declares may be
  // typed into a template — the render context enumerates exactly those, and an undeclared one
  // prints the literal word 'undefined' on a customer's cover.
  //
  // A `request` field always has a capture_label (parseFieldDefinitions rejects it otherwise) and
  // that label is what the sender typed in their email, so printing the value back under the same
  // word is the readable choice. Comma-separated alternatives are ES first, EN second.
  // A `static` field carries no label — it is the issuer's own identity — so the first one goes on
  // its own line above the title and any others join the reference block.
  //
  // `auto` fields are deliberately left OFF the cover. Every one of them mirrors something the
  // pipeline already prints there under its own tag ({numero_propuesta}, {fecha},
  // {documento.version}), so putting them on as well gives the reader the same string twice under
  // two different words. A client who wants theirs on the cover types the tag in by hand.
  const labelled = fields.filter((f) => f.source === 'request' && f.labels.length);
  const unlabelled = fields.filter((f) => f.source === 'static' && !f.labels.length);
  // The printed label: the client's `es:` / `en:` tag when they set one, otherwise the first
  // alternative they declared. Position alone is not a language — 'Asset, Activo' and
  // 'Oferta nº, Offer no' order the two languages opposite ways round — so nothing is inferred
  // from it. The trailing punctuation goes because the cover adds its own colon.
  const fieldLabel = (f) => ((f.label_by_lang && f.label_by_lang[lang]) || f.labels[0]).replace(/[:.]+$/, '');

  const out = [];

  if (demo) {
    out.push(new Paragraph({ text: '', spacing: { after: 700 } }));
    out.push(new Paragraph({
      spacing: { after: 240 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 },
      },
      children: [new TextRun({ text: t.demoBadge, bold: true, size: 20, color: ACCENT, characterSpacing: 40 })],
    }));
  } else {
    out.push(new Paragraph({ text: '', spacing: { after: 1600 } }));
  }

  // Only the FIRST unlabelled field goes above the title — that is the issuing legal entity on
  // every cover this has been modelled on. The rest sit with the reference block.
  if (unlabelled.length) {
    out.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: `{campos.${unlabelled[0].key}}`, bold: true, size: 24, color: ACCENT })],
    }));
  }

  out.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: t.proposal, bold: true, size: 40, color: ACCENT })],
  }));
  // `titulo` is the project's own title as the sender words it, falling back to `tipo` when the
  // RFQ never names the project — so a cover that used to print the type is not made worse by it.
  out.push(new Paragraph({
    spacing: { after: 600 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
    children: [new TextRun({ text: '{proyecto.titulo}', size: 32 })],
  }));

  out.push(line(t.ref, '{numero_propuesta}'));
  out.push(line(t.date, '{fecha}'));
  for (const f of labelled) out.push(line(fieldLabel(f), `{campos.${f.key}}`));
  for (const f of unlabelled.slice(1)) out.push(line(f.key.replace(/_/g, ' '), `{campos.${f.key}}`));
  if (demo && fields.length) {
    out.push(new Paragraph({
      spacing: { before: 80, after: 0 },
      children: [new TextRun({ text: t.demoFields, size: 15, italics: true, color: '808080' })],
    }));
  }

  out.push(new Paragraph({ text: '', spacing: { after: 300 } }));
  out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t.prepared, bold: true, color: ACCENT })] }));
  out.push(line(t.client, '{cliente.empresa}'));
  out.push(line(t.contact, '{cliente.contacto}'));
  out.push(line('Email', '{cliente.email}'));
  out.push(line(t.location, '{proyecto.ubicacion}'));
  out.push(line(t.deadline, '{proyecto.plazo}'));

  out.push(new Paragraph({ text: '', spacing: { after: demo ? 600 : 1200 } }));
  if (demo) {
    out.push(new Paragraph({
      spacing: { after: 160 },
      shading: { type: ShadingType.CLEAR, fill: HEADER_BG },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
      children: [new TextRun({ text: t.demoCover, bold: true, size: 18, color: ACCENT })],
    }));
  }
  out.push(new Paragraph({ children: [new TextRun({ text: t.confidential, size: 16, italics: true, color: '808080' })] }));
  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

// The demo's own page: what this document is, what about it is real, and what changes when it is
// somebody's actual template. Static text, no tags — it renders identically whatever the RFQ says.
//
// Its heading carries no chapter numbering, which (see heading()) pushes it off the outline, so
// the contents list skips it exactly as it skips the cover and the version table.
function demoNotice(lang) {
  const t = UI[lang];
  const out = [];
  out.push(heading(t.demoTitle, HeadingLevel.HEADING_1));
  out.push(body([new TextRun(t.demoIntro)]));
  out.push(body([new TextRun({ text: t.demoWhatReal, bold: true })]));
  for (const b of t.demoRealBullets) {
    out.push(new Paragraph({ children: [new TextRun(b)], bullet: { level: 0 }, spacing: { after: 60 } }));
  }
  out.push(heading(t.demoAdaptTitle, HeadingLevel.HEADING_2));
  out.push(body([new TextRun(t.demoAdapt)]));
  out.push(new Paragraph({
    spacing: { before: 160, after: 120 },
    shading: { type: ShadingType.CLEAR, fill: HEADER_BG },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
    children: [new TextRun({ text: t.demoContact, bold: true, color: ACCENT })],
  }));
  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

function versionAndToc(lang) {
  const t = UI[lang];
  const out = [];

  out.push(tag('{#has_control_version}'));
  out.push(heading('{control_version.titulo}', HeadingLevel.HEADING_1));
  out.push(tag('{#has_tabla_versiones}'));
  out.push(loopTable('tabla_versiones', lang));
  out.push(tag('{/has_tabla_versiones}'));
  out.push(tag('{/has_control_version}'));

  out.push(tag('{#has_indice}'));
  out.push(heading(lang === 'es' ? 'Índice' : 'Contents', HeadingLevel.HEADING_1));
  // A REAL Word table of contents, with page numbers and working links.
  //
  // The earlier design used a generated list without page numbers, on the belief that the
  // headless PDF leg could not refresh field-based tables of contents. That is true of a bare
  // `soffice --convert-to pdf`, but the conversion actually runs through Gotenberg's LibreOffice
  // route, whose `updateIndexes` property defaults to true and refreshes indexes before
  // converting — so the PDF gets real page numbers.
  //
  // `features.updateFields` below covers the other half: without it the .docx the client opens
  // would show an empty contents list until someone pressed F9, because docxtemplater writes the
  // new headings without touching the field's cached result.
  //
  // The render context still emits `indice` / `tabla_indice`, so a client template that already
  // uses the generated list keeps working — see docs/TEMPLATE-GUIDE.md.
  out.push(new TableOfContents(lang === 'es' ? 'Índice' : 'Contents', {
    hyperlink: true,
    headingStyleRange: '1-2',
  }));
  out.push(tag('{/has_indice}'));

  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

// The RFQ read-back. Not a catalog chapter: it is the reseller's own safety net, showing what the
// extractor understood before the narrative starts. Keeping the "not included" list visible is
// what lets them catch a mis-extracted scope before the proposal reaches their customer.
function requestSummary(lang) {
  const t = UI[lang];
  const out = [];

  out.push(tag('{#has_requisitos}'));
  out.push(heading(t.requirements, HeadingLevel.HEADING_2));
  const widths = [4680, 1200, 3480];
  out.push(new Table({
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [label(lang, 'concepto'), label(lang, 'cantidad'), lang === 'es' ? 'Especificación' : 'Specification']
          .map((h, i) => cell([new Paragraph({ children: [new TextRun({ text: h, bold: true, color: ACCENT })] })], widths[i],
            { shading: { type: ShadingType.CLEAR, fill: HEADER_BG } })),
      }),
      new TableRow({
        children: ['{#requisitos}{item}', '{cantidad}', '{spec}{/requisitos}']
          .map((v, i) => cell([new Paragraph({ children: [new TextRun(v)] })], widths[i])),
      }),
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
  }));
  out.push(new Paragraph({ text: '', spacing: { after: 160 } }));
  out.push(tag('{/has_requisitos}'));

  for (const [flag, loop, title] of [
    ['has_alcance_incluido', 'alcance_incluido', t.included],
    ['has_alcance_excluido', 'alcance_excluido', t.excluded],
  ]) {
    out.push(tag(`{#${flag}}`));
    out.push(heading(title, HeadingLevel.HEADING_2));
    out.push(tag(`{#${loop}}`));
    out.push(new Paragraph({ children: [new TextRun('{etiqueta}')], bullet: { level: 0 }, spacing: { after: 60 } }));
    out.push(tag(`{/${loop}}`));
    out.push(tag(`{/${flag}}`));
  }
  return out;
}

// The price table is the one chapter whose body is not a text section: it comes from Module 3 and
// is already formatted for the locale, so never apply Word number formatting on top.
function priceTable(lang) {
  const t = UI[lang];
  const widths = [4200, 1300, 1830, 2030];
  const head = [label(lang, 'concepto'), label(lang, 'cantidad'),
    lang === 'es' ? 'Precio unitario' : 'Unit price', label(lang, 'importe')];

  return [
    tag('{#pricing.has_lineas}'),
    new Table({
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          tableHeader: true,
          children: head.map((h, i) => cell([new Paragraph({
            alignment: i >= 1 ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [new TextRun({ text: h, bold: true, color: ACCENT })],
          })], widths[i], { shading: { type: ShadingType.CLEAR, fill: HEADER_BG } })),
        }),
        new TableRow({
          children: ['{#pricing.lineas}{concepto}', '{cantidad}', '{precio_unitario}', '{importe}{/pricing.lineas}']
            .map((v, i) => cell([new Paragraph({
              alignment: i >= 1 ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: [new TextRun(v)],
            })], widths[i])),
        }),
        new TableRow({
          children: [t.total, '', '', '{pricing.total}'].map((v, i) => cell([new Paragraph({
            alignment: i >= 1 ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [new TextRun({ text: v, bold: true })],
          })], widths[i], { shading: { type: ShadingType.CLEAR, fill: HEADER_BG } })),
        }),
      ],
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
        left: { style: BorderStyle.SINGLE, size: 4, color: RULE },
        right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
        insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      },
    }),
    new Paragraph({ text: '', spacing: { after: 120 } }),
    tag('{/pricing.has_lineas}'),
    body([new TextRun({ text: `${t.paymentTerms}: `, bold: true }), new TextRun('{pricing.condiciones_pago}')]),
  ];
}

// --------------------------------------------------------------------------- document

function buildDocument(lang, opts) {
  const t = UI[lang];
  const demo = !!(opts && opts.demo);
  const fields = (opts && opts.fields) || [];
  const children = [];

  children.push(...coverPage(lang, { demo, fields }));
  if (demo) children.push(...demoNotice(lang));
  children.push(...versionAndToc(lang));

  // Glossary sits with the front matter but is a normal catalog chapter.
  for (const fm of catalog.front_matter) {
    if (['portada', 'control_version', 'indice'].includes(fm.id)) continue;
    children.push(...chapterBlock(fm, lang, { numbered: null }));
  }

  children.push(...requestSummary(lang));

  for (const ch of catalog.chapters) {
    if (ch.id === 'oferta_economica') {
      // Same conditional shape as everything else, with the price table spliced into the
      // summary subsection.
      children.push(tag(`{#has_${ch.id}}`));
      children.push(heading(`{${ch.id}.titulo}`, HeadingLevel.HEADING_1, { reference: 'chapters', level: 0 }));
      children.push(...contentBlock(ch, lang));
      for (const s of ch.sections) {
        children.push(tag(`{#has_${s.id}}`));
        children.push(heading(`{${s.id}.titulo}`, HeadingLevel.HEADING_2, { reference: 'chapters', level: 1 }));
        if (s.id === 'oferta_economica_resumen') children.push(...priceTable(lang));
        children.push(...contentBlock(s, lang));
        children.push(tag(`{/has_${s.id}}`));
      }
      children.push(tag(`{/has_${ch.id}}`));
      continue;
    }
    children.push(...chapterBlock(ch, lang, { numbered: 'chapters' }));
  }

  for (const ax of catalog.annexes) {
    children.push(...chapterBlock(ax, lang, { numbered: 'annexes' }));
  }

  return new Document({
    creator: 'Cifral',
    // Marks the document's fields dirty so Word repaginates the table of contents when the
    // client opens the .docx. The PDF leg is covered by Gotenberg's updateIndexes.
    features: { updateFields: true },
    title: demo ? `${t.proposal} — ${t.demoBadge}` : t.proposal,
    description: demo
      ? 'Cifral DEMO proposal template — sample document, not a commercial offer. See docs/TEMPLATE-GUIDE.md'
      : 'Cifral seed proposal template — see docs/TEMPLATE-GUIDE.md',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 21 }, paragraph: { spacing: { line: 276 } } },
        heading1: { run: { font: 'Calibri', size: 30, bold: true, color: ACCENT } },
        heading2: { run: { font: 'Calibri', size: 24, bold: true, color: ACCENT } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'chapters',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 0, hanging: 400 } } } },
            { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 0, hanging: 520 } } } },
          ],
        },
        {
          reference: 'annexes',
          levels: [
            { level: 0, format: LevelFormat.UPPER_LETTER, text: `${lang === 'es' ? 'Anexo' : 'Annex'} %1.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 0, hanging: 1100 } } } },
            { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 0, hanging: 520 } } } },
          ],
        },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
            children: [new TextRun({
              text: demo ? 'DEMO  ·  {numero_propuesta}  ·  {cliente.empresa}' : '{numero_propuesta}  ·  {cliente.empresa}',
              size: 16,
              color: '808080',
            })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            // The demo marker sits on the SAME line as the page number, tabbed left, so a reader
            // who only ever sees one page of the PDF still sees it. A watermark would not survive
            // a client restyling the file, and this is meant to survive.
            alignment: AlignmentType.RIGHT,
            children: [
              ...(demo ? [new TextRun({ text: `${t.demoBadge}\t`, size: 14, color: ACCENT, bold: true })] : []),
              new TextRun({ text: `${t.page} `, size: 16, color: '808080' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '808080' }),
              new TextRun({ text: ` ${t.of} `, size: 16, color: '808080' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '808080' })],
          })],
        }),
      },
      children,
    }],
  });
}

// The demo pair carries demo_client's declared cover variables; the seeds carry none, because a
// {campos.*} tag is only safe once some client's Fields tab declares that key.
const VARIANTS = [
  { prefix: 'proposal-template', demo: false, client: null },
  { prefix: 'demo-proposal-template', demo: true, client: 'demo_client' },
];

(async () => {
  const outDir = __dirname;
  for (const variant of VARIANTS) {
    const fields = clientFields(variant.client);
    for (const lang of ['es', 'en']) {
      const buffer = await Packer.toBuffer(buildDocument(lang, { demo: variant.demo, fields }));
      const file = path.join(outDir, `${variant.prefix}-${lang}.docx`);
      fs.writeFileSync(file, buffer);
      const extra = fields.length ? `, ${fields.length} client field(s)` : '';
      console.log(`wrote ${path.relative(ROOT, file)} (${(buffer.length / 1024).toFixed(0)} KB${extra})`);
    }
  }
  const ids = [];
  for (const g of ['front_matter', 'chapters', 'annexes']) {
    for (const c of catalog[g]) { ids.push(c.id); for (const s of c.sections || []) ids.push(s.id); }
  }
  console.log(`${ids.length} conditional blocks, ${Object.keys(catalog.tables).length} table loops`);
})();
