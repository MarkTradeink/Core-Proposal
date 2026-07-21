#!/usr/bin/env python3
"""Guard: the pricing engine and the n8n Code node must stay byte-identical.

The pricing logic exists in two places on purpose:
  1. modules/pricing/pricing_engine.py         (tested source of truth)
  2. workflows/03-pricing-commercial-logic.json ("Compute Pricing" Pyodide node, deployed)

Both contain the region between the PRICING CORE markers. This script extracts that region
from each and asserts they match after whitespace normalization. Exit 0 = in sync, 1 = drift.

Run it in CI / before deploy. If it fails: edit the .py (the source of truth), then regenerate
the node code so the core region is copied over again.
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(REPO, "modules", "pricing", "pricing_engine.py")
WORKFLOW = os.path.join(REPO, "workflows", "03-pricing-commercial-logic.json")
NODE_NAME = "Compute Pricing"

START = "# === PRICING CORE START ==="
END = "# === PRICING CORE END ==="


def extract_core(text, where):
    if START not in text or END not in text:
        raise SystemExit("ERROR: PRICING CORE markers not found in %s" % where)
    return text.split(START, 1)[1].split(END, 1)[0]


def normalize(block):
    # Compare intent, not trailing whitespace / blank-line padding.
    lines = [ln.rstrip() for ln in block.strip("\n").splitlines()]
    return "\n".join(lines)


def main():
    engine_core = normalize(extract_core(open(ENGINE, encoding="utf-8").read(), ENGINE))

    wf = json.load(open(WORKFLOW, encoding="utf-8"))
    node = next((n for n in wf.get("nodes", []) if n.get("name") == NODE_NAME), None)
    if node is None:
        raise SystemExit("ERROR: node %r not found in %s" % (NODE_NAME, WORKFLOW))
    code = node.get("parameters", {}).get("pythonCode")
    if not code:
        raise SystemExit("ERROR: node %r has no pythonCode" % NODE_NAME)
    node_core = normalize(extract_core(code, WORKFLOW))

    if engine_core == node_core:
        print("OK: pricing core is in sync between pricing_engine.py and workflow 03.")
        return 0

    print("DRIFT: the pricing core differs between the .py and the n8n node.\n")
    import difflib

    diff = difflib.unified_diff(
        engine_core.splitlines(),
        node_core.splitlines(),
        fromfile="pricing_engine.py",
        tofile="workflow-03 Compute Pricing",
        lineterm="",
    )
    print("\n".join(diff))
    return 1


if __name__ == "__main__":
    sys.exit(main())
