#!/usr/bin/env node
// Generate a client's own setup guide and RFQ email template FROM their Proposal Config sheet.
//
//   node scripts/client-docs.js <client_id> [--out <dir>]
//
// Two documents come out, both meant to live in that client's Google Drive folder next to the
// sheet they were generated from:
//
//   <client_id>-setup-guide.md   what this client is actually configured to do — their chapters,
//                                their variables, their templates, their writing rules
//   <client_id>-rfq-template.md  the email to send to proposal@cifral.io, with the EXACT labels
//                                their `Fields` tab declares
//
// The second one is why this is a script and not a document somebody writes. Client fields are
// captured by matching a label, so the label in the sheet and the label in the email have to be
// the same string. Written by hand, those two drift the first time a field is added — and the
// failure is silent: the cover page just comes out blank. Generated, they cannot drift.
//
// Reads seed/<client_id>/proposal-config/*.csv, which is the same place `npm run check` reads a
// client's configuration from before any of it reaches Drive.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { resolveProposalConfig } = require(path.join(ROOT, 'modules/proposal/chapter_catalog'));
const catalog = require(path.join(ROOT, 'schemas/chapter-catalog.json'));

const args = process.argv.slice(2);
const clientId = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
if (!clientId) {
  console.error('usage: node scripts/client-docs.js <client_id> [--out <dir>]');
  process.exit(1);
}

// Same CSV reader as scripts/render-sample.js — quoted fields, embedded commas and newlines.
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
if (!fs.existsSync(SEED)) {
  console.error(`No configuration found at seed/${clientId}/proposal-config/.`);
  console.error('Export the client\'s Proposal Config sheet there as chapters.csv, content.csv, rules.csv, client.csv, templates.csv and fields.csv.');
  process.exit(1);
}
const tab = (name) => (fs.existsSync(path.join(SEED, name)) ? readCsv(path.join(SEED, name)) : []);
const sheet = {
  chapters: tab('chapters.csv'), content: tab('content.csv'), rules: tab('rules.csv'),
  client: tab('client.csv'), templates: tab('templates.csv'), fields: tab('fields.csv'),
};

const lang = (sheet.client.find((r) => r.key === 'default_language') || {}).value === 'en' ? 'en' : 'es';
// Every scope item on, so the guide shows the client's FULL configured surface rather than the
// subset one particular request would happen to render.
const scope = Object.fromEntries(Object.keys(require(path.join(ROOT, 'schemas/scope-catalog.json')).scope_items || {}).map((k) => [k, true]));
const cfg = resolveProposalConfig({ catalog, sheet, language: lang, scope, has_pricing: true, sheet_id: '(this sheet)' });

const AUTO_LABEL = {
  proposal_number: 'el número de propuesta que genera Cifral',
  date: 'la fecha de emisión', version: 'la versión del documento', tier: 'el peso del documento (A/B/C)',
  language: 'el idioma', client_company: 'la empresa del cliente final', client_contact: 'la persona de contacto',
  client_email: 'el email de contacto', client_phone: 'el teléfono de contacto',
  project_title: 'el título del proyecto', project_type: 'el tipo de proyecto',
  project_location: 'el emplazamiento', project_deadline: 'el plazo solicitado',
};

const requestFields = cfg.fields.filter((f) => f.source === 'request');
const staticFields = cfg.fields.filter((f) => f.source === 'static');
const autoFields = cfg.fields.filter((f) => f.source === 'auto');

// ---------------------------------------------------------------- the setup guide
const guide = [];
guide.push(`# ${clientId} — configuración de propuestas`);
guide.push('');
guide.push('> Generado desde la hoja **Proposal Config** de este cliente con `node scripts/client-docs.js ' + clientId + '`.');
guide.push('> No lo edites a mano: edita la hoja y vuelve a generarlo, o dejará de reflejar la realidad.');
guide.push('');
guide.push('## Qué produce este cliente');
guide.push('');
guide.push(`- **Idioma por defecto:** ${lang}`);
guide.push(`- **Peso del documento por defecto:** ${cfg.tier} — ${{ A: 'presupuesto (4-8 pág.)', B: 'propuesta estándar (15-25 pág.)', C: 'respuesta a licitación (30-60 pág. + anexos)' }[cfg.tier]}`);
guide.push(`- **Versión del documento:** ${cfg.version}${cfg.author ? ` · **autor:** ${cfg.author}` : ''}`);
guide.push(`- **Capítulos configurados:** ${cfg.chapters.length}`);
guide.push(`- **Cláusulas propias:** ${cfg.clauses.length}`);
guide.push('');

guide.push('## Variables propias de este cliente');
guide.push('');
if (!cfg.fields.length) {
  guide.push('Ninguna declarada. La portada solo puede usar las variables comunes (`{numero_propuesta}`, `{fecha}`, `{cliente.empresa}`, `{proyecto.titulo}`, …).');
} else {
  guide.push('Estas son las etiquetas que **puedes usar en la plantilla `.docx`**. Cualquier otra `{campos.*}` imprimirá la palabra `undefined` en el documento del cliente.');
  guide.push('');
  guide.push('| Etiqueta en la plantilla | De dónde sale | Obligatorio |');
  guide.push('|---|---|---|');
  for (const f of cfg.fields) {
    const origin = f.source === 'static' ? `valor fijo en la hoja: \`${f.value || '(vacío)'}\``
      : f.source === 'request' ? `del correo, buscando \`${f.labels.join('` o `')}\``
      : `automático: ${AUTO_LABEL[f.value] || f.value}`;
    guide.push(`| \`{campos.${f.key}}\` | ${origin} | ${f.required ? 'sí' : 'no'} |`);
  }
  if (requestFields.some((f) => f.required)) {
    guide.push('');
    guide.push('> Un campo obligatorio que no venga en el correo **detiene la propuesta** y la marca para revisión, en lugar de emitir una portada con un hueco.');
  }
}
guide.push('');

guide.push('## Plantillas');
guide.push('');
if (!cfg.templates.length) {
  guide.push('La pestaña `Templates` está vacía, así que se usan los ids `template_id_es` / `template_id_en` de la ficha de Notion.');
} else {
  guide.push('| Variante | Idioma | Se elige cuando | Fichero |');
  guide.push('|---|---|---|---|');
  for (const t of cfg.templates) {
    const when = t.match.length ? `el texto de la petición contiene ${t.match.map((m) => `\`${m}\``).join(' o ')}`
      : t.is_default ? 'es la opción por defecto de su idioma' : 'se pide expresamente esta variante';
    guide.push(`| \`${t.variant}\` | ${t.lang} | ${when} | \`${t.file_id}\` |`);
  }
}
guide.push('');

guide.push('## Capítulos');
guide.push('');
guide.push('Los que salen hoy, en orden, con todo el alcance activado:');
guide.push('');
for (const ch of cfg.chapters) {
  guide.push(`${ch.numero ? `**${ch.numero}.** ` : '— '}${ch.title}`);
  for (const s of ch.sections) guide.push(`  - ${s.numero || '—'} ${s.title}`);
}
guide.push('');

guide.push('## Estilo de redacción');
guide.push('');
guide.push('Estas líneas se inyectan literalmente en las instrucciones de los agentes que escriben:');
guide.push('');
for (const [k, v] of Object.entries(cfg.rules)) {
  if (k === 'terminology') continue;
  guide.push(`- \`${k}\`: ${Array.isArray(v) ? v.join(', ') : v}`);
}
for (const [k, v] of Object.entries(cfg.rules.terminology || {})) guide.push(`- di **${v}**, nunca "${k}"`);
guide.push('');

if (cfg.warnings.length) {
  guide.push('## ⚠ Avisos de configuración');
  guide.push('');
  guide.push('Cada uno de estos significa que una fila de la hoja se está ignorando:');
  guide.push('');
  for (const w of cfg.warnings) guide.push(`- ${w}`);
  guide.push('');
}

// ------------------------------------------------------------- the RFQ email template
const rfq = [];
rfq.push(`# ${clientId} — plantilla de correo para pedir una propuesta`);
rfq.push('');
rfq.push('> Generado desde la hoja **Proposal Config** de este cliente. Las etiquetas de abajo son');
rfq.push('> exactamente las que el sistema busca: si cambian en la hoja, vuelve a generar este documento.');
rfq.push('');
rfq.push('**Para:** `proposal@cifral.io`');
rfq.push('**Desde:** la dirección registrada en `commercial_contact_email` — el sistema identifica al cliente por ahí.');
rfq.push('**Asunto:** RFQ — <título del proyecto>');
rfq.push('');
rfq.push('---');
rfq.push('');
rfq.push('```');
if (requestFields.length) {
  for (const f of requestFields) {
    // A label that already ends in punctuation ('Att.') reads wrong with a colon bolted on.
    const sep = /[.:=-]$/.test(f.labels[0]) ? ' ' : ': ';
    rfq.push(`${f.labels[0]}${sep}${f.required ? '<obligatorio>' : '<opcional>'}`);
  }
  rfq.push('');
}
rfq.push('Cliente final: <razón social>');
rfq.push('Proyecto: <título del proyecto>');
rfq.push('Emplazamiento: <planta / ciudad>');
rfq.push('Plazo: <fecha o trimestre>');
rfq.push('');
rfq.push('Alcance solicitado: <suministro, ingeniería, instalación, puesta en marcha, repuestos…>');
rfq.push('');
rfq.push('Requisitos:');
rfq.push('  - <equipo o requisito> — <cantidad> — <especificación>');
rfq.push('  - …');
rfq.push('');
rfq.push('<Descripción de la situación actual y de lo que se pide.>');
rfq.push('```');
rfq.push('');
rfq.push('## Reglas de las etiquetas');
rfq.push('');
if (requestFields.length) {
  rfq.push('- Cada etiqueta va **al principio de su línea**, seguida del valor. Varias en la misma línea también funcionan.');
  rfq.push('- Mayúsculas, acentos y `º`/`°` dan igual.');
  rfq.push('- El valor termina donde empieza la siguiente etiqueta, o al final de la línea.');
  rfq.push('- Una etiqueta sin nada detrás cuenta como no puesta.');
  rfq.push('- Se lee **tal cual**, sin modelo de lenguaje de por medio: lo que escribas es lo que sale en la portada.');
  rfq.push('');
  rfq.push('| Etiqueta | Alternativas admitidas | Obligatorio |');
  rfq.push('|---|---|---|');
  for (const f of requestFields) {
    rfq.push(`| \`${f.labels[0]}\` | ${f.labels.slice(1).map((l) => `\`${l}\``).join(', ') || '—'} | ${f.required ? '**sí**' : 'no'} |`);
  }
} else {
  rfq.push('Este cliente no declara ninguna variable propia que haya que escribir en el correo.');
}
if (staticFields.length || autoFields.length) {
  rfq.push('');
  rfq.push('No hace falta escribir estas, salen solas:');
  rfq.push('');
  for (const f of staticFields) rfq.push(`- **${f.key}** — fijo en la configuración: ${f.value || '(sin valor todavía)'}`);
  for (const f of autoFields) rfq.push(`- **${f.key}** — ${AUTO_LABEL[f.value] || f.value}`);
}
rfq.push('');

const outDir = outIdx !== -1 ? args[outIdx + 1] : path.join(ROOT, 'seed', clientId);
fs.mkdirSync(outDir, { recursive: true });
const guidePath = path.join(outDir, `${clientId}-setup-guide.md`);
const rfqPath = path.join(outDir, `${clientId}-rfq-template.md`);
fs.writeFileSync(guidePath, `${guide.join('\n')}\n`);
fs.writeFileSync(rfqPath, `${rfq.join('\n')}\n`);

console.log(`wrote ${path.relative(ROOT, guidePath)}`);
console.log(`wrote ${path.relative(ROOT, rfqPath)}`);
console.log(`${cfg.chapters.length} chapters · ${cfg.fields.length} client fields (${requestFields.length} from the email) · ${cfg.templates.length} template variant(s) · ${cfg.warnings.length} warning(s)`);
if (cfg.warnings.length) for (const w of cfg.warnings) console.error(`  warning: ${w}`);
