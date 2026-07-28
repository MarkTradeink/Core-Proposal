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
// What comes out is a *seed*. Templates are per-client and live in each client's Google Drive
// folder (docs/TEMPLATE-GUIDE.md) — the onboarding step is to copy one of these, apply the
// client's fonts, colours, logo, header and footer, and upload it. Styling is theirs; the tags
// are ours. Nothing here needs to be regenerated when a client rebrands.
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
  Header, Footer, PageNumber, PageBreak, convertInchesToTwip,
} = require('docx');

const ROOT = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/chapter-catalog.json'), 'utf8'));

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
    tocHint: 'El índice se genera con los capítulos que realmente contiene esta propuesta.',
    confidential: 'Documento confidencial. Su contenido no puede ser reproducido ni comunicado a terceros sin autorización escrita.',
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
    tocHint: 'The contents list is built from the chapters this proposal actually contains.',
    confidential: 'Confidential document. Its content may not be reproduced or disclosed to third parties without written authorisation.',
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

function coverPage(lang) {
  const t = UI[lang];
  const line = (k, v) => new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: `${k}:  `, bold: true, color: ACCENT }), new TextRun(v)],
  });

  return [
    new Paragraph({ text: '', spacing: { after: 1600 } }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: t.proposal, bold: true, size: 40, color: ACCENT })],
    }),
    new Paragraph({
      spacing: { after: 600 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
      children: [new TextRun({ text: '{proyecto.tipo}', size: 32 })],
    }),
    line(t.ref, '{numero_propuesta}'),
    line(t.date, '{fecha}'),
    new Paragraph({ text: '', spacing: { after: 300 } }),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t.prepared, bold: true, color: ACCENT })] }),
    line(t.client, '{cliente.empresa}'),
    line(t.contact, '{cliente.contacto}'),
    line('Email', '{cliente.email}'),
    line(t.location, '{proyecto.ubicacion}'),
    line(t.deadline, '{proyecto.plazo}'),
    new Paragraph({ text: '', spacing: { after: 1200 } }),
    new Paragraph({ children: [new TextRun({ text: t.confidential, size: 16, italics: true, color: '808080' })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
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
  out.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: t.tocHint, size: 16, italics: true, color: '808080' })] }));
  // A deterministic list rather than a Word TOC field: LibreOffice does not refresh field-based
  // tables of contents on the headless PDF conversion, so a field TOC would ship empty or stale.
  // These numbers come from the render context, which numbers exactly what it rendered.
  out.push(tag('{#indice}'));
  out.push(new Paragraph({
    spacing: { after: 40 },
    indent: { left: convertInchesToTwip(0.25) },
    children: [new TextRun({ text: '{numero}', bold: true }), new TextRun('  {titulo}')],
  }));
  out.push(tag('{/indice}'));
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

function buildDocument(lang) {
  const t = UI[lang];
  const children = [];

  children.push(...coverPage(lang));
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
    title: t.proposal,
    description: 'Cifral seed proposal template — see docs/TEMPLATE-GUIDE.md',
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
            children: [new TextRun({ text: '{numero_propuesta}  ·  {cliente.empresa}', size: 16, color: '808080' })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `${t.page} `, size: 16, color: '808080' }),
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

(async () => {
  const outDir = __dirname;
  for (const lang of ['es', 'en']) {
    const buffer = await Packer.toBuffer(buildDocument(lang));
    const file = path.join(outDir, `proposal-template-${lang}.docx`);
    fs.writeFileSync(file, buffer);
    console.log(`wrote ${path.relative(ROOT, file)} (${(buffer.length / 1024).toFixed(0)} KB)`);
  }
  const ids = [];
  for (const g of ['front_matter', 'chapters', 'annexes']) {
    for (const c of catalog[g]) { ids.push(c.id); for (const s of c.sections || []) ids.push(s.id); }
  }
  console.log(`${ids.length} conditional blocks, ${Object.keys(catalog.tables).length} table loops`);
})();
