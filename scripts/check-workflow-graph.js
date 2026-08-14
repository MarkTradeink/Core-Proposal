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
// The first fix connected all three reads directly into the same input index of
// 'Build Proposal Config', assuming n8n would treat that as "wait for all three, run once." It
// doesn't reliably: a live run hung indefinitely, and a second live run fired the downstream chain
// (including the Gmail send) three times. n8n's actual primitive for "wait for N branches, then
// continue once" is a Merge node - it has one input PORT per branch and only fires once every port
// has data, which three edges into one input index does not guarantee.
//
//   node scripts/check-workflow-graph.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const glob = require('fs').readdirSync(path.join(__dirname, '../workflows')).filter((f) => f.endsWith('.json'));

let problems = 0;
const fail = (file, msg) => { console.error(`  FAIL  ${file}: ${msg}`); problems += 1; };
const ok = (file, msg) => console.log(`  ok    ${file}: ${msg}`);

for (const file of glob) {
  const p = path.join(__dirname, '../workflows', file);
  const wf = JSON.parse(fs.readFileSync(p, 'utf8'));
  const nodeNames = new Set(wf.nodes.map((n) => n.name));
  // Every Code node must at least PARSE. n8n only compiles a Code node when the workflow runs and
  // execution reaches it, so a syntax error introduced by scripts/mirror-cores.js — or by an edit
  // to a wrapper — sits invisible until a live RFQ hits that branch. Parsing costs nothing here.
  for (const node of wf.nodes) {
    const code = node.parameters && node.parameters.jsCode;
    if (!code) continue;
    try {
      new vm.Script(`(async function(){${code}})`);
    } catch (e) {
      fail(file, `Code node '${node.name}' does not parse: ${e.message}`);
    }
  }


  const conn = wf.connections || {};

  // No two Sheets/Drive/Notion "read" nodes may feed one another directly. Those nodes execute
  // once PER INPUT ITEM and replace the item with whatever they read, so chaining them multiplies
  // rows geometrically instead of just running each read once off a shared trigger item.
  ok(file, `${wf.nodes.filter((n) => n.parameters && n.parameters.jsCode).length} Code node(s) parse`);

  // RECIPIENT SAFETY, statically. Legacy gap G1: the demo shipped a draft addressed to the
  // EXTRACTED END CUSTOMER instead of the reseller who sent the RFQ — a proposal, with the
  // reseller's margin in it, one click from the wrong inbox. Every outbound Gmail node must take
  // its address from client_config (reply_to / commercial_contact_email), never from the extracted
  // data. docs/TESTING-MANUAL.md Scenario 10 checks this by hand; this catches it on every commit.
  const CUSTOMER_FIELDS = /\b(?:data\.)?(?:rfq\.)?client\.email\b|extracted\.client\.email/;
  for (const node of wf.nodes) {
    if (node.type !== 'n8n-nodes-base.gmail') continue;
    const sendTo = ((node.parameters || {}).options || {}).sendTo || (node.parameters || {}).sendTo || '';
    if (CUSTOMER_FIELDS.test(String(sendTo))) {
      fail(file, `Gmail node '${node.name}' addresses the EXTRACTED end customer (${sendTo}) — outbound mail must go to the sender, via client_config.reply_to / commercial_contact_email.`);
    }
    // The address has to come from somewhere the envelope controls, not from a literal.
    if (sendTo && !/\{\{/.test(String(sendTo))) {
      fail(file, `Gmail node '${node.name}' has a hard-coded recipient (${sendTo}).`);
    }
  }
  const gmailNodes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail');
  if (gmailNodes.length) ok(file, `${gmailNodes.length} Gmail node(s) address the sender, not the extracted customer`);

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

  // If a "Build Proposal Config" node exists, every Proposal Config read must feed it in
  // parallel through an explicit Merge barrier - not through each other (that's the chaining bug
  // above), and not by connecting all three directly into the same input index on Build Proposal
  // Config either. n8n does not reliably treat "three edges into one input" as "wait for all three,
  // then run once" - depending on version and on whether the upstream nodes take an onError branch,
  // it can run the downstream node multiple times (each real execution re-sending emails, PDFs,
  // etc.) or never resolve the wait at all. A Merge node is the node built for this: it has one
  // input PORT per branch, and only fires once every port has data.
  const CONFIG_TABS = ['Read Chapters Tab', 'Read Content Tab', 'Read Rules Tab', 'Read Client Tab', 'Read Templates Tab', 'Read Fields Tab'];
  const expectedFeeders = CONFIG_TABS.filter((n) => nodeNames.has(n));
  if (nodeNames.has('Build Proposal Config') && expectedFeeders.length) {
    const feedsDirectly = (conn['Merge Config Tabs'] && conn['Merge Config Tabs'].main || []).flat().map((l) => l.node);
    if (!nodeNames.has('Merge Config Tabs')) {
      fail(file, `no 'Merge Config Tabs' node found - the Proposal Config reads must converge through a Merge barrier, not straight into 'Build Proposal Config'.`);
    } else if (!feedsDirectly.includes('Build Proposal Config')) {
      fail(file, `'Merge Config Tabs' does not connect to 'Build Proposal Config'.`);
    } else {
      for (const feeder of expectedFeeders) {
        const targets = (conn[feeder] && conn[feeder].main || []).flat().map((l) => l.node);
        if (!targets.every((t) => t === 'Merge Config Tabs') || !targets.length) {
          fail(file, `'${feeder}' must connect only to 'Merge Config Tabs', not ${JSON.stringify(targets)}.`);
        }
        if (targets.includes('Build Proposal Config')) {
          fail(file, `'${feeder}' connects directly into 'Build Proposal Config', bypassing the Merge barrier - several separate edges into one input is not a reliable wait-for-all in n8n.`);
        }
      }
      // A Merge only fires once EVERY port has data. Adding a tab read without widening the
      // Merge leaves that branch waiting on a port nothing feeds, which hangs the run rather
      // than failing it — the worst way to find out.
      const merge = wf.nodes.find((n) => n.name === 'Merge Config Tabs');
      const ports = (merge && merge.parameters && merge.parameters.numberInputs) || 2;
      if (ports !== expectedFeeders.length) {
        fail(file, `'Merge Config Tabs' has ${ports} input port(s) but ${expectedFeeders.length} tab read(s) feed it - a port with no feeder never receives data and the branch waits forever.`);
      }
      const usedPorts = new Set();
      for (const feeder of expectedFeeders) {
        for (const link of (conn[feeder] && conn[feeder].main || []).flat()) usedPorts.add(link.index || 0);
      }
      if (usedPorts.size !== expectedFeeders.length) {
        fail(file, `the tab reads share Merge input ports (${[...usedPorts].sort().join(', ')}) - each read needs its OWN port or the Merge fires before the others have run.`);
      }
      ok(file, `all ${expectedFeeders.length} Proposal Config reads converge through 'Merge Config Tabs' before 'Build Proposal Config'`);
    }
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
