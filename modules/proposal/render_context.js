// Cifral proposal render context — the human-readable reference for how a proposal's data is
// shaped before it is poured into the client's .docx template.
//
// This is the SAME logic embedded in the n8n workflow `workflows/04-proposal-assembly.json`
// ("Compute Proposal Fields" node). If you change it, change it in both places — the region
// between the PROPOSAL RENDER CORE markers is what the node runs. Same convention as
// modules/pricing/pricing_core.js and modules/proposal/chapter_catalog.js.
//
// Why this exists: the old Module 4 poured pre-formatted TEXT into Google Docs placeholders, so a
// generated chapter inherited the styling of the token's paragraph — no real headings, bullets
// faked with a '•' character, prices as a bullet list. Real structure (headings, native lists,
// tables) cannot travel through a text placeholder. So Module 4 emits STRUCTURED data and the
// .docx template owns the styling. See docs/TEMPLATE-GUIDE.md.
//
// Two constraints come from the render node (n8n-nodes-docxtemplater) and drive the design:
//
//   1. It does NOT expose docxtemplater's `nullGetter`, so a tag with no matching key renders the
//      literal text "undefined" into the customer's document. The context must therefore be
//      TOTAL: every key a template may reference always exists, empty rather than absent. That
//      is why the context is built from `proposal_config.all_keys` — the WHOLE catalog
//      vocabulary — and not from the chapters this particular request happens to render.
//   2. It replaces docxtemplater's parser with Jexl, which evaluates each tag as an expression.
//      So: no '-' in key names (Jexl reads it as subtraction), and loops must iterate arrays of
//      NAMED OBJECTS ([{texto: '…'}]) rather than arrays of bare strings.
//
// Where content comes from, and why boilerplate does not pass through the LLM:
//
//   generated   Module 2's A1/A2/A3 agents -> content.sections[<id>]
//   boilerplate The client's Proposal Config sheet -> proposal_config.clauses, merged in HERE
//   calculated  RFQ + Module 3 pricing -> computed below
//
// Contract text (warranty, general terms, exclusions, client obligations) travels from the
// client's spreadsheet to the paper without an LLM anywhere in between. Module 2's QA agent sees
// it as read-only context and is not allowed to patch it. That is deliberate: an invented
// liability clause costs more than a bland one.
//
// Quick check:  node modules/proposal/render_context.js

// === PROPOSAL RENDER CORE START ===

// Scope-of-supply labels — source of truth: schemas/scope-catalog.json.
const SCOPE_LABELS = {
  materials: { en: 'Materials & Equipment Supply', es: 'Suministro de materiales y equipos' },
  engineering: { en: 'Engineering & Design', es: 'Ingeniería y diseño' },
  installation: { en: 'Installation / Assembly', es: 'Instalación / Montaje' },
  commissioning: { en: 'Commissioning & Start-up', es: 'Puesta en marcha' },
  project_management: { en: 'Project Management', es: 'Gestión de proyecto' },
  spare_parts: { en: 'Spare Parts', es: 'Repuestos' },
  shipping: { en: 'Shipping & Logistics', es: 'Transporte y logística' },
  training: { en: 'Training', es: 'Formación' },
  warranty: { en: 'Warranty', es: 'Garantía' },
};
const SCOPE_ORDER = Object.keys(SCOPE_LABELS);

// Pricing line labels. These are COST categories (Module 3 / the client's rate card), which are
// not quite scope keys — the rate card calls on-site labour 'assembly' where the scope calls it
// 'installation'.
const COST_CATEGORY_LABELS = {
  materials: { en: 'Materials & Equipment', es: 'Materiales y equipos' },
  engineering: { en: 'Engineering & Design', es: 'Ingeniería y diseño' },
  assembly: { en: 'Installation / Assembly', es: 'Instalación / Montaje' },
  commissioning: { en: 'Commissioning & Start-up', es: 'Puesta en marcha' },
  project_management: { en: 'Project Management', es: 'Gestión de proyecto' },
  training: { en: 'Training', es: 'Formación' },
};

// Boilerplate `kind`s that become numbered table rows instead of prose, and where they land.
// Source: the client's Proposal Config sheet, tab 'Content'.
const CLAUSE_TABLES = {
  exclusion: { table: 'tabla_exclusiones', column: 'exclusion' },
  premise: { table: 'tabla_premisas', column: 'premisa' },
  obligation: { table: 'tabla_obligaciones', column: 'obligacion' },
};

// Chapters whose content is the price table itself rather than a text section. They have no
// entry in content.sections and no clause, so the "empty means gone" rule would drop them even
// though Module 3 produced a price. Presence follows the pricing payload instead.
const PRICING_DRIVEN = ['oferta_economica', 'oferta_economica_resumen', 'oferta_economica_pago', 'resumen_ejecutivo_economico'];

const BULLET_RE = /^[•‣◦⁃∙*\-–—]\s+/;

function pickLanguage(value) {
  return value === 'es' ? 'es' : 'en';
}

function labelFor(map, key, lang) {
  const entry = map[key];
  return (entry && entry[lang]) || key;
}

function textOf(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Turn a plain-text section into paragraphs and bullet lines.
 *
 * Module 2's system prompts pin the format: no markdown, paragraphs separated by a blank line,
 * list items as '•  item'. Clause bodies from the client's sheet use the same convention, so
 * generated text and boilerplate go through this one function and come out indistinguishable —
 * the template has no idea which is which, which is the point.
 *
 * Paragraphs and bullets are returned as two separate lists. Every section is either all
 * paragraphs, all bullets, or an intro paragraph followed by bullets, so ordering survives. If a
 * model ever interleaves them, nothing is lost — the bullets simply group after the paragraphs.
 */
function parseNarrative(raw) {
  const text = (raw == null ? '' : String(raw)).replace(/\r\n/g, '\n').trim();
  const parrafos = [];
  const bullets = [];

  for (const block of text.split(/\n\s*\n/)) {
    let buffer = [];
    const flush = () => {
      if (buffer.length) parrafos.push({ texto: buffer.join(' ') });
      buffer = [];
    };
    for (const rawLine of block.split('\n')) {
      const line = cleanInline(rawLine);
      if (!line) continue;
      if (BULLET_RE.test(line)) {
        flush();
        const item = line.replace(BULLET_RE, '').trim();
        if (item) bullets.push({ texto: item });
      } else {
        buffer.push(line);
      }
    }
    flush();
  }

  return {
    parrafos,
    bullets,
    has_parrafos: parrafos.length > 0,
    has_bullets: bullets.length > 0,
  };
}

// Module 2 is told to emit plain text. Strip markdown emphasis / heading marks anyway so a drifting
// model can never put a literal '**' or '#' in front of a customer.
function cleanInline(line) {
  return String(line)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .trim();
}

function formatMoney(value, currency, lang) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '';
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
    } catch (e) {
      // Unknown/invalid ISO code — fall through to a plain number plus the raw code.
    }
  }
  const plain = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return currency ? `${plain} ${currency}` : plain;
}

function formatNumber(value, lang) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: 2 }).format(n);
}

// An empty section object. Every catalog id gets one of these before anything is populated, so a
// superset template can reference a chapter this request does not render without printing
// "undefined".
function emptySection() {
  return { titulo: '', numero: '', parrafos: [], bullets: [], has_parrafos: false, has_bullets: false };
}

/**
 * Build the docxtemplater render context for one proposal.
 *
 * `proposalConfig` is the resolved per-client configuration (schemas/proposal-config.schema.json)
 * produced by modules/proposal/chapter_catalog.js. When it is absent the context still comes out
 * total — it simply has no chapters, which is what a Module 4 run with no configuration should
 * honestly produce rather than guessing a structure.
 */
function buildRenderContext({ rfq, content, pricing, proposalConfig, proposalNumber, fecha }) {
  rfq = rfq || {};
  content = content || {};
  const cfg = proposalConfig || {};

  const lang = pickLanguage(cfg.language || rfq.language);
  const client = rfq.client || {};
  const project = rfq.project || {};
  const scope = rfq.scope_of_supply || {};
  const reqs = Array.isArray(rfq.technical_requirements) ? rfq.technical_requirements : [];

  // Module 2 emits { sections, tables }. Tolerate a bare map of id -> text as well, so a hand-run
  // of Module 4 with a scratch payload still works.
  const sections = (content && content.sections) || content || {};
  const genTables = (content && content.tables) || {};

  // B1: the extractor's key is 'quantity'; the legacy demo read 'qty' and silently dropped it.
  const requisitos = reqs.map((r) => ({
    item: textOf(r && r.item),
    cantidad: r && r.quantity != null ? formatNumber(r.quantity, lang) : '',
    spec: textOf(r && r.spec),
  }));

  const incluido = SCOPE_ORDER.filter((k) => scope[k] === true).map((k) => ({ etiqueta: labelFor(SCOPE_LABELS, k, lang) }));
  const excluido = SCOPE_ORDER.filter((k) => scope[k] === false).map((k) => ({ etiqueta: labelFor(SCOPE_LABELS, k, lang) }));

  const context = {
    numero_propuesta: textOf(proposalNumber),
    fecha: textOf(fecha),
    idioma: lang,
    documento: {
      tier: textOf(cfg.tier) || 'B',
      version: textOf(cfg.version) || '1.0',
      config_source: textOf(cfg.source) || 'catalog_default',
    },

    cliente: {
      empresa: textOf(client.company),
      contacto: [client.contact_name, client.contact_last_name].filter(Boolean).join(' ').trim(),
      email: textOf(client.email),
      telefono: textOf(client.phone),
    },
    proyecto: {
      tipo: textOf(project.type),
      ubicacion: textOf(project.location),
      plazo: textOf(project.desired_deadline),
    },

    requisitos,
    has_requisitos: requisitos.length > 0,

    alcance_incluido: incluido,
    alcance_excluido: excluido,
    has_alcance_incluido: incluido.length > 0,
    has_alcance_excluido: excluido.length > 0,
  };

  // --- totality -------------------------------------------------------------
  // Every id in the catalog gets an empty section and a false flag FIRST. Chapters this request
  // renders then overwrite them. This is the single invariant the whole design rests on.
  const allKeys = Array.isArray(cfg.all_keys) ? cfg.all_keys : [];
  for (const key of allKeys) {
    context[key] = emptySection();
    context[`has_${key}`] = false;
  }

  const tableColumns = cfg.table_columns || {};
  const tableRows = {};
  const ensureTable = (name) => {
    if (!tableRows[name]) tableRows[name] = [];
    return tableRows[name];
  };
  for (const name of Object.keys(tableColumns)) ensureTable(name);

  // --- boilerplate from the client's sheet ----------------------------------
  // Prose clauses are keyed by the chapter/section they attach to; numbered kinds become table
  // rows. Nothing here has been near a language model.
  const proseByKey = {};
  const clauses = Array.isArray(cfg.clauses) ? cfg.clauses : [];
  const clausesApplied = [];
  for (const c of clauses) {
    if (!c || !c.chapter_id || !c.body) continue;
    clausesApplied.push(c.id);
    const spec = CLAUSE_TABLES[c.kind];
    if (spec) {
      const rows = ensureTable(spec.table);
      rows.push({ numero: String(rows.length + 1), [spec.column]: textOf(c.body) });
    } else if (c.kind === 'term') {
      ensureTable('tabla_glosario').push({ termino: textOf(c.title), definicion: textOf(c.body) });
    } else {
      const lead = textOf(c.title);
      const body = textOf(c.body);
      proseByKey[c.chapter_id] = [proseByKey[c.chapter_id], lead, body].filter(Boolean).join('\n\n');
    }
  }

  // --- chapters this request renders ----------------------------------------
  // Pass 1: parse content and decide what is actually present. A chapter can be selected by the
  // catalog and still come out empty — the agent had nothing to say, or the client's sheet has no
  // clause for it — and an empty heading is worse than no heading.
  const fill = (entry) => {
    const key = entry.id;
    // A chapter the sheet enabled but the catalog does not know cannot be rendered — the
    // template has no block for it. chapter_catalog.js already warned about it.
    if (!(key in context)) return null;

    const merged = [textOf(sections[key]), proseByKey[key]].filter(Boolean).join('\n\n');
    const parsed = parseNarrative(merged);

    let hasTable = false;
    for (const t of entry.tables || []) {
      const incoming = Array.isArray(genTables[t]) ? genTables[t] : [];
      const rows = ensureTable(t);
      for (const row of incoming) rows.push(row);
      if (rows.length) hasTable = true;
    }

    context[key] = {
      titulo: textOf(entry.title),
      numero: '',
      parrafos: parsed.parrafos,
      bullets: parsed.bullets,
      has_parrafos: parsed.has_parrafos,
      has_bullets: parsed.has_bullets,
    };
    const priced = !!pricing && PRICING_DRIVEN.includes(key);
    return { entry, own: parsed.has_parrafos || parsed.has_bullets || hasTable || priced };
  };

  const plan = [];
  for (const chapter of cfg.chapters || []) {
    const head = fill(chapter);
    if (!head) continue;
    const kids = [];
    for (const section of chapter.sections || []) {
      const kid = fill(section);
      if (kid && kid.own) kids.push(kid);
    }
    // A container chapter survives on its children alone — dropping it would orphan them.
    if (head.own || kids.length) plan.push({ head, kids });
  }

  // Pass 2: number what survived. Doing this here rather than at resolve time is what keeps the
  // numbering gapless — chapter_catalog.js cannot know which chapters will come back empty, so a
  // number assigned there would leave holes like "5.2" with no "5.1".
  const sections_rendered = [];
  const indice = [];
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let bodyN = 0;
  let annexN = 0;

  for (const { head, kids } of plan) {
    const key = head.entry.id;
    let numero = '';
    if (head.entry.group === 'body') numero = String((bodyN += 1));
    else if (head.entry.group === 'annex') { numero = ALPHA[annexN] || `A${annexN}`; annexN += 1; }

    context[key].numero = numero;
    context[`has_${key}`] = true;
    sections_rendered.push(key);
    indice.push({ numero, titulo: context[key].titulo, nivel: '1' });

    kids.forEach((kid, i) => {
      const sub = numero ? `${numero}.${i + 1}` : '';
      context[kid.entry.id].numero = sub;
      context[`has_${kid.entry.id}`] = true;
      sections_rendered.push(kid.entry.id);
      indice.push({ numero: sub, titulo: context[kid.entry.id].titulo, nivel: '2' });
    });
  }

  // --- tables ---------------------------------------------------------------
  // Rows are padded to their declared columns so a {precio} cell cannot come out as "undefined"
  // because one agent omitted the field.
  for (const [name, rows] of Object.entries(tableRows)) {
    const cols = tableColumns[name] || (rows.length ? Object.keys(rows[0]) : []);
    context[name] = rows.map((row) => {
      const out = {};
      for (const col of cols) out[col] = textOf(row && row[col]);
      return out;
    });
    context[`has_${name}`] = context[name].length > 0;
  }

  context.indice = indice;
  context.has_indice = indice.length > 0;
  context.tabla_indice = indice;
  context.has_tabla_indice = indice.length > 0;

  // --- economic section -----------------------------------------------------
  // Lines are the CUSTOMER-FACING sell prices (Module 3's sell_amount), which sum exactly to the
  // total.
  //
  // The internal `subtotal` is deliberately NOT exposed here. It is the pre-margin cost basis, and
  // this document is forwarded by the reseller to their own end customer — printing the cost basis
  // beside the total hands the customer the reseller's margin. The reseller still sees the subtotal
  // in the quote email the orchestrator sends them.
  const cur = (pricing && pricing.currency) || '';
  const lineasSrc = pricing && Array.isArray(pricing.lines) ? pricing.lines : [];
  const lineas = lineasSrc.map((l) => ({
    concepto: labelFor(COST_CATEGORY_LABELS, l && l.category, lang),
    cantidad: l && l.hours != null ? formatNumber(l.hours, lang) : '',
    precio_unitario: l && l.rate != null ? formatMoney(l.rate, cur, lang) : '',
    importe: formatMoney(l && (l.sell_amount != null ? l.sell_amount : l.amount), cur, lang),
  }));

  context.has_pricing = !!pricing;
  context.pricing = {
    lineas,
    has_lineas: lineas.length > 0,
    total: pricing ? formatMoney(pricing.total, cur, lang) : '',
    condiciones_pago: pricing ? textOf(pricing.payment_terms) : '',
    moneda: cur,
  };
  if (pricing) sections_rendered.push('economic');

  return { context, sections_rendered, language: lang, clauses_applied: clausesApplied };
}
// === PROPOSAL RENDER CORE END ===

// Manual sanity check. The invariant that matters most is TOTALITY: because the render node has no
// nullGetter, any key a template might reference must exist, or the customer's document says
// "undefined".
if (require.main === module) {
  const { resolveProposalConfig } = require('./chapter_catalog');
  const catalog = require('../../schemas/chapter-catalog.json');

  const scope = { materials: true, engineering: true, installation: true, commissioning: false, warranty: true, training: false };

  const proposalConfig = resolveProposalConfig({
    catalog,
    sheet: {
      chapters: [{ chapter_id: 'solucion_tecnica', include: '', order: '', title_es: 'Ingeniería de la solución', title_en: '', tier: '' }],
      content: [
        { kind: 'clause', id: 'gar_01', chapter_id: 'garantia_soporte_alcance', lang: 'es', applies_when: 'always', title: '', body: 'Garantía de 24 meses desde la aceptación final.' },
        { kind: 'exclusion', id: 'exc_01', chapter_id: 'limites_alcance_exclusiones', lang: 'es', applies_when: 'always', title: '', body: 'Obra civil de cualquier tipo.' },
        { kind: 'exclusion', id: 'exc_02', chapter_id: 'limites_alcance_exclusiones', lang: 'es', applies_when: 'scope:installation', title: '', body: 'Retirada de equipos desmontados.' },
        { kind: 'premise', id: 'pre_01', chapter_id: 'limites_alcance_premisas', lang: 'es', applies_when: 'always', title: '', body: 'Los planos facilitados reflejan la instalación actual.' },
        { kind: 'obligation', id: 'obl_01', chapter_id: 'condiciones_sitio_obligaciones', lang: 'es', applies_when: 'always', title: '', body: 'Facilitar acceso al área de trabajo.' },
      ],
      rules: [{ key: 'default_tier', value: 'B' }],
    },
    language: 'es',
    scope,
    has_pricing: true,
    sheet_id: 'sheet123',
  });

  const { context, sections_rendered, language, clauses_applied } = buildRenderContext({
    proposalConfig,
    proposalNumber: 'PROP-20260725-A1B2C3',
    fecha: '25/07/2026',
    rfq: {
      language: 'es',
      client: { company: 'Acme Foods', contact_name: 'Ana', contact_last_name: 'Ruiz', email: 'ana@acme.example', phone: '+34 600 000 000' },
      project: { type: 'Línea de transporte', location: 'Zaragoza', desired_deadline: 'Q4 2026' },
      technical_requirements: [
        { item: 'Cinta transportadora', quantity: 2, spec: '10 m, 400 mm' },
        { item: 'Cuadro eléctrico', quantity: 1, spec: 'IP54' },
      ],
      scope_of_supply: scope,
    },
    content: {
      sections: {
        resumen_ejecutivo_necesidad: 'La instalación actual acumula 12 años de servicio.',
        solucion_tecnica_arquitectura: 'Primer párrafo de arquitectura.\n\nSegundo párrafo con más detalle.',
        alcance_suministro_hardware: 'Intro del suministro.\n\n•  Variadores de frecuencia\n•  Cableado de potencia',
        ejecucion_fases: 'Las fases previstas son las siguientes.',
        ejecucion_instalacion: 'El montaje se ejecuta en horario nocturno.',
      },
      tables: {
        tabla_materiales: [
          { posicion: '1', descripcion: 'Variador de frecuencia', cantidad: '15' },
          { posicion: '2', descripcion: 'Armario eléctrico', cantidad: '3', observaciones: 'IP54' },
        ],
        tabla_fases: [{ fase: 'Ingeniería', descripcion: 'Diseño de detalle', duracion: '6 semanas', entregable: 'Planos as-built' }],
      },
    },
    pricing: {
      currency: 'EUR',
      total: 3823.2,
      payment_terms: '30% / 40% / 30%',
      lines: [
        { category: 'materials', hours: null, rate: null, amount: 1000, sell_amount: 1296 },
        { category: 'engineering', hours: 10, rate: 85, amount: 850, sell_amount: 1101.6 },
        { category: 'assembly', hours: 20, rate: 55, amount: 1100, sell_amount: 1425.6 },
      ],
    },
  });

  const problems = [];
  (function walk(node, path) {
    if (node === undefined) return problems.push(`${path} is undefined`);
    if (node === null) return problems.push(`${path} is null`);
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (typeof node === 'object') return Object.entries(node).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k));
  })(context, '');

  // TOTALITY — the whole catalog vocabulary is addressable, including chapters this tier drops.
  for (const key of proposalConfig.all_keys) {
    if (!(key in context)) problems.push(`section '${key}' missing from context`);
    if (!(`has_${key}` in context)) problems.push(`flag 'has_${key}' missing from context`);
  }
  for (const name of Object.keys(proposalConfig.table_columns)) {
    if (!(name in context)) problems.push(`table '${name}' missing from context`);
    if (!(`has_${name}` in context)) problems.push(`flag 'has_${name}' missing from context`);
  }

  // Tier B drops the tier-C-only subsection, heading and all.
  if (context.has_solucion_tecnica_alternativas !== false) problems.push('tier C subsection should be absent at tier B');
  if (context.solucion_tecnica_alternativas.titulo !== '') problems.push('an unrendered section must have an empty title, not a stale one');
  // Out-of-scope subsections go too.
  if (context.has_ejecucion_formacion !== false) problems.push('training is out of scope; ejecucion_formacion should be false');
  if (context.has_ejecucion_puesta_marcha !== false) problems.push('commissioning is out of scope; ejecucion_puesta_marcha should be false');
  if (context.has_ejecucion_instalacion !== true) problems.push('installation IS in scope; ejecucion_instalacion should be true');

  // Titles: the client sheet renames a chapter, the catalog supplies the rest.
  if (context.solucion_tecnica.titulo !== 'Ingeniería de la solución') problems.push(`sheet rename lost: ${context.solucion_tecnica.titulo}`);
  if (context.alcance_suministro.titulo !== 'Alcance de suministro') problems.push('catalog title lost');
  // Numbering is gapless over what actually printed. Here `bases_oferta` and `antecedentes` came
  // back empty (no agent text, no clause), so the technical chapter is 2 and not 4 — which is the
  // whole point: the reader never sees a jump from 1 to 4.
  if (context.solucion_tecnica.numero !== '2') problems.push(`chapter number wrong: ${context.solucion_tecnica.numero}`);
  if (context.solucion_tecnica_arquitectura.numero !== '2.1') problems.push(`section number wrong: ${context.solucion_tecnica_arquitectura.numero}`);
  if (context.has_bases_oferta !== false) problems.push('a chapter with no content at all should be dropped, heading included');
  const topNums = context.indice.filter((e) => e.nivel === '1').map((e) => e.numero);
  if (topNums.join(',') !== topNums.map((_, i) => String(i + 1)).join(',')) problems.push(`chapter numbering has gaps: ${topNums.join(',')}`);
  for (const e of context.indice.filter((x) => x.nivel === '2')) {
    const [parent] = e.numero.split('.');
    if (!topNums.includes(parent)) problems.push(`subsection ${e.numero} has no parent chapter`);
  }

  // Parsing: prose and bullets survive the round trip.
  if (context.solucion_tecnica_arquitectura.parrafos.length !== 2) problems.push('arquitectura should yield 2 paragraphs');
  if (context.alcance_suministro_hardware.bullets.length !== 2) problems.push('hardware should yield 2 bullets');
  if (context.alcance_suministro_hardware.parrafos.length !== 1) problems.push('hardware should yield 1 intro paragraph');

  // Boilerplate reached the document without passing through an agent.
  if (!context.garantia_soporte_alcance.parrafos.some((p) => p.texto.includes('24 meses'))) problems.push('warranty clause from the sheet did not reach the context');
  if (context.tabla_exclusiones.length !== 2) problems.push(`expected 2 exclusions, got ${context.tabla_exclusiones.length}`);
  if (context.tabla_exclusiones[0].numero !== '1' || context.tabla_exclusiones[1].numero !== '2') problems.push('exclusions must be numbered 1..n');
  if (context.tabla_premisas.length !== 1) problems.push('expected 1 premise');
  if (context.tabla_obligaciones.length !== 1) problems.push('expected 1 client obligation');
  if (clauses_applied.length !== 5) problems.push(`clauses_applied should list all 5 snippets, got ${clauses_applied.length}`);

  // Tables are padded to their declared columns — no "undefined" cells.
  if (context.tabla_materiales.length !== 2) problems.push('tabla_materiales should have 2 rows');
  if (context.tabla_materiales[0].observaciones !== '') problems.push('a missing table cell must render empty, not "undefined"');
  if (!('entregable' in context.tabla_fases[0])) problems.push('table rows must carry every declared column');
  if (context.has_tabla_riesgos !== false) problems.push('an unused table must be present and flagged false');

  // Index is built from what actually rendered, so it can never disagree with the document.
  if (context.has_oferta_economica !== true) problems.push('a priced request must render the economic chapter even though its body is a table');
  if (context.has_oferta_economica_resumen !== true) problems.push('the price summary section must render when there is pricing');
  if (!context.indice.length) problems.push('indice should not be empty');
  if (context.indice[0].numero !== '1') problems.push('indice should start at chapter 1');
  const idxIds = context.indice.map((e) => e.titulo);
  if (idxIds.includes('Alternativas evaluadas y justificación')) problems.push('indice must not list a section that was dropped');

  // Money formatting, unchanged from Phase 11.
  // Spanish puts the symbol last and uses a decimal comma. Note it does NOT group four-digit
  // amounts (CLDR minimumGroupingDigits=2 for es), so grouping only shows from five digits up —
  // check both so a future locale change can't silently pass.
  // Intl separates the amount from the symbol with a NON-BREAKING space (U+00A0) in es-ES. That is
  // correct typography and Word honours it — the literal below must keep the  , not a plain
  // space, or this check silently stops testing anything.
  if (context.pricing.lineas[0].importe !== '1296,00\u00a0\u20ac') problems.push(`es-ES 4-digit money wrong: ${JSON.stringify(context.pricing.lineas[0].importe)}`);
  if (formatMoney(12345.6, 'EUR', 'es') !== '12.345,60\u00a0\u20ac') problems.push(`es-ES grouping wrong: ${JSON.stringify(formatMoney(12345.6, 'EUR', 'es'))}`);
  if (formatMoney(12345.6, 'EUR', 'en') !== '\u20ac12,345.60') problems.push(`en-US money wrong: ${formatMoney(12345.6, 'EUR', 'en')}`);
  if (formatMoney(null, 'EUR', 'es') !== '') problems.push('null money should render empty, not "undefined"');
  if (formatMoney(100, 'NOTACODE', 'es') !== '100,00 NOTACODE') problems.push(`bad currency code should degrade: ${formatMoney(100, 'NOTACODE', 'es')}`);

  // A run with no configuration at all must still be total, not crash.
  const bare = buildRenderContext({ rfq: { language: 'en' }, content: {}, pricing: null, proposalNumber: 'X', fecha: 'Y' });
  if (bare.context.has_pricing !== false) problems.push('a config-less run should still produce a total context');

  console.log(`language: ${language} | tier: ${context.documento.tier} | config: ${context.documento.config_source}`);
  console.log(`context keys: ${Object.keys(context).length}`);
  console.log(`sections rendered (${sections_rendered.length}): ${sections_rendered.slice(0, 12).join(', ')}…`);
  console.log(`index:\n${context.indice.map((e) => `  ${e.nivel === '1' ? '' : '   '}${e.numero}. ${e.titulo}`).join('\n')}`);

  if (problems.length) {
    console.error(`\nFAIL:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nOK — context is total (no undefined/null leaves), tier and scope gating work, and boilerplate reaches the document without an LLM.');
}

module.exports = { buildRenderContext, parseNarrative, formatMoney, formatNumber, SCOPE_LABELS, COST_CATEGORY_LABELS, CLAUSE_TABLES };
