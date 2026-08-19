#!/usr/bin/env node
// End-to-end check of the demo@ intake, run against the REAL Code-node source.
//
//   node scripts/check-intake-routing.js
//
// `node modules/intake/intake_core.js` checks the routing and guard logic in isolation. This
// checks the thing that actually ships: it pulls the `jsCode` straight out of the workflow JSON
// and executes it through a small n8n shim ($input / $('Node') / $getWorkflowStaticData / $now),
// in the same order the graph wires them:
//
//   Gmail item -> Build Envelope -> Intake Guard -> [Notion rows] -> Map Client Config
//               -> (Client OK?) -> ... -> Module 4 'Compute Proposal Fields'
//
// So a wrapper that stops passing the truncated body along, a rewiring that reads the envelope
// from the wrong node, or a gate that disagrees with the others about whether the demo answers by
// itself, fails here rather than in someone's inbox.
//
// The demo now DELIVERS its proposal (DEMO_SEND_MODE in modules/intake/intake_core.js). That
// makes the assertion sharper rather than weaker: every gate has to reach the SAME verdict as
// that one constant, the registry must still have no say over the demo tenant, and proposal@
// must still refuse a stranger outright.
//
// The registry it runs against deliberately holds TWO clients — the demo tenant and a paying one
// with its own template, clause sheet, rate card and Drive folders — because "M4 must not leak
// another client's data to a stranger" is only a real assertion when there is another client's
// data present to leak.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// The source of truth for what the public intake does with a finished document. Every gate is
// asserted against THIS, so flipping it in the core is all a rollback takes.
const { DEMO_SEND_MODE } = require(path.join(ROOT, 'modules/intake/intake_core.js'));
const OTHER_MODE = DEMO_SEND_MODE === 'send' ? 'draft' : 'send';
const ORCH = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/00-orchestrator-end-to-end.json'), 'utf8'));
const M4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/04-proposal-assembly.json'), 'utf8'));

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures += 1;
  }
};

function codeOf(workflow, nodeName) {
  const node = workflow.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`node '${nodeName}' not found`);
  return node.parameters.jsCode;
}

// --- the n8n shim ----------------------------------------------------------
// Enough of n8n's Code-node runtime to execute a node body honestly: items in, items out, other
// nodes reachable by name, workflow static data that persists across calls, and a Luxon-ish $now.
function makeNow(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (pattern) => {
    const y = d.getUTCFullYear();
    const m = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    if (pattern === 'yyyy-MM-dd') return `${y}-${m}-${day}`;
    if (pattern === 'yyyyMMdd') return `${y}${m}${day}`;
    if (pattern === 'dd/MM/yyyy') return `${day}/${m}/${y}`;
    throw new Error(`shim: unhandled $now format '${pattern}'`);
  };
  const self = { toFormat: fmt, toUTC: () => self };
  return self;
}

function runNode({ code, items, nodes, staticData, now, json }) {
  const list = (items || []).map((i) => (i && i.json !== undefined ? i : { json: i }));
  const $input = {
    first: () => list[0],
    last: () => list[list.length - 1],
    all: () => list,
  };
  const $ = (name) => {
    if (!(name in (nodes || {}))) throw new Error(`shim: node '${name}' was not made available to this step`);
    const got = [].concat(nodes[name]).map((i) => (i && i.json !== undefined ? i : { json: i }));
    return { first: () => got[0], last: () => got[got.length - 1], all: () => got, item: got[0] };
  };
  const fn = new Function(
    '$input', '$', '$getWorkflowStaticData', '$now', '$json', 'console',
    code,
  );
  return fn($input, $, () => staticData, now || makeNow('2026-08-11T09:00:00Z'), json, { log: () => {} });
}

// --- fixtures --------------------------------------------------------------
const gmailItem = ({ to = 'demo@cifral.io', from = 'Jamie Pringle <jamie@machine-building.example>', subject = 'RFQ — palletiser cell for line 3', text, extraHeaders = {}, sizeEstimate = 24000, parts = [] } = {}) => ({
  json: {
    threadId: '19a4c0f13b7e21aa',
    sizeEstimate,
    subject,
    text: text === undefined ? [
      'Hello,',
      '',
      'We are preparing a quotation for a palletiser cell on our packaging line 3 in Zaragoza.',
      'Scope: 1 robotic palletiser, 24 m of accumulation conveyor, safety fencing, and',
      'commissioning on site. We would need delivery before the end of Q1.',
      '',
      'Jamie Pringle — Machine Building Systems Ltd — jamie@machine-building.example',
    ].join('\n') : text,
    payload: {
      headers: [
        { name: 'Delivered-To', value: 'mark@cifral.io' },
        { name: 'To', value: to },
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        { name: 'Message-ID', value: '<CA+9xq3@mail.example>' },
        ...Object.entries(extraHeaders).map(([name, value]) => ({ name, value })),
      ],
      parts,
    },
  },
});

// Two registry rows. `paying_client` exists so the leak assertions have something to catch.
const DEMO_ROW = {
  property_client_id: 'demo_client',
  property_client_name: 'Cifral Demo',
  property_client_status: 'trial',
  // Deliberately the OPPOSITE of DEMO_SEND_MODE. The demo tenant's delivery mode is decided in
  // code, never read from Notion, so this value must never be the one that comes out — whichever
  // way round the switch is set.
  property_send_mode: OTHER_MODE,
  property_service_tier: 'full_pipeline',
  property_commercial_contact_email: 'mark@cifral.io',
  property_template_id_en: 'demo-template-en',
  property_template_id_es: 'demo-template-es',
  property_proposals_folder_id: 'demo-proposals-folder',
  property_reference_docs_folder_id: 'demo-reference-folder',
  property_pricing_sheet_id: 'demo-pricing-sheet',
  property_proposal_config_sheet_id: 'demo-config-sheet',
  property_notification_chat_id: '1748634056',
};
const PAYING_ROW = {
  property_client_id: 'paying_client',
  property_client_name: 'Acme Intralogistics',
  property_client_status: 'active',
  property_send_mode: 'send',
  property_service_tier: 'full_pipeline',
  property_commercial_contact_email: 'sales@acme-intralogistics.example',
  property_template_id_en: 'ACME-CONFIDENTIAL-template-en',
  property_template_id_es: 'ACME-CONFIDENTIAL-template-es',
  property_proposals_folder_id: 'ACME-CONFIDENTIAL-proposals',
  property_reference_docs_folder_id: 'ACME-CONFIDENTIAL-reference-docs',
  property_pricing_sheet_id: 'ACME-CONFIDENTIAL-rate-card',
  property_proposal_config_sheet_id: 'ACME-CONFIDENTIAL-clauses',
  property_notification_chat_id: '999999',
};
const REGISTRY = [{ json: DEMO_ROW }, { json: PAYING_ROW }];
const ACME_SECRETS = Object.values(PAYING_ROW).filter((v) => String(v).includes('CONFIDENTIAL'));

const CODE = {
  buildEnvelope: codeOf(ORCH, 'Build Envelope'),
  intakeGuard: codeOf(ORCH, 'Intake Guard'),
  mapClientConfig: codeOf(ORCH, 'Map Client Config'),
  buildQuoteDraft: codeOf(ORCH, 'Build Quote Draft'),
  computeProposalFields: codeOf(M4, 'Compute Proposal Fields'),
};

/** Drive one message through Build Envelope -> Intake Guard -> Map Client Config. */
function intake(item, { staticData = {}, now } = {}) {
  const env = runNode({ code: CODE.buildEnvelope, items: [item], staticData, now });
  const guard = runNode({ code: CODE.intakeGuard, items: env, nodes: { 'Build Envelope': env }, staticData, now });
  if (!guard.length) return { env: env[0].json, dropped: true };
  const mapped = runNode({
    code: CODE.mapClientConfig,
    items: REGISTRY,
    nodes: { 'Build Envelope': env, 'Intake Guard': guard },
    staticData,
    now,
  });
  return { env: env[0].json, guard: guard[0].json, mapped: mapped[0].json, dropped: false };
}

// --- 1. the headline case --------------------------------------------------
console.log('a stranger emails demo@cifral.io');
const stranger = intake(gmailItem());
check('is not dropped by the junk filter', stranger.dropped === false);
check('passes the intake guards', stranger.guard.accepted === true);
check('resolves to demo_client', stranger.mapped.resolved === true && stranger.mapped.client_id === 'demo_client');
check('is NOT rejected as an unknown sender', stranger.mapped.reason === undefined);
check('the reply is addressed to the stranger, not to a registry contact',
  stranger.mapped.client_config.reply_to === 'jamie@machine-building.example');
check('sends from the demo alias', stranger.mapped.client_config.from_alias === 'demo@cifral.io');
check(`send_mode is '${DEMO_SEND_MODE}' from the code, ignoring the registry row's '${OTHER_MODE}'`,
  stranger.mapped.client_config.send_mode === DEMO_SEND_MODE, `got '${stranger.mapped.client_config.send_mode}'`);
check('the demo tenant is flagged as such, so the document and the mail can say so',
  stranger.mapped.client_config.demo_tenant === true);
check('the envelope is marked as public intake', stranger.mapped.client_config.open_intake === true);
check('the RFQ body reaches Module 1 intact',
  stranger.mapped.data.text.includes('palletiser cell') && stranger.mapped.data.text.includes('Zaragoza'));
check('the original thread is kept so the reply lands in it',
  stranger.mapped.email_context.thread_id === '19a4c0f13b7e21aa' && /^Re: /.test(stranger.mapped.email_context.reply_subject));

// --- 2. guard 5: no other client's data reaches the stranger ---------------
console.log('\nguard 5 — what the stranger can and cannot be served');
const served = JSON.stringify(stranger.mapped);
check('no field of the paying client appears anywhere in the resolved envelope',
  ACME_SECRETS.every((s) => !served.includes(s)),
  ACME_SECRETS.filter((s) => served.includes(s)).join(', '));
check('the template is the demo tenant\'s own', stranger.mapped.client_config.templates.en === 'demo-template-en');
check('the clause library is the demo tenant\'s own', stranger.mapped.client_config.proposal_config_sheet_id === 'demo-config-sheet');
check('the rate card is the demo tenant\'s own', stranger.mapped.client_config.pricing_sheet_id === 'demo-pricing-sheet');
check('the reference-docs folder is the demo tenant\'s own', stranger.mapped.client_config.reference_docs_folder_id === 'demo-reference-folder');
check('the registry rows themselves do not travel downstream',
  !served.includes('paying_client') && !served.includes('sales@acme-intralogistics.example'));

// --- 3. proposal@ is unchanged --------------------------------------------
console.log('\nproposal@cifral.io keeps the strict sender match');
const strangerAtProposal = intake(gmailItem({ to: 'proposal@cifral.io' }));
check('a stranger is still rejected', strangerAtProposal.mapped.resolved === false && strangerAtProposal.mapped.reason === 'unknown_sender');
const clientAtProposal = intake(gmailItem({ to: 'proposal@cifral.io', from: 'Acme Sales <sales@acme-intralogistics.example>' }));
check('a registered client is still recognised', clientAtProposal.mapped.resolved === true && clientAtProposal.mapped.client_id === 'paying_client');
check('a registered client still gets their own template', clientAtProposal.mapped.client_config.templates.en === 'ACME-CONFIDENTIAL-template-en');
check('a registered client still sends for real', clientAtProposal.mapped.client_config.send_mode === 'send');
check('a registered client sends from the production alias', clientAtProposal.mapped.client_config.from_alias === 'proposal@cifral.io');
check('a registered client is not flagged as public intake', clientAtProposal.mapped.client_config.open_intake === false);

console.log('\ndestination beats sender in both directions');
const clientAtDemo = intake(gmailItem({ to: 'demo@cifral.io', from: 'Acme Sales <sales@acme-intralogistics.example>' }));
check('a registered client writing to demo@ gets the DEMO tenant, not their own',
  clientAtDemo.mapped.client_id === 'demo_client' && clientAtDemo.mapped.client_config.send_mode === DEMO_SEND_MODE);
const bothAddressed = intake(gmailItem({ to: 'proposal@cifral.io', extraHeaders: { Cc: 'demo@cifral.io' } }));
check('demo@ wins when both are addressed, so ambiguity always lands on the demo tenant',
  bothAddressed.mapped.client_id === 'demo_client' && bothAddressed.mapped.client_config.send_mode === DEMO_SEND_MODE);

// --- 4. the guards, through the real nodes --------------------------------
console.log('\nthe guards, as wired');
check('an out-of-office is dropped before the registry is even read',
  intake(gmailItem({ subject: 'Automatic reply: RFQ — palletiser cell for line 3' })).dropped === true);
check('a bounce is dropped', intake(gmailItem({ extraHeaders: { 'Return-Path': '<>' } })).dropped === true);
check('a newsletter is dropped', intake(gmailItem({ extraHeaders: { 'List-Unsubscribe': '<https://x.example/u>' } })).dropped === true);
check('an empty body is dropped', intake(gmailItem({ text: 'thanks!' })).dropped === true);

{
  const oversize = intake(gmailItem({ sizeEstimate: 12 * 1024 * 1024 }));
  check('a 12 MB email is refused and alerted, not silently dropped',
    oversize.dropped === false && oversize.guard.accepted === false && oversize.guard.reason === 'oversize');
}
{
  const staticData = {};
  const res = [1, 2, 3, 4].map(() => intake(gmailItem(), { staticData }));
  check('the first three RFQs from one stranger are processed', res.slice(0, 3).every((r) => r.mapped && r.mapped.resolved === true));
  check('the fourth is refused', res[3].guard.accepted === false && res[3].guard.reason === 'rate_limited_sender');
  check('the refusal carries what the Telegram alert needs',
    res[3].guard.sender_email === 'jamie@machine-building.example' && res[3].guard.intake_address === 'demo@cifral.io' && !!res[3].guard.detail);
}
{
  const parts = Array.from({ length: 14 }, (_, i) => ({ filename: `drawing-${i}.pdf`, body: { size: 1000 } }));
  const many = intake(gmailItem({ parts }));
  check('14 attachments are refused', many.guard.accepted === false && many.guard.reason === 'too_many_attachments');
  const few = intake(gmailItem({ parts: parts.slice(0, 3) }));
  check('3 attachments are fine', few.guard.accepted === true);
}
{
  const long = intake(gmailItem({ text: `${'We need 24 m of accumulation conveyor and a palletiser. '.repeat(600)}` }));
  check('an over-long body is truncated rather than refused',
    long.guard.accepted === true && long.guard.truncated === true && long.mapped.data.text.includes('[intake guard: truncated'));
  check('the truncated body is what reaches Module 1', long.mapped.data.text.length < 21000, `${long.mapped.data.text.length} chars`);
}

// --- 5. the chat trigger still works --------------------------------------
console.log('\nthe chat trigger (no sender, no destination) is unchanged');
{
  const chat = intake({ json: { chatInput: 'RFQ: we need 40 m of belt conveyor, two diverters and commissioning at our Bilbao plant before March. Contact: Ana Ruiz, ana@example.com, Talleres Ruiz S.L.' } });
  check('falls back to demo_client for local testing', chat.mapped.resolved === true && chat.mapped.client_id === 'demo_client');
  check('has no thread to reply into and says so', chat.mapped.email_context.thread_id === null);
}

// --- 6. the send gates, evaluated ------------------------------------------
console.log(`\nthe gates that decide delivery — all of them must say '${DEMO_SEND_MODE}'`);
const PROPOSAL_INPUT = {
  client_id: stranger.mapped.client_id,
  client_config: stranger.mapped.client_config,
  email_context: stranger.mapped.email_context,
  proposal_config: { language: 'en', tier: 'B', all_keys: [], chapters: [], clauses: [], table_columns: {} },
  data: {
    rfq: {
      language: 'en',
      client: { company: 'Machine Building Systems Ltd', contact_name: 'Jamie', email: 'jamie@machine-building.example' },
      project: { type: 'palletiser cell' },
      technical_requirements: [{ item: 'robotic palletiser', quantity: 1 }],
      scope_of_supply: { materials: true, installation: true },
    },
    content: { sections: {}, tables: {} },
    pricing: null,
  },
};
const proposalFields = runNode({ code: CODE.computeProposalFields, json: PROPOSAL_INPUT, items: [] })[0].json;

check('Module 4 computes a proposal for the stranger', /^PROP-\d{8}-[A-Z0-9]{6}$/.test(proposalFields.proposal_number));
check('it renders from the demo template', proposalFields.template_id === 'demo-template-en');
check('it files into the demo tenant\'s Drive folder', proposalFields.proposals_folder_id === 'demo-proposals-folder');
check('the reply is addressed to the stranger', proposalFields.recipient_email === 'jamie@machine-building.example');
check(`Module 4 resolves send_mode = ${DEMO_SEND_MODE}`, proposalFields.send_mode === DEMO_SEND_MODE, `got '${proposalFields.send_mode}'`);
check('no field of the paying client reached the render',
  ACME_SECRETS.every((s) => !JSON.stringify(proposalFields).includes(s)));

// The IF nodes that stand between the draft and Gmail's drafts.send. Both must be a plain
// equality against 'send', or the assertions above stop meaning anything: a looser operator
// would let an unexpected value fall on the sending side instead of the parked one.
for (const [wf, nodeName, source] of [['00-orchestrator', 'Send Quote?', ORCH], ['04-proposal-assembly', 'Send Mode?', M4]]) {
  const cond = source.nodes.find((n) => n.name === nodeName).parameters.conditions.conditions[0];
  check(`${wf} :: '${nodeName}' fires only on send_mode === 'send'`,
    cond.rightValue === 'send' && cond.operator.operation === 'equals' && /send_mode/.test(cond.leftValue));
}

// The pricing_only branch has its own draft/send gate; it must reach the same verdict.
const quote = runNode({
  code: CODE.buildQuoteDraft,
  json: { client_id: 'demo_client', client_config: stranger.mapped.client_config, data: { subtotal: 1000, total: 1400, payment_terms: '30/40/30', priced_categories: ['materials'], currency: 'EUR' } },
  items: [],
  nodes: {
    'Map Client Config': [stranger.mapped],
    'Build Envelope': [stranger.env],
    'Call Module 1': [{ data: { client: { company: 'Machine Building Systems Ltd' } } }],
  },
})[0].json;
check(`the pricing_only branch also resolves send_mode = ${DEMO_SEND_MODE}`, quote.send_mode === DEMO_SEND_MODE, `got '${quote.send_mode}'`);
check('the quote is addressed to the stranger', quote.recipient === 'jamie@machine-building.example');

// What the stranger actually reads. The covering mail is the only part of this a prospect sees
// before they open the attachment, so it has to name itself a demonstration there — and it has to
// be in the language they wrote in, which the old hard-coded Gmail body never was.
check('the covering email says it is a demonstration', /demonstration/i.test(proposalFields.email_html));
check('it does not claim to be a commercial offer', /not a commercial offer/i.test(proposalFields.email_html));
check('it says the template is adapted per client', /your own template/i.test(proposalFields.email_html));
check('the run is flagged as the demo tenant', proposalFields.demo_tenant === true);
{
  const spanish = JSON.parse(JSON.stringify(PROPOSAL_INPUT));
  spanish.data.rfq.language = 'es';
  spanish.proposal_config.language = 'es';
  const es = runNode({ code: CODE.computeProposalFields, json: spanish, items: [] })[0].json;
  check('a Spanish RFQ is answered in Spanish', /Esto es una demostración/.test(es.email_html) && !/Hello,/.test(es.email_html));
}
check('the demo quote email quotes no internal subtotal', !/Subtotal/i.test(quote.html) && /demostración|demonstration/i.test(quote.html));

// Every downstream gate must FAIL CLOSED. The demo switch decides delivery once, in
// 'Map Client Config'; if that value is ever lost or garbled on the way here, the cost has to be
// an undelivered message, never an unintended one. Feed each gate a broken config and check.
// `{name:'send'}` is the Notion property shape that has already defeated a string comparison in
// this system once — the failure it caused was silent, and here it must simply not deliver.
for (const [name, bad] of [['missing', undefined], ['empty', ''], ['object-shaped', { name: 'send' }], ['nonsense', 'yes']]) {
  const cfg = Object.assign({}, stranger.mapped.client_config, { send_mode: bad });
  const m4 = runNode({
    code: CODE.computeProposalFields,
    json: Object.assign({}, PROPOSAL_INPUT, { client_config: cfg }),
    items: [],
  })[0].json;
  const q = runNode({
    code: CODE.buildQuoteDraft,
    json: { client_id: 'demo_client', client_config: cfg, data: { subtotal: 1000, total: 1400, payment_terms: '30/40/30', priced_categories: ['materials'], currency: 'EUR' } },
    items: [],
    nodes: { 'Map Client Config': [stranger.mapped], 'Build Envelope': [stranger.env], 'Call Module 1': [{ data: { client: { company: 'Machine Building Systems Ltd' } } }] },
  })[0].json;
  check(`send_mode ${name} parks the proposal and the quote rather than sending them`,
    m4.send_mode === 'draft' && q.send_mode === 'draft', `${m4.send_mode} / ${q.send_mode}`);
}

// Whitespace and case ARE normalised, deliberately — a human typing 'Send' into the registry
// means send, and treating that as a failure would be a different kind of surprise.
{
  const tidy = Object.assign({}, stranger.mapped.client_config, { send_mode: '  Send ' });
  const m4 = runNode({ code: CODE.computeProposalFields, json: Object.assign({}, PROPOSAL_INPUT, { client_config: tidy }), items: [] })[0].json;
  check("'  Send ' is normalised rather than rejected", m4.send_mode === 'send');
}

// A registered client's own kill switch is untouched by any of this.
{
  const held = Object.assign({}, clientAtProposal.mapped.client_config, { send_mode: 'draft' });
  const m4 = runNode({ code: CODE.computeProposalFields, json: Object.assign({}, PROPOSAL_INPUT, { client_id: 'paying_client', client_config: held }), items: [] })[0].json;
  check("a registered client on send_mode = draft is still held", m4.send_mode === 'draft');
}

// A 'Build Envelope' older than this change carries no answer on the envelope. That is a partial
// re-import, and it has to resolve the quiet way round: a demo that has gone silent says so in
// Telegram, a demo that sends when it should not says so in a stranger's inbox.
{
  // 'Map Client Config' prefers the guard's copy of the intake and falls back to the envelope's,
  // so an honest 'older Build Envelope' has to be missing from both.
  const staleEnv = JSON.parse(JSON.stringify(stranger.env));
  const staleGuard = JSON.parse(JSON.stringify(stranger.guard));
  delete staleEnv.intake.demo_send_mode;
  if (staleGuard.intake) delete staleGuard.intake.demo_send_mode;
  const mapped = runNode({
    code: CODE.mapClientConfig,
    items: REGISTRY,
    nodes: { 'Build Envelope': [staleEnv], 'Intake Guard': [staleGuard] },
  })[0].json;
  check('an envelope with no demo switch on it parks the reply rather than sending it',
    mapped.client_config.send_mode === 'draft', `got '${mapped.client_config.send_mode}'`);
}

// Module 4's standalone fallback has its own copy of the constant — it runs with no
// 'Build Envelope' to carry the value across. A copy that drifts is a demo that behaves one way
// through the orchestrator and the other way when Module 4 is invoked on its own.
{
  const src = codeOf(M4, 'Map Client Config');
  const m = src.match(/const DEMO_SEND_MODE = '(send|draft)';/);
  check("Module 4's standalone Map Client Config declares the demo switch", !!m, 'constant not found');
  check("Module 4's copy of the demo switch matches the core",
    !!m && m[1] === DEMO_SEND_MODE, m ? `node says '${m[1]}', core says '${DEMO_SEND_MODE}'` : '');
}

// --- 7. graph wiring: the guards cannot be bypassed ------------------------
console.log('\nthe guards sit where they have to sit');
{
  const conn = ORCH.connections;
  const targets = (name, index = 0) => ((conn[name] && conn[name].main && conn[name].main[index]) || []).map((l) => l.node);
  check("'Build Envelope' feeds only 'Intake Guard'", JSON.stringify(targets('Build Envelope')) === JSON.stringify(['Intake Guard']));
  check("'Intake Guard' feeds only 'Intake OK?'", JSON.stringify(targets('Intake Guard')) === JSON.stringify(['Intake OK?']));
  check("'Intake OK?' true -> 'Load Client Registry'", targets('Intake OK?', 0).includes('Load Client Registry'));
  check("'Intake OK?' false -> 'Client Rejected'", targets('Intake OK?', 1).includes('Client Rejected'));
  // Walk the graph from every trigger without ever stepping ONTO 'Intake Guard'. Anything still
  // reachable is a path that skips the guards — which is the whole failure mode this change has
  // to rule out, since a bypass would put an unmetered stranger straight into Module 1.
  const triggers = ORCH.nodes.filter((n) => /trigger/i.test(n.type)).map((n) => n.name);
  const seen = new Set();
  const walk = (name) => {
    if (name === 'Intake Guard' || seen.has(name)) return;
    seen.add(name);
    for (const link of ((conn[name] && conn[name].main) || []).flat()) walk(link.node);
  };
  triggers.forEach(walk);
  const bypassed = ['Load Client Registry', 'Call Module 1', 'Call Module 2', 'Call Module 3', 'Call Module 4'].filter((n) => seen.has(n));
  check('no path from any trigger reaches the registry read or a module without passing the guard',
    bypassed.length === 0, bypassed.join(', '));
  check('the walk found the triggers it needed to', triggers.length === 2 && seen.has('Build Envelope'));

  // The Gmail trigger's search query decides what enters the pipeline AT ALL. Its subject filter
  // is right for registered clients, who write "RFQ" in the subject because they were told to —
  // but a prospect answering the demo CTA writes whatever they like, and a message the trigger
  // never picks up leaves no trace anywhere. So everything addressed to demo@ must match the
  // query regardless of subject, and the guards do the filtering instead.
  const q = ORCH.nodes.find((n) => n.name === 'Gmail Trigger').parameters.filters.q || '';
  check('the Gmail trigger picks up demo@ mail whatever its subject says',
    /deliveredto:demo@cifral\.io/.test(q) && /\bto:demo@cifral\.io/.test(q), q);
  check('the trigger still picks up RFQ-subject mail on the other addresses', /subject:\(/.test(q), q);
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`\nOK — demo@ serves any sender as demo_client with send_mode='${DEMO_SEND_MODE}' decided in code, every gate agrees, a lost value still fails closed, and proposal@ is unchanged.`);
