#!/usr/bin/env node
// Render a seed template against a synthetic proposal, the same way Module 4 does.
//
//   npm install --no-save docxtemplater pizzip jexl
//   node scripts/render-sample.js [es|en] [A|B|C] [client_id] [--template <file.docx>]
//
// This is the offline half of the end-to-end check: it exercises the real chain
// catalog -> resolveProposalConfig -> buildRenderContext -> docxtemplater against the real
// template, so a broken tag, a mis-parsed loop or a missing key shows up here rather than in a
// customer's inbox. It deliberately mirrors the two settings the n8n render node imposes:
// paragraphLoop + linebreaks, and Jexl as the expression parser.
//
// After it writes the .docx, convert and look at it:
//   soffice --headless --convert-to pdf --outdir /tmp out.docx

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const jexl = require('jexl');

const ROOT = path.join(__dirname, '..');
const { resolveProposalConfig } = require(path.join(ROOT, 'modules/proposal/chapter_catalog'));
const { buildRenderContext } = require(path.join(ROOT, 'modules/proposal/render_context'));
const { captureFields } = require(path.join(ROOT, 'modules/proposal/field_capture'));
const catalog = require(path.join(ROOT, 'schemas/chapter-catalog.json'));

const lang = process.argv[2] === 'en' ? 'en' : 'es';
const tier = ['A', 'B', 'C'].includes(process.argv[3]) ? process.argv[3] : 'B';
// Any client whose CSVs are in seed/<id>/proposal-config/ can be checked the same way — which is
// how a real client's clause library gets validated before a single row reaches Drive.
const clientId = (process.argv[4] && !process.argv[4].startsWith('--')) ? process.argv[4] : 'demo_client';
// A client's OWN restyled .docx can be rendered here too. That is the only way to find out,
// before a customer does, whether their template survives a real chapter set.
const tplIdx = process.argv.indexOf('--template');
const templateOverride = tplIdx !== -1 ? process.argv[tplIdx + 1] : null;

// The n8n node swaps docxtemplater's parser for Jexl, so a tag is an expression, not a lookup.
// Reproducing that here is the point — it is why key names may not contain '-' and why loops must
// iterate arrays of named objects.
function jexlParser(tagName) {
  const expr = jexl.compile(tagName);
  return {
    get(scope, context) {
      if (tagName === '.') return scope;
      const scopes = [...(context.scopePathItem ? [] : []), scope];
      try {
        return expr.evalSync({ ...(context.scopeList ? Object.assign({}, ...context.scopeList) : {}), ...scope });
      } catch (e) {
        return undefined;
      }
    },
  };
}

const scope = { materials: true, engineering: true, installation: true, commissioning: true, spare_parts: true, shipping: true, training: true, warranty: true, project_management: true };

// The client's Proposal Config sheet. Read from the demo_client seed CSVs so this check exercises
// the real boilerplate that ships with the product, not a toy fixture — if a clause points at a
// chapter that no longer exists, this is where it surfaces.
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

const SEED = path.join(ROOT, 'seed', clientId, 'proposal-config');
// The three newer tabs are optional: a client sheet created before they existed simply has none,
// and everything still resolves. Reading them the same way keeps that path exercised.
const readTab = (name) => (fs.existsSync(path.join(SEED, name)) ? readCsv(path.join(SEED, name)) : []);
const sheet = {
  chapters: readCsv(path.join(SEED, 'chapters.csv')),
  content: readCsv(path.join(SEED, 'content.csv')),
  rules: readCsv(path.join(SEED, 'rules.csv')),
  client: readTab('client.csv'),
  templates: readTab('templates.csv'),
  fields: readTab('fields.csv'),
};
sheet.rules = sheet.rules.filter((r) => r.key !== 'default_tier').concat([{ key: 'default_tier', value: tier }]);

const proposalConfig = resolveProposalConfig({
  catalog, sheet, tier, language: lang, scope, has_pricing: true, sheet_id: 'demo-sheet',
});

// Stand-in for what the A1/A2/A3 agents return.
const sections = {};
const tables = {};
const LOREM = {
  es: ['La solución propuesta sustituye los variadores obsoletos manteniendo la estructura mecánica existente.', 'Se despliega una red de control segmentada, con acceso remoto a través de un punto único auditado.'],
  en: ['The proposed solution replaces the obsolete drives while retaining the existing mechanical structure.', 'A segmented control network is deployed, with remote access through a single audited entry point.'],
}[lang];

for (const ch of proposalConfig.chapters) {
  const targets = [ch, ...ch.sections];
  for (const s of targets) {
    if (s.content_type === 'boilerplate' || s.content_type === 'calculated') continue;
    sections[s.id] = `${LOREM[0]}\n\n${LOREM[1]}\n\n•  ${lang === 'es' ? 'Punto uno' : 'Point one'}\n•  ${lang === 'es' ? 'Punto dos' : 'Point two'}`;
    for (const t of s.tables || []) {
      const cols = proposalConfig.table_columns[t] || [];
      tables[t] = [1, 2].map((i) => Object.fromEntries(cols.map((c) => [c, `${c} ${i}`])));
    }
  }
}

// What Module 1 does with the client's declared `request` fields: a deterministic, label-driven
// read of the RFQ text. Running it here means the seed's own capture labels are checked on every
// build — a label that stops matching is otherwise invisible until a cover page comes out blank.
const rfqText = [
  lang === 'es' ? 'Buenos dias,' : 'Good morning,',
  '',
  'Att. Santiago Luna',
  'Oferta nº: 905149921',
  'Asset: A-4471',
  'Project number: PRJ-2027-014',
  '',
  lang === 'es' ? 'Adjunto la solicitud de oferta.' : 'Please find our request attached.',
].join('\n');
const { values: capturedFields } = captureFields(rfqText, proposalConfig.fields);

const { context, sections_rendered, fields_missing } = buildRenderContext({
  proposalConfig,
  proposalNumber: 'PROP-20260726-DEMO01',
  fecha: lang === 'es' ? '26/07/2026' : '2026-07-26',
  rfq: {
    language: lang,
    client: { company: 'Aeropuertos Demo S.A.', contact_name: 'Ana', contact_last_name: 'Ruiz', email: 'ana@demo.example', phone: '+34 600 000 000' },
    project: { type: lang === 'es' ? 'Modernización de sistema de clasificación' : 'Sortation system modernisation', location: 'Fuerteventura', desired_deadline: 'Q2 2027' },
    technical_requirements: [
      { item: lang === 'es' ? 'Variador de frecuencia' : 'Variable frequency drive', quantity: 15, spec: '4 kW, IP54' },
      { item: lang === 'es' ? 'Armario de control' : 'Control cabinet', quantity: 3, spec: 'IP54' },
    ],
    scope_of_supply: scope,
    custom_fields: capturedFields,
  },
  content: { sections, tables },
  pricing: {
    currency: 'EUR', total: 503000, payment_terms: '30% / 40% / 30%',
    lines: [
      { category: 'materials', amount: 240000, sell_amount: 311000 },
      { category: 'engineering', hours: 640, rate: 85, amount: 54400, sell_amount: 92000 },
      { category: 'assembly', hours: 900, rate: 55, amount: 49500, sell_amount: 100000 },
    ],
  },
});

const templatePath = templateOverride || path.join(ROOT, `templates/proposal-template-${lang}.docx`);
const zip = new PizZip(fs.readFileSync(templatePath, 'binary'));
const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, parser: jexlParser });

let failed = false;
try {
  doc.render(context);
} catch (e) {
  failed = true;
  const errs = (e.properties && e.properties.errors) || [e];
  console.error(`RENDER FAILED (${errs.length} error(s)):`);
  for (const err of errs.slice(0, 20)) {
    console.error(`  ${err.properties ? err.properties.explanation || err.properties.id : err.message}`);
  }
}
if (failed) process.exit(1);

const out = path.join(ROOT, `templates/sample-${clientId === 'demo_client' ? '' : `${clientId}-`}${lang}-tier${tier}.docx`);
fs.writeFileSync(out, doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

// The two failure modes that reach a customer silently.
const xml = doc.getZip().file('word/document.xml').asText();
const stripped = xml.replace(/<[^>]+>/g, '');
const problems = [];
if (stripped.includes('undefined')) problems.push('the literal word "undefined" is in the output — a tag name is misspelled');
const leftover = stripped.match(/[{}]/g);
if (leftover) problems.push(`${leftover.length} unrendered brace(s) left in the output`);

console.log(`rendered ${path.relative(ROOT, out)}`);
console.log(`tier ${tier} / ${lang} — ${proposalConfig.chapters.length} chapters selected, ${sections_rendered.length} keys rendered, ${context.indice.length} index entries`);
console.log(`clauses applied: ${proposalConfig.clauses.length} of ${sheet.content.length} rows in the sheet`);
console.log(`client fields: ${Object.entries(context.campos).map(([k, v]) => `${k}=${v || '\u2014'}`).join(', ') || '(none declared)'}`);
if (fields_missing.length) {
  console.error(`\nFAIL \u2014 required client field(s) with no value: ${fields_missing.join(', ')}`);
  process.exit(1);
}
if (proposalConfig.warnings.length) {
  console.error(`\nFAIL — the client config produced ${proposalConfig.warnings.length} warning(s):`);
  for (const w of proposalConfig.warnings) console.error(`  ${w}`);
  process.exit(1);
}
if (problems.length) {
  console.error(`\nFAIL:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\nOK — no "undefined", no stray braces.');
