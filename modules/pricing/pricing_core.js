// Cifral pricing core — the human-readable reference for the pricing formula.
//
// This is the SAME logic embedded in the n8n workflow
// `workflows/03-pricing-commercial-logic.json` ("Compute Pricing" node). It is plain
// JavaScript because the self-hosted n8n runs JS natively (no Python / Pyodide). If you
// change the formula, change it in both places — the region between the PRICING CORE markers
// is what the node runs.
//
// The pricing *data* (rate-per-category, margins, terms) is NOT here — it lives in each
// client's pricing Google Sheet in their Drive folder (see docs/PRICING-SHEET-TEMPLATE.md).
// This file owns only the *computation*, so it can be read and reasoned about outside n8n.
//
// Quick check:  node modules/pricing/pricing_core.js

// === PRICING CORE START ===
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Compute a phase-1 parametric quote.
 *
 *   subtotal = materialsCost + Σ hoursByCategory[c] * rateByCategory[c]
 *   total    = subtotal * (1 + riskPct) * (1 + marginPct) * (1 - discountPct)
 *
 * Percentages are fractions (0.15 === 15%). Money is rounded to 2 decimals.
 * Throws on negative / out-of-range inputs (fail loud, never a silent wrong quote).
 */
function computePricing({
  materialsCost,
  hoursByCategory,
  rateByCategory,
  marginPct,
  riskPct,
  discountPct,
  paymentTerms,
  currency = null,
}) {
  hoursByCategory = hoursByCategory ?? {};
  rateByCategory = rateByCategory ?? {};

  if (!isNumber(materialsCost) || materialsCost < 0) throw new Error('materials_cost must be a number >= 0');
  if (!isNumber(marginPct) || marginPct < 0) throw new Error('margin_pct must be a number >= 0');
  if (!isNumber(riskPct) || riskPct < 0) throw new Error('risk_pct must be a number >= 0');
  if (!isNumber(discountPct) || discountPct < 0 || discountPct > 1) throw new Error('discount_pct must be a number between 0 and 1');

  let labor = 0;
  for (const [category, hours] of Object.entries(hoursByCategory)) {
    if (!isNumber(hours) || hours < 0) throw new Error(`hours for '${category}' must be a number >= 0`);
    if (!Object.prototype.hasOwnProperty.call(rateByCategory, category)) throw new Error(`no rate configured for category '${category}'`);
    const rate = rateByCategory[category];
    if (!isNumber(rate) || rate < 0) throw new Error(`rate for '${category}' must be a number >= 0`);
    labor += hours * rate;
  }

  const subtotal = materialsCost + labor;
  const total = subtotal * (1 + riskPct) * (1 + marginPct) * (1 - discountPct);

  const result = {
    subtotal: roundMoney(subtotal),
    margin_pct: marginPct,
    risk_pct: riskPct,
    discount_pct: discountPct,
    total: roundMoney(total),
    payment_terms: paymentTerms,
  };
  if (currency) result.currency = currency;
  return result;
}
// === PRICING CORE END ===

// Manual sanity check against an inline sample rate card (the real numbers come from the
// client's Google Sheet in production).
if (require.main === module) {
  const out = computePricing({
    materialsCost: 1000,
    hoursByCategory: { engineering: 10, assembly: 20 },
    rateByCategory: { engineering: 85, assembly: 55 },
    marginPct: 0.2,
    riskPct: 0.08,
    discountPct: 0.0,
    paymentTerms: '30% advance / 40% on delivery / 30% on commissioning',
    currency: 'EUR',
  });
  console.log(JSON.stringify(out, null, 2));
}

module.exports = { computePricing, isNumber, roundMoney };
