#!/usr/bin/env node
// Check a client's .docx template against the render vocabulary, BEFORE it reaches a customer.
//
//   node scripts/check-template.js <template.docx> [client_id]
//
// The render node (n8n-nodes-docxtemplater) exposes no nullGetter, so a tag whose key does not
// exist prints the literal word "undefined" into the finished document. Module 4 guards against
// that by emitting the WHOLE catalog vocabulary, empty rather than absent — but it can only
// enumerate what it knows. Two things sit outside that guarantee:
//
//   1. a misspelled catalog tag ({cliente.empressa});
//   2. a {campos.*} tag for a field the client's `Fields` tab does not declare.
//
// Both are invisible until a customer is reading the PDF. This reads every tag in the document,
// its headers and its footers, and reports the ones nothing will fill.
//
// Pass a client_id to also check {campos.*} against seed/<client_id>/proposal-config/fields.csv.

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.join(__dirname, '..');
const { resolveProposalConfig } = require(path.join(ROOT, 'modules/proposal/chapter_catalog'));
const { buildRenderContext } = require(path.join(ROOT, 'modules/proposal/render_context'));
const catalog = require(path.join(ROOT, 'schemas/chapter-catalog.json'));

const file = process.argv[2];
const clientId = process.argv[3];
if (!file) {
  console.error('usage: node scripts/check-template.js <template.docx> [client_id]');
  process.exit(1);
}

function readCsv(f) {
  const text = fs.readFileSync(f, 'utf8');
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

// Build the vocabulary the same way Module 4 does: the whole catalog, every table column, and the
// per-loop field names a template addresses inside {#loop} … {/loop}.
const sheet = {};
if (clientId) {
  const seed = path.join(ROOT, 'seed', clientId, 'proposal-config');
  for (const [tab, f] of [['fields', 'fields.csv'], ['chapters', 'chapters.csv'], ['content', 'content.csv'], ['rules', 'rules.csv'], ['client', 'client.csv'], ['templates', 'templates.csv']]) {
    const p = path.join(seed, f);
    if (fs.existsSync(p)) sheet[tab] = readCsv(p);
  }
  if (!sheet.fields) console.error(`note: no seed/${clientId}/proposal-config/fields.csv — {campos.*} tags cannot be checked`);
}

const cfg = resolveProposalConfig({
  catalog, sheet: Object.keys(sheet).length ? sheet : null,
  language: 'es', scope: {}, has_pricing: true,
});
const { context } = buildRenderContext({
  proposalConfig: cfg, rfq: { language: 'es' }, content: {},
  pricing: { currency: 'EUR', total: 0, lines: [] }, proposalNumber: 'x', fecha: 'y',
});

const valid = new Set(Object.keys(context));
for (const [k, v] of Object.entries(context)) {
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const kk of Object.keys(v)) valid.add(`${k}.${kk}`);
}
for (const cols of Object.values(cfg.table_columns)) for (const c of cols) valid.add(c);
// Names that only exist INSIDE a loop, so they never appear on the context root.
for (const n of ['texto', 'etiqueta', 'numero', 'titulo', 'nivel', 'item', 'cantidad', 'spec', 'concepto', 'precio_unitario', 'importe']) valid.add(n);

const zip = new PizZip(fs.readFileSync(file, 'binary'));
const parts = zip.file(/word\/(document|header\d*|footer\d*)\.xml/).map((f) => f.name);

const problems = [];
const split = [];
let tagCount = 0;

for (const part of parts) {
  const paras = [...zip.file(part).asText().matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0]);
  paras.forEach((p, i) => {
    const runs = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]);
    const text = runs.join('');
    for (const m of text.matchAll(/\{([#/]?)([^{}]+)\}/g)) {
      tagCount += 1;
      const name = m[2].trim();
      if (!valid.has(name)) problems.push({ part, i, tag: m[0], text: text.slice(0, 70) });
      // A tag Word broke across text runs. docxtemplater stitches runs back together before
      // parsing, so this is a warning, not a failure — but it is also how a tag silently stops
      // being a tag after someone edits it in Word, so it is worth seeing.
      if (!runs.some((r) => r.includes(m[0]))) split.push({ part, i, tag: m[0] });
    }
  });
}

console.log(`${path.basename(file)} — ${tagCount} tag(s) across ${parts.length} part(s), vocabulary of ${valid.size} names${clientId ? ` (client: ${clientId})` : ''}`);
if (split.length) {
  // Word's spellchecker splits almost every tag it has ever touched, so this is usually a large
  // number and not a fault: docxtemplater stitches the runs back together before parsing. It is
  // reported as a count because it stops being noise and starts being the explanation the day a
  // single tag mysteriously renders as literal text.
  console.log(`${split.length} of them are split across text runs by Word (normal — docxtemplater rejoins runs before parsing).`);
}
if (problems.length) {
  console.error(`\nFAIL — ${problems.length} tag(s) nothing will fill. Each prints the literal word "undefined" into the customer's document:`);
  for (const p of problems) console.error(`  ${p.tag.padEnd(26)} ${p.part} ¶${p.i}   «${p.text}»`);
  if (!clientId) console.error(`\n(Pass a client_id to resolve {campos.*} against that client's Fields tab.)`);
  process.exit(1);
}
console.log('\nOK — every tag resolves to something the render context will fill.');
