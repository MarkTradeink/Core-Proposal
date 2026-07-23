"""Cifral pricing engine (Module 3) — reference implementation of the pricing formula.

Phase-1 *parametric* pricing — intentionally simple. This module is the human-readable
SOURCE OF TRUTH for the pricing math that is embedded (via Pyodide) in the n8n workflow
``workflows/03-pricing-commercial-logic.json`` ("Compute Pricing" Code node). The region
between the ``PRICING CORE START`` / ``PRICING CORE END`` markers below is what that node runs.
If you change the formula, change it in both places.

The pricing *data* (rate-per-category, margins, terms) is NOT in this repo — it lives in each
client's pricing Google Sheet in their Drive folder (see ``docs/PRICING-SHEET-TEMPLATE.md``).
This file only owns the *computation*, so it can be read and reasoned about without opening n8n.

Non-goals (do NOT add): historical-hours estimation, pricing benchmarking, multi-tenant config.

Run ``python modules/pricing/pricing_engine.py`` for a quick manual sanity check against an
inline sample rate card.
"""
from __future__ import annotations

import json

# === PRICING CORE START ===
def compute_pricing(
    materials_cost,
    hours_by_category,
    rate_by_category,
    margin_pct,
    risk_pct,
    discount_pct,
    payment_terms,
    currency=None,
):
    """Compute a phase-1 parametric quote.

    subtotal = materials_cost + sum(hours_by_category[c] * rate_by_category[c])
    total    = subtotal * (1 + risk_pct) * (1 + margin_pct) * (1 - discount_pct)

    Percentages are fractions (0.15 == 15%). Money is rounded to 2 decimals.
    Raises ValueError on negative or out-of-range inputs (fail loud, never silently
    produce a wrong quote).
    """
    hours_by_category = hours_by_category or {}
    rate_by_category = rate_by_category or {}

    if not _is_number(materials_cost) or materials_cost < 0:
        raise ValueError("materials_cost must be a number >= 0")
    if not _is_number(margin_pct) or margin_pct < 0:
        raise ValueError("margin_pct must be a number >= 0")
    if not _is_number(risk_pct) or risk_pct < 0:
        raise ValueError("risk_pct must be a number >= 0")
    if not _is_number(discount_pct) or discount_pct < 0 or discount_pct > 1:
        raise ValueError("discount_pct must be a number between 0 and 1")

    labor = 0.0
    for category, hours in hours_by_category.items():
        if not _is_number(hours) or hours < 0:
            raise ValueError("hours for '%s' must be a number >= 0" % category)
        if category not in rate_by_category:
            raise ValueError("no rate configured for category '%s'" % category)
        rate = rate_by_category[category]
        if not _is_number(rate) or rate < 0:
            raise ValueError("rate for '%s' must be a number >= 0" % category)
        labor += hours * rate

    subtotal = float(materials_cost) + labor
    total = subtotal * (1 + risk_pct) * (1 + margin_pct) * (1 - discount_pct)

    result = {
        "subtotal": round(subtotal, 2),
        "margin_pct": margin_pct,
        "risk_pct": risk_pct,
        "discount_pct": discount_pct,
        "total": round(total, 2),
        "payment_terms": payment_terms,
    }
    if currency:
        result["currency"] = currency
    return result


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)
# === PRICING CORE END ===


def price_from_config(inputs, client_config):
    """Convenience wrapper: pull the rate card out of a client config object and price.

    ``client_config`` may be the full config (with a ``rate_card`` key) or the rate card
    itself. ``inputs`` carries ``materials_cost`` and ``hours_by_category``.
    """
    rate_card = client_config.get("rate_card", client_config)
    return compute_pricing(
        materials_cost=inputs.get("materials_cost", 0),
        hours_by_category=inputs.get("hours_by_category", {}),
        rate_by_category=rate_card.get("rate_by_category", {}),
        margin_pct=rate_card.get("margin_pct", 0),
        risk_pct=rate_card.get("risk_pct", 0),
        discount_pct=rate_card.get("discount_pct", 0),
        payment_terms=rate_card.get("payment_terms", ""),
        currency=rate_card.get("currency"),
    )


if __name__ == "__main__":
    # Manual sanity check: price a sample RFQ against an inline sample rate card.
    # (In production the rate card comes from the client's pricing Google Sheet, not from here.)
    sample_rate_card = {
        "rate_card": {
            "rate_by_category": {
                "engineering": 85,
                "assembly": 55,
                "commissioning": 70,
                "project_management": 95,
            },
            "margin_pct": 0.20,
            "risk_pct": 0.08,
            "discount_pct": 0.0,
            "payment_terms": "30% advance / 40% on delivery / 30% on commissioning",
            "currency": "EUR",
        }
    }
    sample_inputs = {
        "materials_cost": 1000,
        "hours_by_category": {"engineering": 10, "assembly": 20},
    }
    print(json.dumps(price_from_config(sample_inputs, sample_rate_card), indent=2))
