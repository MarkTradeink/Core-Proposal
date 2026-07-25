// Cifral proposal render context — the human-readable reference for how a proposal's data is
// shaped before it is poured into the client's .docx template.
//
// This is the SAME logic embedded in the n8n workflow `workflows/04-proposal-assembly.json`
// ("Compute Proposal Fields" node). If you change it, change it in both places — the region
// between the PROPOSAL RENDER CORE markers is what the node runs. Same convention as
// modules/pricing/pricing_core.js.
//
// Why this exists: the old Module 4 poured pre-formatted TEXT into Google Docs placeholders, so a
// generated chapter inherited the styling of the token's paragraph — no real headings, bullets
// faked with a '•' character, prices as a bullet list. Real structure (headings, native lists,
// tables) cannot travel through a text placeholder. So Module 4 now emits STRUCTURED data and the
// .docx template owns the styling. See docs/TEMPLATE-GUIDE.md.
//
// Two constraints come from the render node (n8n-nodes-docxtemplater) and drive the design:
//
//   1. It does NOT expose docxtemplater's `nullGetter`, so a tag with no matching key renders the
//      literal text "undefined" into the customer's document. The context must therefore be
//      TOTAL: every key a template may reference always exists, empty rather than absent.
//   2. It replaces docxtemplater's parser with Jexl, which evaluates each tag as an expression.
//      So: no '-' in key names (Jexl reads it as subtraction), and loops must iterate arrays of
//      NAMED OBJECTS ([{texto: '…'}]) rather than arrays of bare strings.
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

// Narrative sections produced by Module 2, in document order.
const NARRATIVE_SECTIONS = [
  'alcance_tecnico',
  'resumen_comercial',
  'plan_implantacion',
  'repuestos',
  'transporte',
  'formacion',
  'garantia',
];

const BULLET_RE = /^[•‣◦⁃∙*\-–—]\s+/;

function pickLanguage(value) {
  return value === 'es' ? 'es' : 'en';
}

function labelFor(map, key, lang) {
  const entry = map[key];
  return (entry && entry[lang]) || key;
}

/**
 * Turn one of Module 2's plain-text sections into paragraphs and bullet lines.
 *
 * Module 2's system prompt pins the format: no markdown, paragraphs separated by a blank line,
 * list items as '•  item'. We parse that rather than asking the LLM for structured JSON —
 * it keeps the contract between modules unchanged, costs nothing, and can't drift at runtime.
 * The markdown stripping and the extra bullet characters are tolerance for LLM drift, not part
 * of the contract.
 *
 * Paragraphs and bullets are returned as two separate lists. Every section in the prompt is
 * either all paragraphs, all bullets, or an intro paragraph followed by bullets, so ordering
 * survives. If a model ever interleaves them, nothing is lost — the bullets simply group after
 * the paragraphs.
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

function textOf(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Build the docxtemplater render context for one proposal.
 *
 * Every key is always present (see the nullGetter note at the top of this file), so a template
 * that references a section which is out of scope renders nothing rather than "undefined".
 */
function buildRenderContext({ rfq, content, pricing, proposalNumber, fecha }) {
  rfq = rfq || {};
  content = content || {};

  const lang = pickLanguage(rfq.language);
  const client = rfq.client || {};
  const project = rfq.project || {};
  const scope = rfq.scope_of_supply || {};
  const reqs = Array.isArray(rfq.technical_requirements) ? rfq.technical_requirements : [];

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

  // Narrative sections. An out-of-scope section arrives empty from Module 2, so has_<key> is
  // false and the template's whole block — heading included — is dropped.
  const sections_rendered = [];
  for (const key of NARRATIVE_SECTIONS) {
    const parsed = parseNarrative(content[key]);
    const present = parsed.has_parrafos || parsed.has_bullets;
    context[key] = parsed;
    context[`has_${key}`] = present;
    if (present) sections_rendered.push(key);
  }

  // Economic section. Lines are the CUSTOMER-FACING sell prices (Module 3's sell_amount), which
  // sum exactly to the total.
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

  return { context, sections_rendered, language: lang };
}
// === PROPOSAL RENDER CORE END ===

// Manual sanity check. The invariant that matters most is TOTALITY: because the render node has no
// nullGetter, any key a template might reference must exist, or the customer's document says
// "undefined".
if (require.main === module) {
  const { context, sections_rendered, language } = buildRenderContext({
    proposalNumber: 'PROP-20260725-A1B2C3',
    fecha: '25/07/2026',
    rfq: {
      language: 'es',
      client: { company: 'Acme Foods', contact_name: 'Ana', contact_last_name: 'Ruiz', email: 'ana@acme.example' },
      project: { type: 'Línea de transporte', location: 'Zaragoza', desired_deadline: 'Q4 2026' },
      technical_requirements: [
        { item: 'Cinta transportadora', quantity: 2, spec: '10 m, 400 mm' },
        { item: 'Cuadro eléctrico', quantity: 1, spec: 'IP54' },
      ],
      scope_of_supply: { materials: true, engineering: true, installation: false, warranty: true },
    },
    content: {
      alcance_tecnico: 'Primer párrafo del alcance.\n\nSegundo párrafo con más detalle.',
      resumen_comercial: 'Intro comercial.\n\n•  Validez: 30 días\n•  Entrega: 8 semanas',
      garantia: 'Garantía estándar de fabricante.',
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

  console.log(JSON.stringify(context, null, 2));

  const problems = [];
  (function walk(node, path) {
    if (node === undefined) return problems.push(`${path} is undefined`);
    if (node === null) return problems.push(`${path} is null`);
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (typeof node === 'object') return Object.entries(node).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k));
  })(context, '');

  // Out-of-scope sections must be false-y flags with empty bodies, never missing keys.
  for (const key of NARRATIVE_SECTIONS) {
    if (!(key in context)) problems.push(`section '${key}' missing from context`);
    if (!(`has_${key}` in context)) problems.push(`flag 'has_${key}' missing from context`);
  }
  if (context.has_plan_implantacion !== false) problems.push('out-of-scope plan_implantacion should be flagged false');
  if (context.resumen_comercial.bullets.length !== 2) problems.push('resumen_comercial should yield 2 bullets');
  if (context.resumen_comercial.parrafos.length !== 1) problems.push('resumen_comercial should yield 1 paragraph');
  // Spanish puts the symbol last and uses a decimal comma. Note it does NOT group four-digit
  // amounts (CLDR minimumGroupingDigits=2 for es), so grouping only shows from five digits up —
  // check both so a future locale change can't silently pass.
  // Intl separates the amount from the symbol with a NON-BREAKING space (U+00A0) in es-ES. That is
  // correct typography and Word honours it — the literal below must keep the  , not a plain
  // space, or this check silently stops testing anything.
  if (context.pricing.lineas[0].importe !== '1296,00 €') problems.push(`es-ES 4-digit money wrong: ${JSON.stringify(context.pricing.lineas[0].importe)}`);
  if (formatMoney(12345.6, 'EUR', 'es') !== '12.345,60 €') problems.push(`es-ES grouping wrong: ${JSON.stringify(formatMoney(12345.6, 'EUR', 'es'))}`);
  if (formatMoney(12345.6, 'EUR', 'en') !== '€12,345.60') problems.push(`en-US money wrong: ${formatMoney(12345.6, 'EUR', 'en')}`);
  if (formatMoney(null, 'EUR', 'es') !== '') problems.push('null money should render empty, not "undefined"');
  if (formatMoney(100, 'NOTACODE', 'es') !== '100,00 NOTACODE') problems.push(`bad currency code should degrade: ${formatMoney(100, 'NOTACODE', 'es')}`);

  console.log(`\nlanguage: ${language}`);
  console.log(`sections rendered: ${sections_rendered.join(', ')}`);
  if (problems.length) {
    console.error(`\nFAIL:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nOK — context is total (no undefined/null leaves) and parses as expected.');
}

module.exports = { buildRenderContext, parseNarrative, formatMoney, formatNumber, NARRATIVE_SECTIONS, SCOPE_LABELS, COST_CATEGORY_LABELS };
