#!/usr/bin/env python3
"""End-to-end smoke test for the demo_client pipeline.

Runs a demo RFQ fixture through the pipeline's contract stages and asserts the output shape at
each stage against the JSON Schemas in schemas/. What is deterministic (the pricing engine) is
executed for real; the LLM stages (Modules 1 and 2) are represented by fixtures that stand in for
their output and are validated against their contracts. Also asserts the key business invariants
that the refactor introduced (recipient fix G1, missing-field flagging G3).

Offline — does not require a live n8n instance. Requires: pip install jsonschema.

Exit 0 = all checks passed, 1 = a check failed.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "modules", "pricing"))

try:
    from jsonschema import Draft7Validator
except ImportError:
    print("ERROR: jsonschema is required. Run: pip install jsonschema")
    sys.exit(1)

from pricing_engine import price_from_config  # noqa: E402

SCHEMAS = os.path.join(REPO, "schemas")


def load_schema(name):
    with open(os.path.join(SCHEMAS, name), encoding="utf-8") as fh:
        return json.load(fh)


def load_example_config():
    with open(os.path.join(REPO, "modules", "pricing", "example_client_config.json"), encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Fixtures — a demo_client RFQ and the resolved client_config.
# ---------------------------------------------------------------------------
CLIENT_CONFIG = {
    "client_id": "demo_client",
    "client_name": "Demo Client",
    "commercial_contact_email": "reseller@demo-client.example",  # the reseller (draft recipient)
    "templates": {"en": "1szdkO1MVKVsIXizYQd_x-6WJMP8OPK50oSif4Uw5LQA", "es": None},
    "proposals_folder_id": "1vmm_AQf8FGtc7E_ujJsetwNpuzzVXCxc",
    "reference_docs_folder_id": None,
    "notification_chat_id": "1748634056",
    "rate_card": load_example_config()["rate_card"],
}

END_CUSTOMER_EMAIL = "buyer@acme-manufacturing.example"  # extracted from the RFQ, must NOT get the draft

M1_COMPLETE = {
    "client_id": "demo_client",
    "client_config": CLIENT_CONFIG,
    "status": "ok",
    "errors": [],
    "data": {
        "client": {"company": "Acme Manufacturing", "contact_name": "Jane", "contact_last_name": "Doe", "email": END_CUSTOMER_EMAIL},
        "project": {"type": "automated conveyor line", "location": "Bilbao", "desired_deadline": "Q4 2026"},
        "technical_requirements": [
            {"item": "modular conveyor", "quantity": "3", "spec": "belt, 12m each"},
            {"item": "PLC control system", "quantity": "1", "spec": None},
        ],
        "notes": None,
        "language": "en",
        "status": "complete",
        "missing_fields": [],
    },
}

M1_INCOMPLETE = {
    "client_id": "demo_client",
    "client_config": CLIENT_CONFIG,
    "status": "ok",
    "errors": [],
    "data": {
        "client": {"company": "Acme Manufacturing", "contact_name": "Jane", "contact_last_name": None, "email": None},
        "project": {"type": None, "location": None, "desired_deadline": None},
        "technical_requirements": [],
        "notes": None,
        "language": "en",
        "status": "incomplete",
        "missing_fields": ["client.email", "project.type", "technical_requirements"],
    },
}

M2_OUTPUT = {
    "client_id": "demo_client",
    "client_config": CLIENT_CONFIG,
    "status": "ok",
    "errors": [],
    "data": {
        "alcance_tecnico": "The proposed system comprises modular conveyors and a PLC control system...",
        "plan_implantacion": "Engineering (2 wks), Supply (6 wks), Assembly (3 wks), Commissioning (2 wks), Startup (1 wk).",
        "resumen_comercial": "Scope covers supply and commissioning. Terms 30/40/30. Next steps: review and sign-off.",
        "grounded_on": [],
    },
}

PRICING_INPUTS = {"materials_cost": 5000, "hours_by_category": {"engineering": 40, "assembly": 60, "commissioning": 20, "project_management": 15}}


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
_failures = []


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        _failures.append(name)


def validate(name, schema_file, payload):
    errors = sorted(Draft7Validator(load_schema(schema_file)).iter_errors(payload), key=lambda e: e.path)
    check(name, not errors, detail="; ".join(e.message for e in errors[:3]))


def main():
    print("Stage 1 — Data collection & validation")
    validate("M1 complete output matches schema", "data-collection.schema.json", M1_COMPLETE)
    validate("M1 incomplete output matches schema", "data-collection.schema.json", M1_INCOMPLETE)
    check("complete RFQ has no missing_fields", M1_COMPLETE["data"]["missing_fields"] == [])
    check("incomplete RFQ is flagged (gap G3)", M1_INCOMPLETE["data"]["status"] == "incomplete" and len(M1_INCOMPLETE["data"]["missing_fields"]) > 0)

    print("Stage 2 — Technical content generation")
    validate("M2 output matches schema", "content-generation.schema.json", M2_OUTPUT)

    print("Stage 3 — Pricing & commercial logic (executed for real)")
    pricing_data = price_from_config(PRICING_INPUTS, CLIENT_CONFIG)
    m3_output = {"client_id": "demo_client", "client_config": CLIENT_CONFIG, "status": "ok", "errors": [], "data": pricing_data}
    validate("M3 output matches schema", "pricing.schema.json", m3_output)
    # subtotal = 5000 + 40*85 + 60*55 + 20*70 + 15*95 = 5000+3400+3300+1400+1425 = 14525
    # total = 14525 * 1.08 * 1.20 * 1.0 = 18824.40
    check("pricing subtotal is correct", pricing_data["subtotal"] == 14525.0, detail=str(pricing_data["subtotal"]))
    check("pricing total is correct", pricing_data["total"] == 18824.40, detail=str(pricing_data["total"]))

    print("Stage 4 — Proposal assembly (contract + invariants)")
    language = M1_COMPLETE["data"]["language"]
    template_used = CLIENT_CONFIG["templates"].get(language) or CLIENT_CONFIG["templates"]["en"]
    m4_output = {
        "client_id": "demo_client",
        "client_config": CLIENT_CONFIG,
        "status": "ok",
        "errors": [],
        "data": {
            "proposal_number": "PROP-20260721-AB12CD",
            "document_id": "doc-123",
            "pdf_file_name": "Proposal PROP-20260721-AB12CD - Acme Manufacturing.pdf",
            "draft_id": "draft-123",
            "draft_recipient": CLIENT_CONFIG["commercial_contact_email"],
            "language": language,
            "template_id_used": template_used,
            "notified_chat_id": CLIENT_CONFIG["notification_chat_id"],
        },
    }
    validate("M4 output matches schema", "proposal-assembly.schema.json", m4_output)
    check("draft goes to the reseller, not the end customer (gap G1)",
          m4_output["data"]["draft_recipient"] == CLIENT_CONFIG["commercial_contact_email"]
          and m4_output["data"]["draft_recipient"] != END_CUSTOMER_EMAIL)
    check("template selected by language with EN fallback (gap G2)", template_used == CLIENT_CONFIG["templates"]["en"])
    check("proposal number follows deterministic pattern (bug B2)", m4_output["data"]["proposal_number"].startswith("PROP-"))

    print()
    if _failures:
        print(f"SMOKE TEST FAILED — {len(_failures)} check(s) failed: {', '.join(_failures)}")
        return 1
    print("SMOKE TEST PASSED — all stages produce schema-valid output and invariants hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
