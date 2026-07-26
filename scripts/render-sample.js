#!/usr/bin/env node
// Render a seed template against a synthetic proposal, the same way Module 4 does.
//
//   npm install --no-save docxtemplater pizzip jexl
//   node scripts/render-sample.js [es|en] [A|B|C]
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
const catalog = require(path.join(ROOT, 'schemas/chapter-catalog.json'));

const lang = process.argv[2] === 'en' ? 'en' : 'es';
const tier = ['A', 'B', 'C'].includes(process.argv[3]) ? process.argv[3] : 'B';

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

const sheet = {
  chapters: [],
  content: [
    { kind: 'clause', id: 'gar_alcance', chapter_id: 'garantia_soporte_alcance', lang, applies_when: 'always', title: '', body: 'Periodo de garantía de 24 meses desde la aceptación final.\n\nCubre defectos de material y de fabricación en los equipos suministrados.' },
    { kind: 'clause', id: 'cg_marco', chapter_id: 'condiciones_generales_marco', lang, applies_when: 'always', title: '', body: 'Aplican las condiciones generales Orgalime SI 24, salvo lo expresamente modificado en esta oferta.' },
    { kind: 'premise', id: 'pre_01', chapter_id: 'limites_alcance_premisas', lang, applies_when: 'always', title: '', body: 'La documentación facilitada refleja la instalación actual.' },
    { kind: 'premise', id: 'pre_02', chapter_id: 'limites_alcance_premisas', lang, applies_when: 'scope:installation', title: '', body: 'Se dispone de acceso al área de trabajo en las ventanas acordadas.' },
    { kind: 'exclusion', id: 'exc_01', chapter_id: 'limites_alcance_exclusiones', lang, applies_when: 'always', title: '', body: 'Obra civil de cualquier naturaleza.' },
    { kind: 'exclusion', id: 'exc_02', chapter_id: 'limites_alcance_exclusiones', lang, applies_when: 'always', title: '', body: 'Suministro eléctrico hasta el cuadro general.' },
    { kind: 'obligation', id: 'obl_01', chapter_id: 'condiciones_sitio_obligaciones', lang, applies_when: 'always', title: '', body: 'Facilitar acceso y acreditaciones al personal asignado.' },
    { kind: 'term', id: 'gl_01', chapter_id: 'glosario', lang, applies_when: 'always', title: 'SATE', body: 'Sistema Automático de Tratamiento de Equipaje.' },
  ],
  rules: [{ key: 'default_tier', value: tier }, { key: 'tone', value: 'técnico y sobrio' }],
};

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

const { context, sections_rendered } = buildRenderContext({
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

const templatePath = path.join(ROOT, `templates/proposal-template-${lang}.docx`);
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

const out = path.join(ROOT, `templates/sample-${lang}-tier${tier}.docx`);
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
console.log(`clauses applied: ${proposalConfig.clauses.length}${proposalConfig.warnings.length ? ` | warnings: ${proposalConfig.warnings.length}` : ''}`);
if (problems.length) {
  console.error(`\nFAIL:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\nOK — no "undefined", no stray braces.');
