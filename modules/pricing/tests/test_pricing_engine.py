"""Unit tests for the pricing engine (Module 3).

Covers: a normal case, zero-risk / zero-discount edges, negative-input rejection,
missing-rate rejection, and rounding. Stdlib + pytest only.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pricing_engine import compute_pricing, price_from_config  # noqa: E402


def test_normal_case():
    # materials 1000 + (10*85 + 20*55) = 1000 + 1950 = 2950 subtotal
    # total = 2950 * 1.08 * 1.20 * 1.0 = 3823.20
    result = compute_pricing(
        materials_cost=1000,
        hours_by_category={"engineering": 10, "assembly": 20},
        rate_by_category={"engineering": 85, "assembly": 55},
        margin_pct=0.20,
        risk_pct=0.08,
        discount_pct=0.0,
        payment_terms="30/40/30",
    )
    assert result["subtotal"] == 2950.0
    assert result["total"] == 3823.20
    assert result["payment_terms"] == "30/40/30"
    assert result["margin_pct"] == 0.20


def test_zero_risk_and_zero_discount():
    # subtotal 500, only margin applies: 500 * 1.0 * 1.10 * 1.0 = 550.0
    result = compute_pricing(
        materials_cost=500,
        hours_by_category={},
        rate_by_category={},
        margin_pct=0.10,
        risk_pct=0.0,
        discount_pct=0.0,
        payment_terms="net 30",
    )
    assert result["subtotal"] == 500.0
    assert result["total"] == 550.0
    assert result["risk_pct"] == 0.0
    assert result["discount_pct"] == 0.0


def test_discount_applied():
    # subtotal 1000, no risk/margin, 10% discount -> 900.0
    result = compute_pricing(
        materials_cost=1000,
        hours_by_category={},
        rate_by_category={},
        margin_pct=0.0,
        risk_pct=0.0,
        discount_pct=0.10,
        payment_terms="",
    )
    assert result["total"] == 900.0


def test_currency_optional():
    with_ccy = compute_pricing(0, {}, {}, 0, 0, 0, "", currency="EUR")
    assert with_ccy["currency"] == "EUR"
    without_ccy = compute_pricing(0, {}, {}, 0, 0, 0, "")
    assert "currency" not in without_ccy


@pytest.mark.parametrize(
    "kwargs",
    [
        {"materials_cost": -1},
        {"margin_pct": -0.1},
        {"risk_pct": -0.5},
        {"discount_pct": -0.01},
        {"discount_pct": 1.5},
        {"hours_by_category": {"engineering": -5}, "rate_by_category": {"engineering": 85}},
        {"hours_by_category": {"engineering": 5}, "rate_by_category": {"engineering": -85}},
    ],
)
def test_negative_and_out_of_range_inputs_rejected(kwargs):
    base = dict(
        materials_cost=100,
        hours_by_category={},
        rate_by_category={},
        margin_pct=0.1,
        risk_pct=0.1,
        discount_pct=0.0,
        payment_terms="",
    )
    base.update(kwargs)
    with pytest.raises(ValueError):
        compute_pricing(**base)


def test_missing_rate_for_category_rejected():
    with pytest.raises(ValueError):
        compute_pricing(
            materials_cost=0,
            hours_by_category={"welding": 10},
            rate_by_category={"engineering": 85},
            margin_pct=0.0,
            risk_pct=0.0,
            discount_pct=0.0,
            payment_terms="",
        )


def test_rounding_to_two_decimals():
    # labor 1 * 33.333 = 33.333 -> rounded 33.33
    result = compute_pricing(
        materials_cost=0,
        hours_by_category={"a": 1},
        rate_by_category={"a": 33.333},
        margin_pct=0.0,
        risk_pct=0.0,
        discount_pct=0.0,
        payment_terms="",
    )
    assert result["subtotal"] == 33.33
    assert result["total"] == 33.33


def test_price_from_config_uses_example_rate_card():
    cfg_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "example_client_config.json",
    )
    with open(cfg_path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    result = price_from_config(
        {"materials_cost": 1000, "hours_by_category": {"engineering": 10, "assembly": 20}},
        cfg,
    )
    # Same numbers as test_normal_case (demo card has margin .20 / risk .08 / discount 0)
    assert result["subtotal"] == 2950.0
    assert result["total"] == 3823.20
    assert result["currency"] == "EUR"
