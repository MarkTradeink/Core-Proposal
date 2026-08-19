// Cifral client-field capture — pulls a client's OWN document variables (offer number, asset
// number, project number, …) out of the incoming RFQ text.
//
// This is the SAME logic embedded in the n8n workflow `01-data-collection-validation.json`
// ("Capture Client Fields" node). If you change it, change it in both places — the region
// between the FIELD CAPTURE CORE markers is what the node runs. Same convention as
// modules/pricing/pricing_core.js and modules/proposal/render_context.js.
//
// WHY THERE IS NO LANGUAGE MODEL HERE. These values are identifiers: an offer number from the
// client's ERP, an asset number, a project code. A hallucinated identifier is strictly worse than
// a missing one — it lands on the cover of a document that goes to a customer, it looks entirely
// plausible, and nobody catches it. So capture is a labelled-value match and nothing else.
//
// The loop that makes it reliable is a closed one:
//
//   the client's Proposal Config sheet (tab `Fields`) declares the label — "Oferta nº"
//     -> scripts/client-docs.js prints that label into the client's own RFQ email template
//       -> the sender writes "Oferta nº: 905149921"
//         -> this reads it back, verbatim
//
// If the label is not in the message the field comes back empty, and a field marked `required`
// makes Module 1 flag the RFQ `incomplete` instead of shipping a cover with a hole in it.
//
// Quick check:  node modules/proposal/field_capture.js

// === FIELD CAPTURE CORE START ===

// Case- and accent-folding that preserves length 1:1, so an offset found in the folded string is
// valid in the original. NFD normalisation would be shorter to write and would break exactly
// that property — 'ó' becomes two code points and every offset after it shifts.
const FOLD_MAP = {
  'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a', 'å': 'a',
  'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
  'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
  'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
  'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
  'ñ': 'n', 'ç': 'c',
  // Ordinal and degree marks are routinely swapped for one another when someone retypes a label.
  // 'Oferta nº' and 'Oferta n°' must not be two different labels.
  'º': 'o', '°': 'o', 'ª': 'a',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

function foldText(value) {
  let out = '';
  for (const ch of String(value == null ? '' : value)) {
    const mapped = FOLD_MAP[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    const lower = ch.toLowerCase();
    // Some code points grow when lowercased ('İ' -> 'i̇'). Keeping the original preserves the
    // 1:1 length invariant this whole function exists for.
    out += lower.length === 1 ? lower : ch;
  }
  return out;
}

// Same vocabulary the rest of the sheet uses for a yes/no cell.
const TRUTHY = ['1', 'true', 'yes', 'si', 'sí', 'x', 'y'];

function normText(v) {
  return v == null ? '' : String(v).trim();
}

// A captured value is a reference, not a paragraph. The cap stops a missing separator from
// swallowing the rest of an email into the cover page.
const MAX_VALUE_LENGTH = 200;

// The separator between a label and its value: 'Oferta nº: 123', 'Oferta nº.- 123', 'Asset 123'.
const SEPARATOR = /^[\s]*[.:：=\-–—]*[\s]*/;

// A value also ends at the next thing that LOOKS like a label, even one this client never
// declared. Header blocks pasted out of an ERP put several on one line and only some of them
// are fields we know about — without this, 'Oferta nº: 905149921  Versión: 1.0' would put the
// version inside the offer number. The leading \s is what keeps a value whose own first token
// carries a colon ('PRJ-77: rev B') intact, and requiring whitespace after the colon keeps
// clock times and URLs out of it.
const NEXT_LABELISH = /\s[\p{L}][\p{L}\d.º°_\/-]{0,28}\s*:(?=\s|$)/u;

// A field key becomes a template tag ({campos.offer_no}), and tags are evaluated as Jexl
// expressions — so '-' would be read as subtraction and an accent breaks the tag outright.
const SAFE_FIELD_KEY = /^[a-z][a-z0-9_]*$/;

const FIELD_SOURCES = ['static', 'request', 'auto'];

// What `source: auto` may point at. A closed list on purpose: these are values the pipeline
// already computes, and a typo should be a visible warning rather than a silently empty cover.
const AUTO_FIELDS = [
  'proposal_number', 'date', 'version', 'tier', 'language',
  'client_company', 'client_contact', 'client_email', 'client_phone',
  'project_title', 'project_type', 'project_location', 'project_deadline',
];

/**
 * Rows of the sheet's `Fields` tab -> this client's own document variables.
 *
 * This is the tab that makes a cover page client-specific without a deploy. The catalog owns the
 * chapters; `Fields` owns everything around them that only this client has — an offer number
 * from their ERP, an asset number, the legal name that goes in their footer.
 *
 * Every rejection is a warning rather than a throw: a typo in one row must cost that one field,
 * visibly, and never the whole proposal.
 */
function parseFieldDefinitions(rows, warnings) {
  const out = [];
  const seen = new Set();
  const warn = (m) => { if (warnings) warnings.push(`Fields tab: ${m}`); };

  for (const r of rows || []) {
    const key = normText(r && r.key).toLowerCase();
    if (!key) continue;
    if (!SAFE_FIELD_KEY.test(key)) { warn(`key '${key}' is not a valid tag name (lowercase letters, digits and _ only), row ignored`); continue; }
    if (seen.has(key)) { warn(`duplicate key '${key}' — kept the first occurrence, ignored the repeat`); continue; }

    const source = (normText(r.source) || 'static').toLowerCase();
    if (!FIELD_SOURCES.includes(source)) { warn(`key '${key}' has unknown source '${source}', row ignored`); continue; }

    const value = normText(r.value);
    // Comma-separated alternatives, so 'Oferta nº, Offer no' captures one field in either
    // language without needing two rows. A label containing a comma is the one thing this
    // cannot express.
    //
    // An alternative may carry an OPTIONAL language tag — 'es:Oferta nº, en:Offer no'. The tag is
    // stripped for capture, which still looks for every alternative on every message: a Spanish
    // sender who writes 'Offer no' is understood, and always was. What the tag adds is which one
    // to PRINT, on a cover rendered in that language.
    //
    // Without it the printed label had to be guessed from position, and position carries no
    // language: 'Asset, Activo' and 'Oferta nº, Offer no' put opposite languages first, so an
    // English cover came out reading 'Activo'. Untagged rows keep the old behaviour exactly —
    // the first alternative prints — so nothing that exists today has to change.
    const rawLabels = normText(r.capture_label).split(',').map((x) => x.trim()).filter(Boolean);
    const labelByLang = {};
    const labels = rawLabels.map((raw) => {
      const m = raw.match(/^(es|en)\s*:\s*(.+)$/i);
      if (!m) return raw;
      const lang = m[1].toLowerCase();
      const text = m[2].trim();
      if (text && !labelByLang[lang]) labelByLang[lang] = text;
      return text;
    }).filter(Boolean);
    const required = TRUTHY.includes(normText(r.required).toLowerCase());

    if (source === 'request' && !labels.length) { warn(`key '${key}' has source 'request' but no capture_label — nothing to look for, row ignored`); continue; }
    if (source === 'auto' && !AUTO_FIELDS.includes(value)) { warn(`key '${key}' has source 'auto' with unknown value '${value}' (expected one of: ${AUTO_FIELDS.join(', ')}), row ignored`); continue; }
    if (source === 'static' && !value && required) warn(`key '${key}' is required but its static value is empty`);

    seen.add(key);
    // `labels` is what the capture looks for; `label_by_lang` is only ever what a template
    // PRINTS. Keeping them apart is what lets the two lists differ without either one surprising
    // the other.
    out.push({ key, source, value, labels, label_by_lang: labelByLang, required, notes: normText(r.notes) });
  }
  return out;
}

/**
 * Read declared `request` fields out of the RFQ text.
 *
 * One pass over each line finds every declared label in it, then each label's value runs to the
 * start of the NEXT label on that line. That is what lets a single line carry several fields —
 * 'Att. Santiago Luna  Oferta nº.: 905149921  Versión: 1.0' — which is exactly how these values
 * arrive when someone pastes a header block out of their ERP.
 */
function captureFields(text, definitions) {
  const values = {};
  const matched = {};
  const wanted = [];

  for (const def of definitions || []) {
    if (def.source !== 'request') continue;
    for (const label of def.labels) {
      const folded = foldText(label);
      if (folded) wanted.push({ key: def.key, label, folded });
    }
  }
  if (!wanted.length) return { values, matched };

  // Longest label first: 'Project number' must win over 'Project' on the same line.
  wanted.sort((a, b) => b.folded.length - a.folded.length);

  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const folded = foldText(line);
    const hits = [];
    const taken = [];

    for (const w of wanted) {
      let from = 0;
      for (;;) {
        const at = folded.indexOf(w.folded, from);
        if (at === -1) break;
        from = at + 1;
        // A label must start a word — otherwise 'asset' would match inside 'reassessment'.
        const before = at === 0 ? '' : folded[at - 1];
        if (before && /[a-z0-9_]/.test(before)) continue;
        // A longer label already claimed this span.
        const end = at + w.folded.length;
        if (taken.some((t) => at < t.end && end > t.start)) continue;
        taken.push({ start: at, end });
        hits.push({ key: w.key, start: at, end });
        break;
      }
    }

    if (!hits.length) continue;
    hits.sort((a, b) => a.start - b.start);

    hits.forEach((hit, i) => {
      if (values[hit.key]) return; // first occurrence in the message wins
      const stop = i + 1 < hits.length ? hits[i + 1].start : line.length;
      let raw = line.slice(hit.end, stop).replace(SEPARATOR, '');
      const nextLabel = raw.match(NEXT_LABELISH);
      if (nextLabel) raw = raw.slice(0, nextLabel.index);
      raw = raw.trim().replace(/[,;]+$/, '').trim();
      // A label alone on its line ('Oferta nº:') is a heading, not a value — leave the field
      // empty so the required check can catch it, rather than capturing ''.
      if (!raw) return;
      values[hit.key] = raw.slice(0, MAX_VALUE_LENGTH).trim();
      matched[hit.key] = line.trim().slice(0, MAX_VALUE_LENGTH);
    });
  }

  return { values, matched };
}

/**
 * Which required fields the request did not supply.
 *
 * Only `request` fields can be missing at this point: `static` comes from the sheet and `auto`
 * from the pipeline. Returned as plain keys so Module 1 can append them to `missing_fields` and
 * mark the RFQ `incomplete` — the same treatment any other missing required field gets.
 */
function missingRequiredFields(definitions, values) {
  const missing = [];
  for (const def of definitions || []) {
    if (!def.required || def.source !== 'request') continue;
    if (!normText(values && values[def.key])) missing.push(def.key);
  }
  return missing;
}
// === FIELD CAPTURE CORE END ===

// Manual sanity check. What matters here is that capture is EXACT: a value that is read must be
// the value that was written, and a value that is absent must stay absent rather than becoming
// something plausible.
if (require.main === module) {
  const problems = [];
  const warnings = [];

  const defs = parseFieldDefinitions([
    { key: 'offer_no', source: 'request', value: '', capture_label: 'Oferta nº, Offer no', required: 'yes' },
    { key: 'asset_no', source: 'request', value: '', capture_label: 'Asset', required: '' },
    // Language-tagged alternatives: captured on either word, printed in the reader's own.
    { key: 'tagged', source: 'request', value: '', capture_label: 'es:Nº activo, en:Asset no', required: '' },
    { key: 'project_no', source: 'request', value: '', capture_label: 'Project number', required: 'yes' },
    { key: 'att', source: 'request', value: '', capture_label: 'Att.', required: '' },
    { key: 'issuer_name', source: 'static', value: 'BEUMER Group Technology Iberia S.L.', capture_label: '', required: 'yes' },
    { key: 'doc_version', source: 'auto', value: 'version', capture_label: '', required: '' },
    // Every one of these is rejected, each with its own warning.
    { key: 'bad-key', source: 'static', value: 'x', capture_label: '', required: '' },
    { key: 'offer_no', source: 'static', value: 'duplicate', capture_label: '', required: '' },
    { key: 'nolabel', source: 'request', value: '', capture_label: '', required: '' },
    { key: 'badsource', source: 'magic', value: '', capture_label: '', required: '' },
    { key: 'badauto', source: 'auto', value: 'not_a_thing', capture_label: '', required: '' },
  ], warnings);

  if (defs.length !== 7) problems.push(`expected 7 valid definitions, got ${defs.length}`);

  const tagged = defs.find((d) => d.key === 'tagged');
  if (tagged.labels.join('|') !== 'Nº activo|Asset no') problems.push(`the language tag must be stripped for capture: ${tagged.labels.join('|')}`);
  if (tagged.label_by_lang.es !== 'Nº activo' || tagged.label_by_lang.en !== 'Asset no') problems.push('a tagged label must be printable per language');
  const untagged = defs.find((d) => d.key === 'offer_no');
  if (Object.keys(untagged.label_by_lang).length) problems.push('an untagged row must declare no printable label, so the first alternative keeps printing');
  if (captureFields('Nº activo: A-991', defs).values.tagged !== 'A-991') problems.push('a tagged label must still capture');
  if (captureFields('Asset no: A-991', defs).values.tagged !== 'A-991') problems.push('the other language of a tagged label must capture too');
  if (warnings.length !== 5) problems.push(`expected 5 warnings, got ${warnings.length}: ${warnings.join(' | ')}`);

  const body = [
    'Hola,',
    '',
    'Adjunto la solicitud para el cliente final.',
    'Att. Santiago Luna  Oferta nº.: 905149921  Versión: 1.0',
    '  • Asset: A-4471',
    'Project number:',
    'Reassessment of the asset register is not a label.',
    'Offer no: 999999999',
    '',
    'Gracias.',
  ].join('\n');

  const { values } = captureFields(body, defs);

  // Several fields on one line, each stopping where the next begins.
  if (values.att !== 'Santiago Luna') problems.push(`att wrong: ${JSON.stringify(values.att)}`);
  if (values.offer_no !== '905149921') problems.push(`offer_no wrong: ${JSON.stringify(values.offer_no)}`);
  // Accent/ordinal folding: the sheet says 'Oferta nº', the mail says 'Oferta nº.:'.
  if (values.offer_no === undefined) problems.push('accent-folded label did not match');
  // A later alternative label must not overwrite an earlier capture.
  if (values.offer_no === '999999999') problems.push('a later occurrence overwrote the first one');
  // Leading bullet markers are stripped.
  if (values.asset_no !== 'A-4471') problems.push(`asset_no wrong: ${JSON.stringify(values.asset_no)}`);
  // A label with nothing after it is a heading, not a value.
  if ('project_no' in values) problems.push('a label with an empty value must not be captured');
  // Word-boundary: 'Reassessment' contains 'asset' and must not match.
  if (values.asset_no !== 'A-4471') problems.push('word-boundary check failed');

  const missing = missingRequiredFields(defs, values);
  if (missing.join(',') !== 'project_no') problems.push(`missing required fields wrong: ${missing.join(',')}`);

  // Longest-label-first: 'Project number' must beat 'Project'.
  const overlap = parseFieldDefinitions([
    { key: 'proj', source: 'request', capture_label: 'Project', required: '' },
    { key: 'proj_no', source: 'request', capture_label: 'Project number', required: '' },
  ], []);
  const ov = captureFields('Project number: PRJ-77', overlap).values;
  if (ov.proj_no !== 'PRJ-77') problems.push(`longest label should win: ${JSON.stringify(ov)}`);
  if (ov.proj !== undefined) problems.push('the shorter label must not also match the same span');

  // A value stops at an UNDECLARED label too: 'Versión' is not a field here, and without that
  // stop the offer number would have swallowed it.
  if (values.offer_no !== '905149921') problems.push(`value ran past an undeclared label: ${JSON.stringify(values.offer_no)}`);
  // ...but a colon inside the value's own first token is part of the value, not a new label.
  const colonish = captureFields('Asset PRJ-77: rev B', defs).values;
  if (colonish.asset_no !== 'PRJ-77: rev B') problems.push(`a colon in the value was mistaken for a label: ${JSON.stringify(colonish.asset_no)}`);
  // A clock time is not a label either.
  const timey = captureFields('Asset A-1 entrega 10:30', defs).values;
  if (timey.asset_no !== 'A-1 entrega 10:30') problems.push(`a clock time was mistaken for a label: ${JSON.stringify(timey.asset_no)}`);

  // A value must never run away with the rest of the message.
  const long = captureFields(`Asset ${'x'.repeat(500)}`, defs).values;
  if (long.asset_no.length !== MAX_VALUE_LENGTH) problems.push(`value cap not applied: ${long.asset_no.length}`);

  // No definitions, no text, nothing declared — all must be quiet no-ops, not crashes.
  if (captureFields('anything', []).values.offer_no !== undefined) problems.push('empty definitions should capture nothing');
  if (Object.keys(captureFields('', defs).values).length) problems.push('empty text should capture nothing');
  if (Object.keys(captureFields(null, defs).values).length) problems.push('null text should capture nothing');

  console.log(`definitions: ${defs.length} valid, ${warnings.length} rejected`);
  console.log(`captured: ${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`missing required: ${missing.join(', ') || '(none)'}`);

  if (problems.length) {
    console.error(`\nFAIL:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nOK — capture is exact, labels fold, the longest label wins, and nothing is invented.');
}

module.exports = { parseFieldDefinitions, captureFields, missingRequiredFields, foldText, MAX_VALUE_LENGTH };
