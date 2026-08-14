#!/usr/bin/env node
// Replay the orchestrator's routing decision against the REAL node source, over every
// combination of contracted tier, extracted request type and pricing configuration.
//
//   node scripts/check-routing.js
//
// Born from a live incident: a `proposal_only` client sent a technical RFQ, the LLM extractor read
// it as `full_pipeline`, and the orchestrator followed that classification into Module 3 — which
// threw `No pricing source for client '<id>'` three steps downstream of where the information to
// prevent it lived. The routing code trusted request_type outright whenever it was anything other
// than 'unspecified', which let a single email widen past what the client had actually bought.
//
// The rule this file exists to hold in place: **service_tier is a ceiling, not a default.** A
// request may narrow within the tier — the documented feature is a full_pipeline client asking for
// just a price on one RFQ — but never widen past it. Three invariants follow, and all three are
// silent when they break: the wrong route just produces the wrong deliverable, or a crash deep in
// another workflow.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/00-orchestrator-end-to-end.json'), 'utf8'));
const node = wf.nodes.find((n) => n.name === 'Resolve Route');
if (!node) {
  console.error("FAIL: no 'Resolve Route' node in the orchestrator.");
  process.exit(1);
}

// Run the node's own code, not a copy of it — a re-implementation here would drift and pass while
// the thing that actually executes is broken.
const resolveRoute = new Function('$json', node.parameters.jsCode);
const run = (service_tier, request_type, pricing_sheet_id) => resolveRoute({
  client_id: 'test_client',
  client_config: { service_tier, pricing_sheet_id },
  data: { request_type },
})[0].json;

const TIERS = ['pricing_only', 'proposal_only', 'full_pipeline'];
const ASKS = ['pricing_only', 'proposal_only', 'full_pipeline', 'unspecified'];
const PRICING_ROUTES = ['pricing_only', 'full_pipeline'];

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

for (const tier of TIERS) {
  for (const ask of ASKS) {
    for (const sheet of ['sheet_id', null]) {
      const where = `tier=${tier} asked=${ask} pricing=${sheet ? 'yes' : 'no'}`;
      const r = run(tier, ask, sheet);

      // 1. The tier is a ceiling. A single email can never buy a deliverable the client did not.
      if (tier === 'proposal_only') check(r.route === 'proposal_only', `${where}: escaped the tier -> '${r.route}'`);
      if (tier === 'pricing_only') check(['pricing_only', 'blocked_no_pricing'].includes(r.route), `${where}: escaped the tier -> '${r.route}'`);

      // 2. Module 3 is never entered without a rate card to read. This is the exact crash the
      //    incident produced, and the only reason it was survivable is that it threw loudly.
      if (!sheet) check(!PRICING_ROUTES.includes(r.route), `${where}: routed into Module 3 with no rate card -> '${r.route}'`);

      // 3. Nothing changes silently. A sender who asked for a price and received a proposal has to
      //    be able to find out why without opening an execution log.
      if (ask !== 'unspecified' && r.route !== ask) check(!!r.route_note, `${where}: route changed to '${r.route}' with no route_note`);
      if (ask !== 'unspecified' && r.route === ask) check(!r.route_note, `${where}: route unchanged but a route_note was raised`);

      check(r.requested_route === ask, `${where}: requested_route should echo what the extractor said`);
    }
  }
}

// The documented product feature (README): a client on full_pipeline narrowing to one deliverable
// for a single RFQ. The clamp must not be so strict that it takes this away.
check(run('full_pipeline', 'pricing_only', 'sheet_id').route === 'pricing_only', 'a full_pipeline client can no longer ask for just a price');
check(run('full_pipeline', 'proposal_only', 'sheet_id').route === 'proposal_only', 'a full_pipeline client can no longer ask for just a proposal');
check(run('full_pipeline', 'unspecified', 'sheet_id').route === 'full_pipeline', "'unspecified' should fall back to the client's tier");

// An unknown or absent service_tier still falls back to 'full_pipeline', as it always has and as
// docs/CLIENT-REGISTRY-SCHEMA.md describes. That is the permissive option, so what actually holds
// the line is the backstop below it: a blank or mistyped Notion property can never reach Module 3
// on its own, because there is no rate card to reach it with.
for (const badTier of [undefined, '', 'nonsense_tier']) {
  check(!PRICING_ROUTES.includes(run(badTier, 'full_pipeline', null).route), `service_tier='${badTier}' with no rate card reached Module 3`);
  check(!PRICING_ROUTES.includes(run(badTier, 'pricing_only', null).route), `service_tier='${badTier}' with no rate card reached Module 3`);
  // With a rate card configured the client evidently does price, so the old behaviour stands.
  check(run(badTier, 'full_pipeline', 'sheet_id').route === 'full_pipeline', `service_tier='${badTier}' should still fall back to full_pipeline when pricing exists`);
}

// The incident itself.
const incident = run('proposal_only', 'full_pipeline', null);
check(incident.route === 'proposal_only' && !!incident.route_note, 'the reported incident is not fixed');

console.log(`replayed ${TIERS.length * ASKS.length * 2} routing combinations against the real 'Resolve Route' source`);
if (problems.length) {
  console.error(`\nFAIL:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('OK — service_tier is a ceiling, Module 3 is never entered without a rate card, and no route changes silently.');
