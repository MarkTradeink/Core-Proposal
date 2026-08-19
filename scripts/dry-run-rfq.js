#!/usr/bin/env node
// Run an RFQ through the DETERMINISTIC half of the intake, offline, before spending a live one.
//
//   node scripts/dry-run-rfq.js seed/demo_client/test-rfqs/01-full-pipeline-es.txt
//   node scripts/dry-run-rfq.js <file> --from someone@example.com --to proposal@cifral.io
//   node scripts/dry-run-rfq.js <file> --client beumer_marcos
//
// The public intake allows three RFQs per sender per day, so finding out by email that a label
// did not match costs a third of the day's budget and about four minutes of waiting. Everything
// this checks is decided by code rather than by a model, which is exactly the part that fails
// silently: a message the junk filter eats, a body under the emptiness floor, an `Oferta nº`
// the capture never sees because the sender wrote it in a way the sheet does not declare.
//
// What it CANNOT tell you is printed at the end rather than guessed at: the extraction is an LLM
// call inside n8n, so request_type, scope_of_supply, the tier and the required-field check are
// only knowable from a real run.
//
// File format — `Subject:` on the first line, optional `Header: Name: value` lines, a blank line,
// then the body exactly as it would be pasted into an email.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const {
  DEMO_INTAKE_ADDRESS, DEMO_SEND_MODE, INTAKE_LIMITS,
  normaliseHeaders, extractSender, resolveIntake, classifyIntake, meaningfulBody,
} = require(path.join(ROOT, 'modules/intake/intake_core.js'));
const { parseFieldDefinitions, captureFields, missingRequiredFields } = require(path.join(ROOT, 'modules/proposal/field_capture.js'));

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
if (!file) {
  console.error('usage: node scripts/dry-run-rfq.js <rfq.txt> [--from <email>] [--to <address>] [--client <client_id>]');
  console.error('       RFQs to try:  seed/demo_client/test-rfqs/');
  process.exit(1);
}

const from = opt('from', 'jamie@machine-building-systems.example');
const to = opt('to', DEMO_INTAKE_ADDRESS);
const clientId = opt('client', 'demo_client');

// --- parse the file ---------------------------------------------------------
const raw = fs.readFileSync(path.resolve(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');
let subject = '';
const extraHeaders = {};
let i = 0;
for (; i < lines.length; i += 1) {
  const line = lines[i];
  if (line.trim() === '') { i += 1; break; }
  const subjectMatch = line.match(/^Subject:\s*(.*)$/i);
  if (subjectMatch) { subject = subjectMatch[1].trim(); continue; }
  // `Header: Auto-Submitted: auto-replied` — how a fixture reproduces the envelope of an
  // autoresponder without needing a real one.
  const headerMatch = line.match(/^Header:\s*([^:]+):\s*(.*)$/i);
  if (headerMatch) { extraHeaders[headerMatch[1].trim()] = headerMatch[2].trim(); continue; }
  break;
}
const body = lines.slice(i).join('\n').trim();
if (!subject) subject = 'RFQ';

// --- same shape the Gmail trigger hands to 'Build Envelope' -----------------
const headers = normaliseHeaders(Object.entries(Object.assign(
  { 'Delivered-To': to, To: to, From: from, Subject: subject },
  extraHeaders,
)).map(([name, value]) => ({ name, value })));

const intake = resolveIntake(headers);
const senderEmail = extractSender(headers.from);
const counters = { day: '1970-01-01', by_sender: {}, open_total: 0 };
const verdict = classifyIntake({
  intake,
  senderEmail,
  subject,
  text: body,
  headers,
  sizeBytes: Buffer.byteLength(raw, 'utf8'),
  attachmentCount: 0,
  counters,
});

const H = (s) => `\n${s}\n${'-'.repeat(s.length)}`;
const yes = (b) => (b ? 'yes' : 'no');

console.log(`${path.relative(ROOT, path.resolve(ROOT, file))} — ${Buffer.byteLength(raw, 'utf8')} bytes`);
console.log(`  subject: ${subject}`);
console.log(`  from:    ${senderEmail || '(unparseable)'}`);
console.log(`  to:      ${to}`);

console.log(H('routing'));
console.log(`  route:        ${intake.route}${intake.open ? ' (public)' : ''}`);
console.log(`  client:       ${intake.client_id || `resolved from the sender's address in the registry`}`);
console.log(`  delivery:     ${intake.open ? `${DEMO_SEND_MODE} — the demo switch` : 'the client\'s own send_mode'}`);

console.log(H('guards'));
if (verdict.drop) {
  console.log(`  DROPPED SILENTLY — ${verdict.reason}`);
  console.log('  Nothing is generated and nothing is alerted; only the n8n execution log records it.');
} else if (!verdict.accepted) {
  console.log(`  REFUSED — ${verdict.reason}${verdict.detail ? ` (${verdict.detail})` : ''}`);
  console.log('  A Telegram alert fires. No proposal is produced.');
} else {
  console.log('  ACCEPTED — this message reaches Module 1.');
  console.log(`  meaningful body: ${verdict.body_chars} chars (floor ${INTAKE_LIMITS.min_body_chars}, cap ${INTAKE_LIMITS.max_body_chars})`);
  if (verdict.truncated) console.log('  ⚠️  body TRUNCATED at the cap — the tail never reaches the extractor');
  if (intake.open) console.log(`  quota: ${INTAKE_LIMITS.max_rfq_per_sender_per_day}/sender/day, ${INTAKE_LIMITS.max_open_rfq_per_day}/day overall`);
}

// A message the guards stopped never reaches the extractor or the cover, so reporting on either
// would be describing a document that is not going to exist.
if (!verdict.accepted) {
  console.log('');
  process.exit(0);
}

// --- the client's own cover variables --------------------------------------
// The one part of the cover that no model touches, and therefore the one part whose failure is a
// blank box rather than an error.
const fieldsFile = path.join(ROOT, 'seed', clientId, 'proposal-config', 'fields.csv');
console.log(H(`cover variables — ${clientId}`));
if (!fs.existsSync(fieldsFile)) {
  console.log(`  no seed/${clientId}/proposal-config/fields.csv — nothing declared, {campos.*} would be empty`);
} else {
  const readCsv = (f) => {
    const text = fs.readFileSync(f, 'utf8');
    const rows = []; let row = [], field = '', quoted = false;
    for (let j = 0; j < text.length; j += 1) {
      const c = text[j];
      if (quoted) { if (c === '"') { if (text[j + 1] === '"') { field += '"'; j += 1; } else quoted = false; } else field += c; }
      else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift();
    return rows.filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] === undefined ? '' : r[k]])));
  };
  const warnings = [];
  const defs = parseFieldDefinitions(readCsv(fieldsFile), warnings);
  // Module 1 captures against subject + body together, because a header block is as likely to be
  // in the subject line as in the first paragraph.
  const captured = captureFields([subject, body].join('\n'), defs).values;
  for (const def of defs) {
    const label = def.labels[0] || '—';
    if (def.source === 'request') {
      const got = captured[def.key];
      const mark = got ? '  ' : (def.required ? '!!' : '··');
      console.log(`  ${mark} {campos.${def.key}}  looked for '${label}'  ->  ${got || '(not in this RFQ)'}`);
    } else {
      console.log(`     {campos.${def.key}}  ${def.source}  ->  ${def.value || '(empty)'}`);
    }
  }
  const missing = missingRequiredFields(defs, captured);
  if (missing.length) console.log(`  ⚠️  required and not supplied: ${missing.join(', ')} — the RFQ is flagged incomplete`);
  for (const w of warnings) console.log(`  ⚠️  ${w}`);
}

console.log(H('what this cannot tell you'));
console.log('  The extraction is a model call inside n8n, so only a real run decides:');
console.log('    request_type      pricing_only | proposal_only | full_pipeline');
console.log('    scope_of_supply   which of the nine scope items apply, and so which chapters survive');
console.log('    tier              A quotation, B proposal, C tender');
console.log('    missing_fields    company, contact, email, project type, at least one requirement');
console.log('  Send it to see those. Chapter selection for a GIVEN tier and scope is checkable:');
console.log(`    node scripts/render-sample.js es B ${clientId}`);
console.log('');
