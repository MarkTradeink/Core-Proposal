// Cifral intake core — who a message is for, and whether it is worth spending money on.
//
// This is the SAME logic embedded in `workflows/00-orchestrator-end-to-end.json`, in the
// "Build Envelope" and "Intake Guard" Code nodes. It is plain JavaScript because the
// self-hosted n8n runs JS natively (no Python / Pyodide), and it is mirrored into those nodes
// by `scripts/mirror-cores.js` — the region between the INTAKE CORE markers is what they run.
//
// Two jobs, in order:
//
//   1. ROUTING (`resolveIntake`) — decide the client from the address the mail was DELIVERED TO,
//      not from who sent it. `demo@cifral.io` is a public intake open to any sender and always
//      resolves to `demo_client`; `proposal@cifral.io` keeps the strict sender match against the
//      registry's `commercial_contact_email`, so an unknown sender is still rejected there.
//
//   2. GUARDING (`classifyIntake`) — everything that reaches Module 1 through the public address
//      costs LLM + Drive work on a stranger's say-so, so the junk filter, the size caps and the
//      rate limits run BEFORE the registry read and before Module 1. Anywhere later is too late
//      to save the spend.
//
// Quick check:  node modules/intake/intake_core.js

// === INTAKE CORE START ===

// The two public-facing addresses. Both must be VERIFIED "Send mail as" aliases on the Gmail
// account that owns the n8n credential (docs/DEPLOYMENT.md) — they are also what the pipeline
// replies FROM, chosen by Client Status.
const DEMO_INTAKE_ADDRESS = 'demo@cifral.io';
const PROPOSAL_INTAKE_ADDRESS = 'proposal@cifral.io';

// The tenant every public RFQ is served by. Its Drive folder holds ONLY generic seed material —
// see docs/DEMO-INTAKE.md, "What a stranger can see".
const DEMO_CLIENT_ID = 'demo_client';

const INTAKE_LIMITS = {
  // Per sender per UTC day, on the open route only. Registered clients on proposal@ are not
  // rate limited — they are paying for throughput.
  max_rfq_per_sender_per_day: 3,
  // The whole open address per UTC day. Per-sender alone caps nothing: rotating the From costs
  // an attacker nothing, so this is the ceiling that actually bounds the bill.
  max_open_rfq_per_day: 25,
  // Envelope size and attachment count. The pipeline never reads attachments (Module 1 sees
  // subject + text), so a big one is pure carriage — but generous enough that a real RFQ with
  // drawings attached still gets through.
  max_email_bytes: 10 * 1024 * 1024,
  max_attachments: 10,
  // The token bill tracks body length, so an over-long body is TRUNCATED rather than rejected:
  // a genuine 40-page tender still produces a proposal, it just stops paying past the cap.
  max_body_chars: 20000,
  // Below this there is nothing to extract. Module 1's own `incomplete` path handles the
  // merely-thin RFQ; this only catches the empty one.
  min_body_chars: 80,
};

// Headers whose mere presence marks machine-generated mail.
const AUTOMATED_HEADERS = [
  'x-autoreply',
  'x-autorespond',
  'x-autoresponder',
  'x-auto-response-suppress',
  'list-id',
  'list-unsubscribe',
  'x-failed-recipients',
  'feedback-id',
];

// `Precedence:` values that mean "not a person writing to you" (RFC 3834 and common practice).
const BULK_PRECEDENCE = ['bulk', 'junk', 'list', 'auto_reply'];

// Subjects of autoresponders and delivery reports, EN + ES + DE (the languages the outbound
// machine actually writes in).
const AUTOMATED_SUBJECT_RE = /^\s*(re:\s*|fwd?:\s*)*(out of office|automatic(al)? reply|auto(matic)?[\s-]?reply|autoreply|auto:|undeliverable|undelivered mail|delivery (status notification|failure|has failed)|mail delivery (failed|subsystem)|returned mail|failure notice|read receipt|abwesenheits?notiz|automatische antwort|respuesta autom[aá]tica|fuera de la oficina|correo no entregado)/i;

// Local-parts that never belong to a human who wants a proposal back.
const NOREPLY_LOCALPART_RE = /^(no[._-]?reply|do[._-]?not[._-]?reply|donotreply|mailer[._-]?daemon|postmaster|bounces?|notifications?|automated?|alerts?|newsletters?)([._+-]|$)/i;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

/** Every email address in a header value, lower-cased. */
function addressesIn(value) {
  if (value == null) return [];
  return String(value).toLowerCase().match(EMAIL_RE) || [];
}

/**
 * Flatten whatever header shape the trigger produced into one lower-cased name -> value map.
 *
 * n8n's Gmail trigger with `simple: false` gives `payload.headers` as an array of {name, value};
 * a pinned or hand-built item may give a plain object instead. Repeated headers (several
 * `Received:` or `Delivered-To:` lines) are joined rather than overwritten — the delivery
 * address we are routing on is often in the second one.
 */
function normaliseHeaders(raw) {
  const out = {};
  const push = (name, value) => {
    if (!name || value == null) return;
    const key = String(name).toLowerCase().trim();
    const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
    out[key] = out[key] ? `${out[key]}, ${val}` : val;
  };
  if (Array.isArray(raw)) {
    for (const h of raw) push(h && h.name, h && h.value);
  } else if (raw && typeof raw === 'object') {
    for (const key of Object.keys(raw)) push(key, raw[key]);
  }
  return out;
}

/** Pull a sender address out of the many shapes `from` arrives in. */
function extractSender(...candidates) {
  for (let value of candidates) {
    if (value && typeof value === 'object') {
      const first = value.value && value.value[0];
      value = (first && (first.address || first.value)) || value.address || value.text || '';
    }
    const found = addressesIn(value);
    if (found.length) return found[0];
  }
  return null;
}

/**
 * Decide the intake route from the DESTINATION address.
 *
 * Envelope headers are scanned before the visible ones: `Delivered-To` is what Gmail actually
 * delivered to, whereas `To` is only what the sender typed. Both are checked because alias
 * delivery often leaves the alias in `To` and the underlying mailbox in `Delivered-To`.
 *
 * If BOTH intake addresses appear, demo@ wins. It is the strictly safer of the two — demo tenant,
 * forced draft — so an ambiguous recipient list can never be the thing that buys live sending to
 * a stranger.
 *
 * Any other address (or none at all, e.g. the chat trigger) keeps the registry route, so opening
 * demo@ cannot silently make some third address public too.
 */
function resolveIntake(headers) {
  const h = headers || {};
  const pools = ['delivered-to', 'x-original-to', 'envelope-to', 'x-forwarded-to', 'to', 'cc', 'bcc'];
  const recipients = [];
  for (const name of pools) recipients.push(...addressesIn(h[name]));

  if (recipients.includes(DEMO_INTAKE_ADDRESS)) {
    return { route: 'open', address: DEMO_INTAKE_ADDRESS, client_id: DEMO_CLIENT_ID, open: true, recipients };
  }
  if (recipients.includes(PROPOSAL_INTAKE_ADDRESS)) {
    return { route: 'registry', address: PROPOSAL_INTAKE_ADDRESS, client_id: null, open: false, recipients };
  }
  return { route: 'registry', address: null, client_id: null, open: false, recipients };
}

/**
 * Strip a message down to the text a human actually typed, for the emptiness test ONLY.
 *
 * This result is never what Module 1 sees — quoting and signatures are legitimate RFQ context and
 * the extractor is better at reading them than a regex is. It exists so that "auto-reply with a
 * 400-line quoted thread underneath" is correctly measured as empty.
 */
function meaningfulBody(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#3?9;/gi, "'");

  const kept = [];
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^>/.test(t)) continue;
    if (/^(-{2,}|_{3,}|\*{3,})\s*$/.test(t)) break;
    if (/^(on\s.+\swrote:|el\s.+\sescribió:|am\s.+\sschrieb:|-{2,}\s*(original message|forwarded message|mensaje original))/i.test(t)) break;
    kept.push(t);
  }
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Is this machine-generated mail rather than someone asking for a quote?
 *
 * Returns a reason string, or null when the message looks human. Applied on EVERY route, not just
 * the open one: an out-of-office was never a valid RFQ on any address, and turning one into a
 * proposal is a bug wherever it happens.
 */
function detectAutomated({ headers, subject, senderEmail }) {
  const h = headers || {};

  // RFC 3834: 'no' is the only value that means "a person sent this".
  const autoSubmitted = String(h['auto-submitted'] || '').trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return 'auto_submitted';

  for (const name of AUTOMATED_HEADERS) {
    if (h[name] != null && String(h[name]).trim() !== '') return 'automated_header';
  }

  const precedence = String(h.precedence || '').trim().toLowerCase();
  if (BULK_PRECEDENCE.includes(precedence)) return 'bulk_precedence';

  // A null return-path is the signature of a bounce / delivery status notification.
  const returnPath = String(h['return-path'] || '').trim();
  if (returnPath === '<>' || returnPath === '') {
    if (returnPath === '<>') return 'bounce';
  }

  if (AUTOMATED_SUBJECT_RE.test(String(subject || ''))) return 'automated_subject';

  const localPart = String(senderEmail || '').split('@')[0];
  if (localPart && NOREPLY_LOCALPART_RE.test(localPart)) return 'noreply_sender';

  return null;
}

/**
 * Run every intake guard over one message and say what should happen to it.
 *
 * `counters` is the persisted daily tally — `{ day, by_sender, open_total }`. In n8n it is
 * `$getWorkflowStaticData('global')`; in the self-check it is a plain object. It is mutated in
 * place, and ONLY when a message is accepted, so a rejected message never consumes quota.
 *
 * Returns:
 *   { accepted: false, drop: true,  reason, notify: false }  junk — swallow it silently. A spam
 *                                                            wave must not become a Telegram flood.
 *   { accepted: false, drop: false, reason, notify: true }   refused, and Mark should know.
 *   { accepted: true,  text, truncated, ... }                proceed; `text` may be truncated.
 */
function classifyIntake({
  intake,
  senderEmail,
  subject,
  text,
  headers,
  sizeBytes,
  attachmentCount,
  counters,
  today,
  limits,
}) {
  const lim = Object.assign({}, INTAKE_LIMITS, limits || {});
  const route = (intake && intake.route) || 'registry';
  const open = !!(intake && intake.open);
  const sender = senderEmail ? String(senderEmail).toLowerCase() : null;

  const drop = (reason) => ({ accepted: false, drop: true, notify: false, reason, route, open });
  const refuse = (reason, detail) => ({ accepted: false, drop: false, notify: true, reason, detail: detail || '', route, open, sender_email: sender });

  // --- 1. junk filter (every route) ----------------------------------------
  const automated = detectAutomated({ headers, subject, senderEmail: sender });
  if (automated) return drop(automated);

  const body = meaningfulBody(text);
  if (body.length < lim.min_body_chars) return drop('empty_body');

  // --- everything below guards the PUBLIC address only ----------------------
  // A registered client on proposal@ is paying for throughput and is not metered.
  if (!open) {
    return { accepted: true, drop: false, notify: false, route, open, sender_email: sender, text: String(text == null ? '' : text), truncated: false, body_chars: body.length };
  }

  // The reply to a public RFQ goes to whoever sent it. With no parseable sender there is nobody
  // to reply to, and Module 4 would throw much further downstream after all the spend.
  if (!sender) return refuse('no_sender', 'open intake with no parseable From address');

  // --- 2. size / attachment cap --------------------------------------------
  const bytes = Number(sizeBytes) || 0;
  if (bytes > lim.max_email_bytes) {
    return refuse('oversize', `${Math.round(bytes / 1024)} KB over the ${Math.round(lim.max_email_bytes / 1024)} KB cap`);
  }
  const attachments = Number(attachmentCount) || 0;
  if (attachments > lim.max_attachments) {
    return refuse('too_many_attachments', `${attachments} attachments over the ${lim.max_attachments} cap`);
  }

  // --- 3. rate limit, per sender and overall --------------------------------
  const day = today || new Date().toISOString().slice(0, 10);
  if (counters.day !== day) {
    counters.day = day;
    counters.by_sender = {};
    counters.open_total = 0;
  }
  if (!counters.by_sender) counters.by_sender = {};
  if (typeof counters.open_total !== 'number') counters.open_total = 0;

  const usedBySender = counters.by_sender[sender] || 0;
  if (usedBySender >= lim.max_rfq_per_sender_per_day) {
    return refuse('rate_limited_sender', `${usedBySender} already today, cap ${lim.max_rfq_per_sender_per_day}`);
  }
  if (counters.open_total >= lim.max_open_rfq_per_day) {
    return refuse('rate_limited_global', `${counters.open_total} public RFQs already today, cap ${lim.max_open_rfq_per_day}`);
  }

  // --- 4. body cap: truncate, do not refuse ---------------------------------
  const raw = String(text == null ? '' : text);
  let outText = raw;
  let truncated = false;
  if (raw.length > lim.max_body_chars) {
    outText = `${raw.slice(0, lim.max_body_chars)}\n\n[intake guard: truncated ${raw.length - lim.max_body_chars} characters over the ${lim.max_body_chars}-character cap]`;
    truncated = true;
  }

  // Quota is spent only by a message that is actually going to be processed.
  counters.by_sender[sender] = usedBySender + 1;
  counters.open_total += 1;

  return {
    accepted: true,
    drop: false,
    notify: false,
    route,
    open,
    sender_email: sender,
    text: outText,
    truncated,
    body_chars: body.length,
    sender_count_today: counters.by_sender[sender],
    open_total_today: counters.open_total,
  };
}
// === INTAKE CORE END ===

// Offline end-to-end check of the routing decision and all four guards. This is the test that
// `npm run check` runs; the scenarios it covers are the ones docs/DEMO-INTAKE.md documents.
if (require.main === module) {
  let failures = 0;
  const check = (name, cond, detail) => {
    if (cond) {
      console.log(`  ok    ${name}`);
    } else {
      console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
      failures += 1;
    }
  };

  const hdr = (obj) => normaliseHeaders(Object.entries(obj).map(([name, value]) => ({ name, value })));
  const BODY = 'Hi, we are quoting a conveyor system for a packaging line in Zaragoza. We need 120 m of belt conveyor, two sorters and commissioning on site. Budget approval is due in three weeks.';
  const fresh = () => ({ day: '2026-08-11', by_sender: {}, open_total: 0 });
  const run = (over) => classifyIntake(Object.assign({
    intake: resolveIntake(hdr({ To: DEMO_INTAKE_ADDRESS })),
    senderEmail: 'stranger@example-integrator.co.uk',
    subject: 'RFQ — conveyor system',
    text: BODY,
    headers: hdr({ To: DEMO_INTAKE_ADDRESS }),
    sizeBytes: 40000,
    attachmentCount: 0,
    counters: fresh(),
    today: '2026-08-11',
  }, over));

  console.log('routing');
  const openRoute = resolveIntake(hdr({ 'Delivered-To': 'mark@cifral.io', To: 'demo@cifral.io' }));
  check('demo@ in To resolves to the open route on demo_client', openRoute.open === true && openRoute.client_id === DEMO_CLIENT_ID);
  const prodRoute = resolveIntake(hdr({ To: 'proposal@cifral.io' }));
  check('proposal@ keeps the registry route', prodRoute.open === false && prodRoute.client_id === null && prodRoute.address === PROPOSAL_INTAKE_ADDRESS);
  const bothRoute = resolveIntake(hdr({ To: 'proposal@cifral.io', Cc: 'demo@cifral.io' }));
  check('demo@ wins when both intake addresses are addressed', bothRoute.open === true);
  const ccRoute = resolveIntake(hdr({ To: 'someone@else.com', Cc: 'DEMO@Cifral.IO' }));
  check('routing is case-insensitive and reads Cc', ccRoute.open === true);
  const noneRoute = resolveIntake(hdr({ To: 'mark@cifral.io' }));
  check('any other address stays on the registry route', noneRoute.open === false && noneRoute.address === null);
  check('no headers at all (chat trigger) stays on the registry route', resolveIntake({}).open === false);

  console.log('\nguards — junk filter');
  check('out-of-office is dropped silently', (() => { const r = run({ subject: 'Out of Office: RFQ — conveyor system' }); return r.drop === true && r.notify === false && r.reason === 'automated_subject'; })());
  check('Auto-Submitted: auto-replied is dropped', run({ headers: hdr({ To: DEMO_INTAKE_ADDRESS, 'Auto-Submitted': 'auto-replied' }) }).reason === 'auto_submitted');
  check("Auto-Submitted: no is NOT treated as automated", run({ headers: hdr({ To: DEMO_INTAKE_ADDRESS, 'Auto-Submitted': 'no' }) }).accepted === true);
  check('a mailing list (List-Id) is dropped', run({ headers: hdr({ To: DEMO_INTAKE_ADDRESS, 'List-Id': '<news.example.com>' }) }).reason === 'automated_header');
  check('Precedence: bulk is dropped', run({ headers: hdr({ To: DEMO_INTAKE_ADDRESS, Precedence: 'bulk' }) }).reason === 'bulk_precedence');
  check('a bounce (null return-path) is dropped', run({ headers: hdr({ To: DEMO_INTAKE_ADDRESS, 'Return-Path': '<>' }) }).reason === 'bounce');
  check('a no-reply sender is dropped', run({ senderEmail: 'no-reply@example.com' }).reason === 'noreply_sender');
  check('an ordinary sender is not mistaken for no-reply', run({ senderEmail: 'noel@example.com' }).accepted === true);
  check('an empty body is dropped', run({ text: 'Thanks!' }).reason === 'empty_body');
  check('a body that is only a quoted thread is dropped', run({ text: `Thanks.\n\nOn Mon, Aug 10, 2026 at 9:14 AM Mark wrote:\n${BODY}\n${BODY}` }).reason === 'empty_body');
  check('the junk filter also applies on the registry route', classifyIntake({ intake: prodRoute, senderEmail: 'sales@demo-client.example', subject: 'Automatic reply: RFQ', text: BODY, headers: hdr({ To: PROPOSAL_INTAKE_ADDRESS }), sizeBytes: 1000, attachmentCount: 0, counters: fresh(), today: '2026-08-11' }).drop === true);

  console.log('\nguards — size and attachments');
  check('a 12 MB email is refused with an alert', (() => { const r = run({ sizeBytes: 12 * 1024 * 1024 }); return r.accepted === false && r.drop === false && r.notify === true && r.reason === 'oversize'; })());
  check('11 attachments are refused', run({ attachmentCount: 11 }).reason === 'too_many_attachments');
  check('10 attachments are allowed', run({ attachmentCount: 10 }).accepted === true);
  check('a registered client is NOT size-capped', classifyIntake({ intake: prodRoute, senderEmail: 'sales@demo-client.example', subject: 'RFQ', text: BODY, headers: hdr({ To: PROPOSAL_INTAKE_ADDRESS }), sizeBytes: 50 * 1024 * 1024, attachmentCount: 40, counters: fresh(), today: '2026-08-11' }).accepted === true);

  console.log('\nguards — rate limit');
  {
    const counters = fresh();
    const shots = [1, 2, 3, 4].map(() => run({ counters }));
    check('the first three RFQs from one sender pass', shots.slice(0, 3).every((r) => r.accepted === true));
    check('the fourth is refused with an alert', shots[3].accepted === false && shots[3].reason === 'rate_limited_sender' && shots[3].notify === true);
    check('a refused message does not consume quota', counters.by_sender['stranger@example-integrator.co.uk'] === 3 && counters.open_total === 3);
    const other = run({ counters, senderEmail: 'someone-else@example.com' });
    check('a different sender still gets through', other.accepted === true && counters.open_total === 4);
  }
  {
    const counters = fresh();
    for (let i = 0; i < INTAKE_LIMITS.max_open_rfq_per_day; i += 1) run({ counters, senderEmail: `rotating-${i}@example.com` });
    const over = run({ counters, senderEmail: 'rotating-fresh@example.com' });
    check('the global daily ceiling stops a rotating-sender flood', over.accepted === false && over.reason === 'rate_limited_global');
  }
  {
    const counters = { day: '2026-08-10', by_sender: { 'stranger@example-integrator.co.uk': 3 }, open_total: 25 };
    const r = run({ counters });
    check('a new UTC day resets both counters', r.accepted === true && counters.day === '2026-08-11' && counters.open_total === 1);
  }
  {
    const counters = fresh();
    classifyIntake({ intake: prodRoute, senderEmail: 'sales@demo-client.example', subject: 'RFQ', text: BODY, headers: hdr({ To: PROPOSAL_INTAKE_ADDRESS }), sizeBytes: 1000, attachmentCount: 0, counters, today: '2026-08-11' });
    check('a registered client consumes no public quota', counters.open_total === 0);
  }

  console.log('\nguards — body cap');
  {
    const long = `${BODY} `.repeat(400);
    const r = run({ text: long });
    check('an over-long body is truncated, not refused', r.accepted === true && r.truncated === true);
    check('the truncated body respects the cap', r.text.length < long.length && r.text.startsWith(long.slice(0, 200)), `${r.text.length} chars`);
    check('a normal body is passed through untouched', run().text === BODY && run().truncated === false);
  }

  console.log('\nthe headline case — a stranger writing to demo@');
  {
    const headers = hdr({
      'Delivered-To': 'mark@cifral.io',
      To: 'demo@cifral.io',
      From: 'Jamie Pringle <jamie@machine-building-systems.example>',
      Subject: 'RFQ — palletiser cell',
    });
    const intake = resolveIntake(headers);
    const sender = extractSender(headers.from);
    const verdict = classifyIntake({ intake, senderEmail: sender, subject: 'RFQ — palletiser cell', text: BODY, headers, sizeBytes: 21000, attachmentCount: 1, counters: fresh(), today: '2026-08-11' });
    check('resolves to demo_client', intake.client_id === DEMO_CLIENT_ID);
    check('is accepted', verdict.accepted === true);
    check('the sender is read off the From header', sender === 'jamie@machine-building-systems.example');
    check('the reply will go to the stranger, not to a registered contact', verdict.sender_email === sender);
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nOK — routing and all four intake guards behave as documented.');
}

module.exports = {
  DEMO_INTAKE_ADDRESS,
  PROPOSAL_INTAKE_ADDRESS,
  DEMO_CLIENT_ID,
  INTAKE_LIMITS,
  addressesIn,
  normaliseHeaders,
  extractSender,
  resolveIntake,
  meaningfulBody,
  detectAutomated,
  classifyIntake,
};
