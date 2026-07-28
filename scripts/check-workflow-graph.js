#!/usr/bin/env node
// Structural sanity checks over the workflow JSON graphs — the class of bug that only shows up
// once n8n actually executes a workflow, never in the offline module self-checks (those call
// resolveProposalConfig() directly with an in-memory sheet object and never touch n8n's
// item-per-execution model at all).
//
// Born from a real incident: the three "Proposal Config" Sheets reads (Chapters/Content/Rules)
// were wired in a CHAIN (Chapters -> Content -> Rules -> Build Proposal Config) instead of in
// PARALLEL off the same gate. A Google Sheets read node replaces its input item with however many
// rows it read, so chaining meant each read fed the next N times (once per row of the previous
// tab) - the Chapters tab has 4 rows, so Content got read 4 times and every clause in the document
// came out duplicated exactly 4x. It also meant the second and third reads received a spreadsheet
// row as $json instead of the request envelope, so `$json.client_config...` broke.
//
//   node scripts/check-workflow-graph.js

const fs = require('fs');
const path = require('path');
const glob = require('fs').readdirSync(path.join(__dirname, '../workflows')).filter((f) => f.endsWith('.json'));

let problems = 0;
const fail = (file, msg) => { console.error(`  FAIL  ${file}: ${msg}`); problems += 1; };
const ok = (file, msg) => console.log(`  ok    ${file}: ${msg}`);

for (const file of glob) {
  const p = path.join(__dirname, '../workflows', file);
  const wf = JSON.parse(fs.readFileSync(p, 'utf8'));
  const nodeNames = new Set(wf.nodes.map((n) => n.name));
  const conn = wf.connections || {};

  // No two Sheets/Drive/Notion "read" nodes may feed one another directly. Those nodes execute
  // once PER INPUT ITEM and replace the item with whatever they read, so chaining them multiplies
  // rows geometrically instead of just running each read once off a shared trigger item.
  const readTypes = new Set(['n8n-nodes-base.googleSheets', 'n8n-nodes-base.notion']);
  const readNodes = wf.nodes.filter((n) => readTypes.has(n.type)).map((n) => n.name);
  for (const name of readNodes) {
    const targets = (conn[name] && conn[name].main || []).flat().map((l) => l.node);
    for (const t of targets) {
      if (readNodes.includes(t)) {
        fail(file, `'${name}' connects directly into '${t}' - two row-reading nodes chained together will multiply rows on every real run, not just resolve one after the other. Fan both out from their shared upstream gate instead.`);
      }
    }
  }

  // If a "Build Proposal Config" node exists, it must be fed by ALL three Proposal Config reads
  // directly (a converging fan-in), not by one of them relaying through the other two.
  if (nodeNames.has('Build Proposal Config')) {
    const expectedFeeders = ['Read Chapters Tab', 'Read Content Tab', 'Read Rules Tab'].filter((n) => nodeNames.has(n));
    for (const feeder of expectedFeeders) {
      const targets = (conn[feeder] && conn[feeder].main || []).flat().map((l) => l.node);
      if (!targets.includes('Build Proposal Config')) {
        fail(file, `'${feeder}' does not connect directly to 'Build Proposal Config' - it should feed it in parallel with the other two reads.`);
      }
    }
    if (expectedFeeders.length) ok(file, `all ${expectedFeeders.length} Proposal Config reads feed 'Build Proposal Config' in parallel`);
  }

  // 'Build Proposal Config' must never spread its own $json into its output — its own direct
  // input is a merge of the three Sheets reads (or, on the fallback path, whatever fed it), never
  // the request envelope. It must spread a named node reference (trig / env / a variable derived
  // from one) instead, or the client/project fields the rest of the document depends on go empty.
  const bpc = wf.nodes.find((n) => n.name === 'Build Proposal Config');
  if (bpc) {
    const code = bpc.parameters.jsCode || '';
    if (/\.\.\.\s*\$json\b/.test(code)) {
      fail(file, `'Build Proposal Config' spreads bare $json into its return value - that is a spreadsheet row here, not the request envelope. Spread a $('SomeNode').first().json - derived variable instead.`);
    } else {
      ok(file, `'Build Proposal Config' does not spread bare $json`);
    }
  }
}

if (problems) {
  console.error(`\n${problems} problem(s) found.`);
  process.exit(1);
}
console.log('\nOK — no chained row-reading nodes, no bare-$json envelope loss.');
