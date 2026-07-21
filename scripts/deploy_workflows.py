#!/usr/bin/env python3
"""Deploy workflows/*.json to a live n8n instance via its REST API.

Reads credentials from the environment and REFUSES to run without them (never fabricates
values). Matches existing workflows by name: POST /api/v1/workflows to create, PATCH to update.

    export N8N_API_URL="https://<your-n8n-host>"   # base URL, no trailing /api/v1
    export N8N_API_KEY="<your-api-key>"
    python scripts/deploy_workflows.py            # deploy all workflows
    python scripts/deploy_workflows.py --relink   # after deploy, repoint the orchestrator's
                                                  # Execute Workflow nodes to the deployed ids

Requires: pip install requests
"""
import argparse
import glob
import json
import os
import sys
import time

try:
    import requests
except ImportError:
    print("ERROR: requests is required. Run: pip install requests")
    sys.exit(1)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOWS_DIR = os.path.join(REPO, "workflows")
ORCHESTRATOR_NAME = "00-orchestrator-end-to-end"

# n8n's create/update API accepts these top-level keys; strip everything else (e.g. our `meta`).
ALLOWED_KEYS = ("name", "nodes", "connections", "settings", "staticData")


def require_env():
    url = os.environ.get("N8N_API_URL")
    key = os.environ.get("N8N_API_KEY")
    if not url or not key:
        print("ERROR: N8N_API_URL and N8N_API_KEY must both be set in the environment.")
        print("Refusing to run without them — this script never fabricates credentials.")
        sys.exit(1)
    return url.rstrip("/"), key


def api(method, base, key, path, payload=None, retries=4):
    """Call the n8n API with exponential backoff on network errors (2s, 4s, 8s, 16s)."""
    url = f"{base}/api/v1{path}"
    headers = {"X-N8N-API-KEY": key, "Content-Type": "application/json", "Accept": "application/json"}
    delay = 2
    for attempt in range(retries + 1):
        try:
            resp = requests.request(method, url, headers=headers, data=json.dumps(payload) if payload is not None else None, timeout=30)
            if resp.status_code >= 500 and attempt < retries:
                raise requests.RequestException(f"server {resp.status_code}")
            return resp
        except requests.RequestException as exc:
            if attempt >= retries:
                raise
            print(f"  network error ({exc}); retrying in {delay}s...")
            time.sleep(delay)
            delay *= 2


def list_existing(base, key):
    """Return {name: id} for all workflows on the instance (paginated)."""
    result = {}
    cursor = None
    while True:
        path = "/workflows?limit=100" + (f"&cursor={cursor}" if cursor else "")
        resp = api("GET", base, key, path)
        resp.raise_for_status()
        body = resp.json()
        for wf in body.get("data", []):
            result[wf["name"]] = wf["id"]
        cursor = body.get("nextCursor")
        if not cursor:
            break
    return result


def clean_payload(wf):
    return {k: wf[k] for k in ALLOWED_KEYS if k in wf}


def deploy_all(base, key):
    existing = list_existing(base, key)
    name_to_id = {}
    failures = 0
    for path in sorted(glob.glob(os.path.join(WORKFLOWS_DIR, "*.json"))):
        wf = json.load(open(path, encoding="utf-8"))
        name = wf["name"]
        payload = clean_payload(wf)
        try:
            if name in existing:
                resp = api("PATCH", base, key, f"/workflows/{existing[name]}", payload)
                action = "updated"
                wf_id = existing[name]
            else:
                resp = api("POST", base, key, "/workflows", payload)
                action = "created"
                wf_id = resp.json().get("id") if resp.ok else None
            if resp.ok:
                name_to_id[name] = wf_id or name_to_id.get(name)
                print(f"  {action}: {name} (id={name_to_id.get(name)})")
            else:
                failures += 1
                print(f"  FAILED ({resp.status_code}): {name} — {resp.text[:200]}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"  ERROR: {name} — {exc}")
    # Refresh ids for anything created.
    name_to_id.update(list_existing(base, key))
    return name_to_id, failures


def relink_orchestrator(base, key, name_to_id):
    """Repoint the orchestrator's Execute Workflow nodes to the deployed sub-workflow ids.

    Matches by each node's workflowId.cachedResultName (which equals the sub-workflow's file name).
    """
    orch_id = name_to_id.get(ORCHESTRATOR_NAME)
    if not orch_id:
        print("  relink skipped: orchestrator not deployed.")
        return 0
    path = os.path.join(WORKFLOWS_DIR, f"{ORCHESTRATOR_NAME}.json")
    wf = json.load(open(path, encoding="utf-8"))
    changed = 0
    for node in wf["nodes"]:
        if node.get("type") != "n8n-nodes-base.executeWorkflow":
            continue
        wid = node.get("parameters", {}).get("workflowId", {})
        target_name = wid.get("cachedResultName")
        target_id = name_to_id.get(target_name)
        if target_id:
            wid["value"] = target_id
            changed += 1
            print(f"  relinked '{node['name']}' -> {target_name} (id={target_id})")
        else:
            print(f"  WARNING: no deployed id for '{target_name}' referenced by '{node['name']}'")
    if changed:
        resp = api("PATCH", base, key, f"/workflows/{orch_id}", clean_payload(wf))
        if not resp.ok:
            print(f"  FAILED to update orchestrator: {resp.status_code} — {resp.text[:200]}")
            return 1
        print(f"  orchestrator updated with {changed} relinked reference(s).")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--relink", action="store_true", help="After deploy, repoint orchestrator Execute Workflow nodes to deployed ids.")
    args = parser.parse_args()

    base, key = require_env()
    print(f"Deploying workflows to {base} ...")
    name_to_id, failures = deploy_all(base, key)

    if args.relink:
        print("Relinking orchestrator sub-workflow references ...")
        failures += relink_orchestrator(base, key, name_to_id)

    print()
    if failures:
        print(f"DONE with {failures} failure(s).")
        return 1
    print("DONE — all workflows deployed successfully.")
    print("Reminder: link node credentials (Gmail, Google, Anthropic, Telegram, Notion) in the n8n UI,")
    print("then activate the orchestrator trigger. See docs/DEPLOYMENT.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
