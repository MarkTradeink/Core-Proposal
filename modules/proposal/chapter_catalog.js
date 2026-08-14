// Cifral chapter-catalog resolution — turns the canonical catalog plus the client's
// "Proposal Config" Google Sheet into the `proposal_config` object that travels in the
// shared envelope.
//
// This is the SAME logic embedded in the n8n workflows ("Build Proposal Config" node in
// 00-orchestrator-end-to-end.json, and the standalone fallback in Modules 2 and 4). If you
// change it, change it in both places — the region between the CHAPTER CATALOG CORE markers
// is what the node runs. Same convention as modules/pricing/pricing_core.js and
// modules/proposal/render_context.js.
//
// Why the split. The repo owns the STRUCTURE (schemas/chapter-catalog.json: which chapters
// exist, what they are called, which agent writes them, which tier they belong to). The
// client's Drive sheet owns the SELECTION and the TEXT (which chapters they actually use,
// renamed how, plus their own clauses, exclusions and writing rules). Exactly the split
// already used for pricing: pricing_core.js has the formula, the Pricing Rules sheet has the
// numbers. n8n cannot read repo files at runtime, so anything a salesperson must be able to
// change without a deploy has to live in Drive.
//
// The catalog is a CLOSED VOCABULARY: a chapter id that is not in it has no agent that knows
// how to write it and no template block to render it. Clients who need something of their own
// use the reserved custom_1..custom_5 slots, whose title and body come entirely from the sheet.
//
// Quick check:  node modules/proposal/chapter_catalog.js

// `parseFieldDefinitions` belongs to the field-capture core (modules/proposal/field_capture.js):
// parsing the `Fields` tab and matching it against an RFQ are one concern, and Module 1 needs it
// without dragging the whole catalog JSON into its node. This require sits ABOVE the core
// markers on purpose — it never reaches n8n. There, scripts/mirror-cores.js inlines BOTH cores
// into the same Code node, so the reference below resolves from the node's own scope.
const { parseFieldDefinitions } = require('./field_capture');

// === CHAPTER CATALOG CORE START ===

// The catalog itself. A Code node cannot read files, so `node scripts/mirror-cores.js` replaces
// the block between these two markers with the inlined contents of the JSON when it copies this
// core into n8n. Everything else is identical on both sides.
// === CATALOG JSON START ===
const CHAPTER_CATALOG = require('../../schemas/chapter-catalog.json');
// === CATALOG JSON END ===

const TIER_RANK = { A: 0, B: 1, C: 2 };

function normText(v) {
  return v == null ? '' : String(v).trim();
}

function truthy(v) {
  const s = normText(v).toLowerCase();
  if (!s) return null; // empty means "inherit", not "no"
  return ['1', 'true', 'yes', 'si', 'sí', 'x', 'y'].includes(s);
}

function pickLang(v) {
  return v === 'es' ? 'es' : 'en';
}

/**
 * Parse one `applies_when` cell into a predicate description.
 *
 * Deliberately NOT a DSL and never eval'd: this string is typed by a salesperson into a
 * spreadsheet, and it decides which contract text goes out. Tokens are comma-separated and
 * ALL must match. Anything unrecognised is reported as a warning and treated as "does not
 * match", so a typo silently drops one clause instead of silently applying all of them.
 *
 *   (empty) | always            -> always applies
 *   scope:installation          -> that scope item is true for this request
 *   tier:B  |  tier:B+          -> exactly tier B  |  tier B or above
 *   lang:es                     -> proposal language
 *   country:ES                  -> project country
 *   pricing | no_pricing        -> whether the request carries a price
 */
function matchesApplies(raw, ctx, warnings, label) {
  const text = normText(raw).toLowerCase();
  if (!text || text === 'always') return true;

  for (const token of text.split(',')) {
    const t = token.trim();
    if (!t) continue;
    const [key, valRaw] = t.split(':');
    const val = normText(valRaw).toLowerCase();

    if (key === 'always') continue;
    else if (key === 'pricing') { if (!ctx.has_pricing) return false; }
    else if (key === 'no_pricing') { if (ctx.has_pricing) return false; }
    else if (key === 'scope') { if (!ctx.scope[val]) return false; }
    else if (key === 'lang') { if (ctx.language !== val) return false; }
    else if (key === 'country') { if (normText(ctx.country).toLowerCase() !== val) return false; }
    else if (key === 'tier') {
      const plus = val.endsWith('+');
      const want = (plus ? val.slice(0, -1) : val).toUpperCase();
      if (!(want in TIER_RANK)) { warnings.push(`${label}: unknown tier '${want}' in applies_when`); return false; }
      if (plus ? TIER_RANK[ctx.tier] < TIER_RANK[want] : ctx.tier !== want) return false;
    } else {
      warnings.push(`${label}: unknown applies_when token '${t}'`);
      return false;
    }
  }
  return true;
}

// A chapter/section survives when its tier includes the document tier AND, if it declares
// requires_scope, at least one of those scope items is in scope for this request.
function passesGates(entry, ctx) {
  const tiers = Array.isArray(entry.tiers) ? entry.tiers : ['A', 'B', 'C'];
  if (!tiers.includes(ctx.tier)) return false;
  const req = Array.isArray(entry.requires_scope) ? entry.requires_scope : [];
  if (req.length && !req.some((k) => ctx.scope[k])) return false;
  if (entry.gated_by === 'has_pricing' && !ctx.has_pricing) return false;
  return true;
}

// Rows of the sheet's `Rules` tab -> the rules object injected into the agent prompts.
function buildRules(rows) {
  const rules = { terminology: {} };
  const LIST_KEYS = ['forbidden_words', 'must_mention'];
  for (const r of rows || []) {
    const key = normText(r.key);
    const value = normText(r.value);
    if (!key) continue;
    if (key.toLowerCase().startsWith('term:')) {
      rules.terminology[key.slice(5).trim()] = value;
    } else if (LIST_KEYS.includes(key)) {
      rules[key] = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
    } else if (['warranty_months', 'validity_days'].includes(key)) {
      const n = Number(value);
      if (Number.isFinite(n)) rules[key] = n;
    } else {
      rules[key] = value;
    }
  }
  return rules;
}

// Rows of the sheet's `Client` tab -> the operational ids that used to live in Notion columns.
//
// The split is now: Notion says WHO the client is and whether they may send (identity, status,
// send_mode, service_tier, and the id of this sheet). The sheet says what their document is made
// of — including which Drive folders it reads and writes. Notion stays the fallback for every
// key here, so a client set up before this tab existed keeps working untouched.
function buildClientSettings(rows) {
  const out = {};
  for (const r of rows || []) {
    const key = normText(r.key);
    if (!key) continue;
    out[key] = normText(r.value);
  }
  return out;
}

// Rows of the sheet's `Templates` tab -> the client's .docx variants.
//
// A client is not one template per language: they have product lines, and a tender answers to a
// different document than a spare-parts quotation. The registry only ever had room for two ids,
// so this moves the whole selection into the sheet where the person who owns the documents can
// change it.
function buildTemplates(rows, warnings) {
  const out = [];
  const seen = new Set();
  for (const r of rows || []) {
    const file_id = normText(r.file_id);
    const variant = normText(r.variant).toLowerCase() || 'default';
    const lang = pickLang(normText(r.lang).toLowerCase());
    if (!file_id) {
      if (normText(r.variant) || normText(r.match)) warnings.push(`Templates tab: variant '${variant}' (${lang}) has no file_id, row ignored`);
      continue;
    }
    const dedupe = `${variant}|${lang}`;
    if (seen.has(dedupe)) { warnings.push(`Templates tab: duplicate variant '${variant}' for language '${lang}' — kept the first occurrence`); continue; }
    seen.add(dedupe);
    out.push({
      variant,
      lang,
      file_id,
      match: normText(r.match).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      is_default: truthy(r.default) === true || variant === 'default',
    });
  }
  return out;
}

/**
 * Pick the .docx for one request.
 *
 * Order, most specific first: an explicitly requested variant, then a keyword from the `match`
 * column found in the request text, then the language's default row, then any row in that
 * language, then the other language. `fallback` is the pair of registry ids, so a client with no
 * `Templates` tab behaves exactly as before.
 *
 * Returns the reason it chose, because "which template did this come out of" is the first
 * question asked when a proposal looks wrong, and the Telegram alert can then answer it.
 */
function selectTemplate({ templates, language, variant, text, fallback }) {
  const rows = Array.isArray(templates) ? templates : [];
  const lang = pickLang(language);
  const other = lang === 'es' ? 'en' : 'es';
  const wanted = normText(variant).toLowerCase();

  if (wanted) {
    const hit = rows.find((t) => t.variant === wanted && t.lang === lang) || rows.find((t) => t.variant === wanted);
    if (hit) return { file_id: hit.file_id, variant: hit.variant, lang: hit.lang, reason: 'requested_variant' };
  }

  const haystack = normText(text).toLowerCase();
  if (haystack) {
    for (const t of rows) {
      if (t.lang !== lang) continue;
      const kw = t.match.find((k) => haystack.includes(k));
      if (kw) return { file_id: t.file_id, variant: t.variant, lang: t.lang, reason: `matched '${kw}'` };
    }
  }

  const byLang = rows.filter((t) => t.lang === lang);
  const chosen = byLang.find((t) => t.is_default) || byLang[0] || rows.find((t) => t.lang === other && t.is_default) || rows.find((t) => t.lang === other);
  if (chosen) return { file_id: chosen.file_id, variant: chosen.variant, lang: chosen.lang, reason: chosen.lang === lang ? 'language_default' : 'language_fallback' };

  const fb = fallback || {};
  const fbId = normText(fb[lang]) || normText(fb[other]);
  if (fbId) return { file_id: fbId, variant: 'registry', lang: normText(fb[lang]) ? lang : other, reason: 'registry_fallback' };

  return null;
}

// Rows of the sheet's `Chapters` tab -> per-chapter overrides, keyed by chapter/section id.
function buildOverrides(rows, warnings, knownIds) {
  const map = {};
  for (const r of rows || []) {
    const id = normText(r.chapter_id);
    if (!id) continue;
    if (knownIds && !knownIds.has(id)) {
      warnings.push(`Chapters tab: unknown chapter_id '${id}' — no such chapter in the catalog, row ignored`);
      continue;
    }
    map[id] = {
      include: truthy(r.include),
      order: r.order === '' || r.order == null ? null : Number(r.order),
      title_es: normText(r.title_es),
      title_en: normText(r.title_en),
      tier: normText(r.tier).toUpperCase() || null,
    };
  }
  return map;
}

function titleFor(entry, override, lang) {
  const fromSheet = override && (lang === 'es' ? override.title_es : override.title_en);
  if (fromSheet) return fromSheet;
  const t = entry.title || {};
  return normText(t[lang]) || normText(t.en) || normText(t.es) || entry.id;
}

function collectIds(catalog) {
  const ids = new Set();
  for (const group of ['front_matter', 'chapters', 'annexes']) {
    for (const ch of catalog[group] || []) {
      ids.add(ch.id);
      for (const s of ch.sections || []) ids.add(s.id);
    }
  }
  return ids;
}

/**
 * Resolve the catalog against one client's sheet and one request.
 *
 * `sheet` is the raw read of the three tabs ({chapters, content, rules}), or null when the
 * client has no Proposal Config sheet — in which case the catalog defaults are used and
 * everything still works. That fallback is what keeps existing clients from breaking when
 * this ships.
 */
function resolveProposalConfig({ catalog, sheet, tier, language, scope, has_pricing, country, sheet_id }) {
  const warnings = [];
  const lang = pickLang(language);
  const rules = buildRules(sheet && sheet.rules);
  const client = buildClientSettings(sheet && sheet.client);
  const templates = buildTemplates(sheet && sheet.templates, warnings);
  const fields = parseFieldDefinitions(sheet && sheet.fields, warnings);

  const wantTier = normText(tier).toUpperCase() || normText(rules.default_tier).toUpperCase() || 'B';
  const resolvedTier = wantTier in TIER_RANK ? wantTier : 'B';
  if (!(wantTier in TIER_RANK)) warnings.push(`Unknown tier '${wantTier}', falling back to 'B'`);

  const ctx = {
    tier: resolvedTier,
    language: lang,
    scope: scope || {},
    has_pricing: !!has_pricing,
    country: country || '',
  };

  const knownIds = collectIds(catalog);
  const overrides = buildOverrides(sheet && sheet.chapters, warnings, knownIds);

  // --- select ---------------------------------------------------------------
  const groups = [
    ['front_matter', catalog.front_matter || []],
    ['body', catalog.chapters || []],
    ['annex', catalog.annexes || []],
  ];

  const selected = [];
  for (const [group, entries] of groups) {
    for (const entry of entries) {
      const ov = overrides[entry.id];
      // include: explicit sheet value wins; otherwise the catalog default; otherwise the gates.
      const explicit = ov ? ov.include : null;
      if (explicit === false) continue;
      if (explicit !== true) {
        if (entry.default_included === false) continue;
        if (!passesGates(entry, ctx)) continue;
      }

      const sections = [];
      for (const s of entry.sections || []) {
        const sov = overrides[s.id];
        const sExplicit = sov ? sov.include : null;
        if (sExplicit === false) continue;
        if (sExplicit !== true) {
          if (s.default_included === false) continue;
          if (!passesGates({ tiers: s.tiers || entry.tiers, requires_scope: s.requires_scope, gated_by: s.gated_by }, ctx)) continue;
        }
        sections.push({
          id: s.id,
          title: titleFor(s, sov, lang),
          content_type: s.content_type || entry.content_type || 'generated',
          agent: s.agent !== undefined ? s.agent : (entry.agent || null),
          tables: Array.isArray(s.tables) ? s.tables : [],
        });
      }

      selected.push({
        id: entry.id,
        group,
        order: ov && ov.order != null && Number.isFinite(ov.order) ? ov.order : entry.order,
        numbered: entry.numbered,
        title: titleFor(entry, ov, lang),
        content_type: entry.content_type || 'generated',
        agent: entry.agent !== undefined ? entry.agent : null,
        guidance: normText(entry.guidance),
        tables: Array.isArray(entry.tables) ? entry.tables : [],
        sections,
      });
    }
  }

  selected.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));

  // --- number ---------------------------------------------------------------
  // Numbers are assigned AFTER exclusions, so a dropped chapter leaves no gap. Word's
  // multilevel list does the same thing for the visible headings; these values exist for the
  // table of contents and for cross-references in the text.
  let bodyN = 0;
  let annexN = 0;
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const ch of selected) {
    if (ch.group === 'body') {
      bodyN += 1;
      ch.numero = String(bodyN);
    } else if (ch.group === 'annex') {
      ch.numero = ALPHA[annexN] || `A${annexN}`;
      annexN += 1;
    } else {
      ch.numero = '';
    }
    ch.sections.forEach((s, i) => {
      s.numero = ch.numero ? `${ch.numero}.${i + 1}` : '';
    });
  }

  // --- clauses --------------------------------------------------------------
  const renderedIds = new Set();
  for (const ch of selected) {
    renderedIds.add(ch.id);
    for (const s of ch.sections) renderedIds.add(s.id);
  }

  const clauses = [];
  const seenClauseIds = new Set();
  const VALID_KINDS = ['clause', 'exclusion', 'premise', 'obligation', 'term'];
  for (const r of (sheet && sheet.content) || []) {
    const id = normText(r.id);
    const chapter_id = normText(r.chapter_id);
    const body = normText(r.body);
    if (!id && !body) continue;

    const kind = (normText(r.kind) || 'clause').toLowerCase();
    if (!VALID_KINDS.includes(kind)) { warnings.push(`Content tab: row '${id}' has unknown kind '${kind}', ignored`); continue; }
    const rowLang = normText(r.lang).toLowerCase();
    if (rowLang && rowLang !== lang) continue;
    if (!body) { warnings.push(`Content tab: row '${id}' has an empty body, ignored`); continue; }
    if (!knownIds.has(chapter_id)) { warnings.push(`Content tab: row '${id}' points at unknown chapter_id '${chapter_id}', ignored`); continue; }
    if (!matchesApplies(r.applies_when, ctx, warnings, `Content tab row '${id}'`)) continue;
    // A clause attached to a chapter this request does not render is not an error — the
    // client keeps clauses for scopes they are not selling today.
    if (!renderedIds.has(chapter_id)) continue;
    // A repeated id means the sheet (or whatever produced `sheet.content`) sent the same row
    // more than once — a spreadsheet paste mistake, or upstream duplication. `id` is documented
    // as stable and citable ("premise 7"), so two rows can never legitimately share one: keep the
    // first occurrence and warn, rather than printing a clause N times in a contract.
    if (id && seenClauseIds.has(id)) { warnings.push(`Content tab: duplicate id '${id}' — kept the first occurrence, ignored the repeat`); continue; }
    if (id) seenClauseIds.add(id);

    clauses.push({ kind, id, chapter_id, lang, title: normText(r.title), body, applies_when: normText(r.applies_when) });
  }

  return {
    source: sheet ? 'sheet' : 'catalog_default',
    sheet_id: sheet_id || null,
    tier: resolvedTier,
    language: lang,
    chapters: selected,
    clauses,
    rules,
    // The `Client` tab: Drive ids and document metadata that used to be Notion columns. The
    // caller merges it over the registry values, sheet first, so nothing breaks for a client
    // set up before this tab existed.
    client,
    templates,
    fields,
    // Cover/footer metadata. Both had no source at all before the `Client` tab — the version
    // silently defaulted to 1.0 and the version table's author column came out blank.
    version: normText(client.document_version) || '1.0',
    author: normText(client.author),
    // The COMPLETE catalog vocabulary, rendered or not. The render context needs it to stay
    // TOTAL: a superset template may reference any chapter, and the render node prints the
    // literal word "undefined" for a key that is missing (it exposes no nullGetter).
    all_keys: Array.from(knownIds),
    // Declared columns per table, for the same reason: the render context pads every row so a
    // {precio} cell in a template can never come out as "undefined" because one agent omitted it.
    table_columns: Object.fromEntries(
      Object.entries(catalog.tables || {}).map(([name, def]) => [name, Array.isArray(def.columns) ? def.columns : []])
    ),
    warnings,
  };
}
// === CHAPTER CATALOG CORE END ===

// Manual sanity check.
if (require.main === module) {
  const catalog = require('../../schemas/chapter-catalog.json');
  const problems = [];

  // 1. Every id is a valid Jexl identifier and unique. A '-' would be read as subtraction and
  //    an accent breaks the tag; both fail silently at render time, which is the worst way to
  //    find out.
  const seen = new Set();
  for (const id of collectIds(catalog)) {
    if (!/^[a-z][a-z0-9_]*$/.test(id)) problems.push(`id '${id}' is not a safe Jexl identifier`);
    if (seen.has(id)) problems.push(`duplicate id '${id}'`);
    seen.add(id);
  }

  // 2. Every table referenced by a chapter or section is declared in catalog.tables, and
  //    every declared table is referenced by something.
  const declared = new Set(Object.keys(catalog.tables || {}));
  const referenced = new Set();
  for (const group of ['front_matter', 'chapters', 'annexes']) {
    for (const ch of catalog[group] || []) {
      for (const t of ch.tables || []) referenced.add(t);
      for (const s of ch.sections || []) for (const t of s.tables || []) referenced.add(t);
    }
  }
  for (const t of referenced) if (!declared.has(t)) problems.push(`table '${t}' is used but not declared in catalog.tables`);
  for (const t of declared) if (!referenced.has(t)) problems.push(`table '${t}' is declared but never used`);
  for (const [name, def] of Object.entries(catalog.tables || {})) {
    for (const col of def.columns || []) {
      if (!/^[a-z][a-z0-9_]*$/.test(col)) problems.push(`table '${name}' column '${col}' is not a safe Jexl identifier`);
    }
  }

  // 3. Every scope item points at chapters that exist.
  const scopeCatalog = require('../../schemas/scope-catalog.json');
  for (const item of scopeCatalog.items) {
    for (const secId of item.sections || []) {
      if (!seen.has(secId)) problems.push(`scope item '${item.key}' points at unknown section '${secId}'`);
    }
  }

  // 4. Resolution behaves: tiers filter, scope gates, numbering has no gaps.
  const scope = { materials: true, engineering: true, installation: true, commissioning: true, warranty: true };
  const tierB = resolveProposalConfig({ catalog, sheet: null, tier: 'B', language: 'es', scope, has_pricing: true });
  const tierA = resolveProposalConfig({ catalog, sheet: null, tier: 'A', language: 'es', scope, has_pricing: true });
  const tierC = resolveProposalConfig({ catalog, sheet: null, tier: 'C', language: 'es', scope, has_pricing: true });

  const bodyOf = (cfg) => cfg.chapters.filter((c) => c.group === 'body');
  if (!(bodyOf(tierA).length < bodyOf(tierB).length && bodyOf(tierB).length <= bodyOf(tierC).length)) {
    problems.push(`tier sizes should grow A < B <= C, got ${bodyOf(tierA).length}/${bodyOf(tierB).length}/${bodyOf(tierC).length}`);
  }
  bodyOf(tierB).forEach((c, i) => {
    if (c.numero !== String(i + 1)) problems.push(`chapter numbering has a gap at '${c.id}': expected ${i + 1}, got ${c.numero}`);
  });
  if (tierA.chapters.some((c) => c.id === 'antecedentes')) problems.push("tier A should not include 'antecedentes'");
  if (!tierB.chapters.some((c) => c.id === 'continuidad_riesgos')) problems.push("tier B should include 'continuidad_riesgos'");
  if (tierB.chapters.some((c) => c.id === 'anexo_cumplimiento')) problems.push("'anexo_cumplimiento' is tier C only");

  // 5. Out-of-scope gating actually removes subsections.
  const noTraining = resolveProposalConfig({ catalog, sheet: null, tier: 'B', language: 'es', scope: { materials: true }, has_pricing: true });
  const ejec = noTraining.chapters.find((c) => c.id === 'ejecucion');
  if (ejec && ejec.sections.some((s) => s.id === 'ejecucion_formacion')) problems.push('training out of scope but ejecucion_formacion survived');

  // 6. No pricing -> the whole economic chapter goes.
  const noPrice = resolveProposalConfig({ catalog, sheet: null, tier: 'B', language: 'es', scope, has_pricing: false });
  if (noPrice.chapters.some((c) => c.id === 'oferta_economica')) problems.push('proposal_only should drop oferta_economica');

  // 7. A client sheet overrides selection, order, title — and applies_when filters clauses.
  const sheet = {
    chapters: [
      { chapter_id: 'antecedentes', include: 'no', order: '', title_es: '', title_en: '', tier: '' },
      { chapter_id: 'custom_1', include: 'yes', order: '15', title_es: 'Nuestra propuesta de valor', title_en: '', tier: '' },
      { chapter_id: 'solucion_tecnica', include: '', order: '', title_es: 'Ingeniería de la solución', title_en: '', tier: '' },
      { chapter_id: 'no_such_chapter', include: 'yes', order: '', title_es: '', title_en: '', tier: '' },
    ],
    content: [
      { kind: 'clause', id: 'gar_01', chapter_id: 'garantia_soporte_alcance', lang: 'es', applies_when: 'always', title: '', body: 'Garantía de 24 meses.' },
      { kind: 'exclusion', id: 'exc_01', chapter_id: 'limites_alcance_exclusiones', lang: 'es', applies_when: 'scope:installation', title: '', body: 'Obra civil.' },
      { kind: 'exclusion', id: 'exc_02', chapter_id: 'limites_alcance_exclusiones', lang: 'es', applies_when: 'scope:nonexistent_scope', title: '', body: 'No debe aplicar.' },
      { kind: 'clause', id: 'en_01', chapter_id: 'garantia_soporte_alcance', lang: 'en', applies_when: 'always', title: '', body: 'English clause.' },
      { kind: 'clause', id: 'bad_01', chapter_id: 'ni_idea', lang: 'es', applies_when: '', title: '', body: 'Huérfana.' },
    ],
    client: [
      { key: 'proposals_folder_id', value: 'folder_out' },
      { key: 'reference_docs_folder_id', value: 'folder_ref' },
      { key: 'document_version', value: '2.1' },
      { key: 'author', value: 'MBR' },
    ],
    templates: [
      { variant: 'default', lang: 'es', file_id: 'tpl_es', match: '', default: 'yes' },
      { variant: 'default', lang: 'en', file_id: 'tpl_en', match: '', default: 'yes' },
      { variant: 'retrofit', lang: 'es', file_id: 'tpl_retrofit_es', match: 'retrofit, modernización', default: '' },
      { variant: 'default', lang: 'es', file_id: 'tpl_dup', match: '', default: '' },
      { variant: 'broken', lang: 'es', file_id: '', match: 'nada', default: '' },
    ],
    fields: [
      { key: 'offer_no', source: 'request', value: '', capture_label: 'Oferta nº, Offer no', required: 'yes' },
      { key: 'issuer_name', source: 'static', value: 'Contoso Industrial S.L.', capture_label: '', required: 'yes' },
      { key: 'doc_version', source: 'auto', value: 'version', capture_label: '', required: '' },
      { key: 'Bad Key', source: 'static', value: 'x', capture_label: '', required: '' },
    ],
    rules: [
      { key: 'tone', value: 'técnico y sobrio' },
      { key: 'default_tier', value: 'C' },
      { key: 'forbidden_words', value: 'revolucionario, líder mundial' },
      { key: 'warranty_months', value: '24' },
      { key: 'term:cliente final', value: 'el Cliente' },
    ],
  };
  const withSheet = resolveProposalConfig({ catalog, sheet, language: 'es', scope, has_pricing: true, sheet_id: 'sheet123' });

  if (withSheet.tier !== 'C') problems.push(`default_tier from the sheet should win, got '${withSheet.tier}'`);
  if (withSheet.chapters.some((c) => c.id === 'antecedentes')) problems.push("sheet said include=no for 'antecedentes' but it survived");
  const custom = withSheet.chapters.find((c) => c.id === 'custom_1');
  if (!custom) problems.push('custom_1 should be included when the sheet says so');
  else {
    if (custom.title !== 'Nuestra propuesta de valor') problems.push('custom_1 title override not applied');
    if (custom.numero !== '2') problems.push(`custom_1 should be numbered 2 with order 15, got '${custom.numero}'`);
  }
  const sol = withSheet.chapters.find((c) => c.id === 'solucion_tecnica');
  if (!sol || sol.title !== 'Ingeniería de la solución') problems.push('solucion_tecnica rename not applied');
  if (withSheet.rules.forbidden_words.length !== 2) problems.push('forbidden_words should parse into a list');
  if (withSheet.rules.warranty_months !== 24) problems.push('warranty_months should parse as a number');
  if (withSheet.rules.terminology['cliente final'] !== 'el Cliente') problems.push('term: prefix should populate terminology');

  const clauseIds = withSheet.clauses.map((c) => c.id);
  if (!clauseIds.includes('gar_01')) problems.push('gar_01 should apply');
  if (!clauseIds.includes('exc_01')) problems.push('exc_01 should apply (installation is in scope)');
  if (clauseIds.includes('exc_02')) problems.push('exc_02 must not apply (scope not present)');
  if (clauseIds.includes('en_01')) problems.push('en_01 is English and must be filtered out of a Spanish proposal');
  if (clauseIds.includes('bad_01')) problems.push('bad_01 points at an unknown chapter and must be dropped');
  if (!withSheet.warnings.some((w) => w.includes('no_such_chapter'))) problems.push('an unknown chapter_id should raise a warning');
  if (!withSheet.warnings.some((w) => w.includes('ni_idea'))) problems.push('an orphan clause should raise a warning');

  // 7b. Duplicate rows (e.g. an n8n Sheets-read node accidentally executed more than once and
  // Content rows arrived twice) must not print a clause twice in a contract.
  const dupedSheet = { ...sheet, content: sheet.content.concat(sheet.content) };
  const deduped = resolveProposalConfig({ catalog, sheet: dupedSheet, language: 'es', scope, has_pricing: true });
  if (deduped.clauses.length !== withSheet.clauses.length) {
    problems.push(`duplicated Content rows should collapse to the same clause count (${withSheet.clauses.length}), got ${deduped.clauses.length}`);
  }
  if (!deduped.warnings.some((w) => w.includes("duplicate id 'gar_01'"))) problems.push('a duplicate clause id should raise a warning naming it');

  // 9. The `Client` tab supplies what used to be Notion columns, plus the two document values
  //    that previously had no source at all.
  if (withSheet.client.proposals_folder_id !== 'folder_out') problems.push('Client tab did not reach the resolved config');
  if (withSheet.version !== '2.1') problems.push(`document_version should come from the Client tab, got '${withSheet.version}'`);
  if (withSheet.author !== 'MBR') problems.push('author should come from the Client tab');

  // 10. `Fields` — the tab that makes a cover page client-specific without a deploy.
  const fieldKeys = withSheet.fields.map((f) => f.key);
  if (fieldKeys.join(',') !== 'offer_no,issuer_name,doc_version') problems.push(`unexpected field set: ${fieldKeys.join(',')}`);
  if (withSheet.fields[0].labels.length !== 2) problems.push('comma-separated capture labels should parse into alternatives');
  if (withSheet.fields[0].required !== true) problems.push('required flag not parsed');
  if (!withSheet.warnings.some((w) => w.includes("key 'bad key'"))) problems.push('an unsafe field key should raise a warning');

  // 11. `Templates` — selection order, and the registry fallback that keeps old clients working.
  if (withSheet.templates.length !== 3) problems.push(`expected 3 usable templates, got ${withSheet.templates.length}`);
  if (!withSheet.warnings.some((w) => w.includes('duplicate variant'))) problems.push('a duplicate variant should warn');
  if (!withSheet.warnings.some((w) => w.includes('no file_id'))) problems.push('a template row with no file_id should warn');

  const pick = (args) => selectTemplate({ templates: withSheet.templates, ...args });
  if (pick({ language: 'es' }).file_id !== 'tpl_es') problems.push('the language default should be picked when nothing else applies');
  if (pick({ language: 'en' }).file_id !== 'tpl_en') problems.push('English should pick the English default');
  if (pick({ language: 'es', variant: 'retrofit' }).file_id !== 'tpl_retrofit_es') problems.push('an explicitly requested variant should win');
  if (pick({ language: 'es', text: 'Asunto: modernización de inducciones' }).file_id !== 'tpl_retrofit_es') problems.push('a match keyword in the request text should select the variant');
  if (pick({ language: 'es', text: 'nothing relevant here' }).file_id !== 'tpl_es') problems.push('an unmatched request should fall back to the default');
  if (pick({ language: 'es', variant: 'retrofit', text: 'nothing' }).reason !== 'requested_variant') problems.push('an explicit variant should beat keyword matching');
  // A client with no Templates tab keeps behaving exactly as before this feature existed.
  const legacy = selectTemplate({ templates: [], language: 'es', fallback: { es: 'notion_es', en: 'notion_en' } });
  if (legacy.file_id !== 'notion_es' || legacy.reason !== 'registry_fallback') problems.push('the registry fallback must still work for a client with no Templates tab');
  const legacyEnOnly = selectTemplate({ templates: [], language: 'es', fallback: { es: '', en: 'notion_en' } });
  if (legacyEnOnly.file_id !== 'notion_en') problems.push('the EN fallback must still apply when there is no ES template');
  if (selectTemplate({ templates: [], language: 'es', fallback: {} }) !== null) problems.push('with nothing configured at all, selection must return null so the caller can fail loudly');

  // 8. all_keys is the whole vocabulary — this is what keeps the render context total.
  if (withSheet.all_keys.length !== seen.size) problems.push(`all_keys should carry every catalog id (${seen.size}), got ${withSheet.all_keys.length}`);

  console.log(`catalog: ${seen.size} render keys, ${declared.size} tables`);
  console.log(`tier A: ${bodyOf(tierA).length} chapters | tier B: ${bodyOf(tierB).length} | tier C: ${bodyOf(tierC).length} (+${tierC.chapters.filter((c) => c.group === 'annex').length} annexes)`);
  console.log(`tier B body: ${bodyOf(tierB).map((c) => `${c.numero}. ${c.title}`).join(' | ')}`);

  if (problems.length) {
    console.error(`\nFAIL:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nOK — catalog is well formed and resolution honours tier, scope, pricing and the client sheet.');
}

module.exports = { resolveProposalConfig, selectTemplate, buildTemplates, buildClientSettings, matchesApplies, buildRules, buildOverrides, collectIds, passesGates };
