#!/usr/bin/env node
// Copy the versioned logic cores from modules/ into the n8n Code nodes that run them.
//
// Several pieces of business logic live in this repo AND inside n8n, because a Code node cannot
// require a file: the pricing formula, the intake routing, the client-field capture, the render
// context, and the chapter-catalog resolution.
// docs/TESTING-MANUAL.md documents a drift *checker* — it tells you the two copies disagree. This
// script is the other half: it makes them agree, in the one direction that is safe (repo -> n8n).
//
//   node scripts/mirror-cores.js           write the cores into the workflow JSON
//   node scripts/mirror-cores.js --check    exit 1 if any node has drifted (for CI / pre-commit)
//
// Only the region between the CORE START/END markers is touched. Each node's own wrapper — the
// part that reads $json, throws on missing config and shapes the return — is left exactly as it
// was, because that part is genuinely node-specific.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const MIRRORS = [
  {
    module: 'modules/pricing/pricing_core.js',
    marker: 'PRICING CORE',
    targets: [['workflows/03-pricing-commercial-logic.json', 'Compute Pricing']],
  },
  {
    module: 'modules/intake/intake_core.js',
    marker: 'INTAKE CORE',
    // Both nodes get the whole core and each wrapper calls the half it needs — same pattern as
    // the chapter catalog below. 'Build Envelope' routes on the destination address; 'Intake
    // Guard' runs the junk/size/rate/body gates before anything expensive is invoked.
    targets: [
      ['workflows/00-orchestrator-end-to-end.json', 'Build Envelope'],
      ['workflows/00-orchestrator-end-to-end.json', 'Intake Guard'],
    ],
  },
  {
    module: 'modules/proposal/field_capture.js',
    marker: 'FIELD CAPTURE CORE',
    // Module 1 captures the client's declared fields out of the RFQ; the three 'Build Proposal
    // Config' nodes need the same core because chapter_catalog.js calls parseFieldDefinitions()
    // from it. In n8n both cores land in the one node and resolve from a shared scope — which is
    // exactly why the require() in chapter_catalog.js sits outside its core markers.
    targets: [
      ['workflows/01-data-collection-validation.json', 'Validate & Flag Missing Fields'],
      ['workflows/00-orchestrator-end-to-end.json', 'Build Proposal Config'],
      ['workflows/02-technical-content-generation.json', 'Build Proposal Config'],
      ['workflows/04-proposal-assembly.json', 'Build Proposal Config'],
    ],
  },
  {
    module: 'modules/proposal/render_context.js',
    marker: 'PROPOSAL RENDER CORE',
    targets: [['workflows/04-proposal-assembly.json', 'Compute Proposal Fields']],
  },
  {
    module: 'modules/proposal/chapter_catalog.js',
    marker: 'CHAPTER CATALOG CORE',
    // Resolved once by the orchestrator; the other two are the standalone fallbacks that let a
    // module be run on its own (the 'Config Provided?' pattern every module already has).
    targets: [
      ['workflows/00-orchestrator-end-to-end.json', 'Build Proposal Config'],
      ['workflows/02-technical-content-generation.json', 'Build Proposal Config'],
      ['workflows/04-proposal-assembly.json', 'Build Proposal Config'],
    ],
    // A Code node has no filesystem, so the require() is swapped for the literal catalog.
    inline: {
      start: '// === CATALOG JSON START ===',
      end: '// === CATALOG JSON END ===',
      build: () => `const CHAPTER_CATALOG = ${fs.readFileSync(path.join(ROOT, 'schemas/chapter-catalog.json'), 'utf8').trim()};`,
    },
  },
];

function extractCore(source, marker, file) {
  const start = `// === ${marker} START ===`;
  const end = `// === ${marker} END ===`;
  const i = source.indexOf(start);
  const j = source.indexOf(end);
  if (i === -1 || j === -1) throw new Error(`${file}: missing ${marker} markers`);
  return source.slice(i, j + end.length);
}

function applyInline(core, inline) {
  if (!inline) return core;
  const i = core.indexOf(inline.start);
  const j = core.indexOf(inline.end);
  if (i === -1 || j === -1) throw new Error(`missing CATALOG JSON markers inside the core`);
  return core.slice(0, i) + inline.build() + core.slice(j + inline.end.length);
}

// The node copies were historically compacted by hand, so compare meaning, not layout — same
// normalisation the drift checker in docs/TESTING-MANUAL.md uses.
const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();

const check = process.argv.includes('--check');
let changed = 0;
let drifted = 0;
let missing = 0;

for (const mirror of MIRRORS) {
  const modulePath = path.join(ROOT, mirror.module);
  const core = applyInline(extractCore(fs.readFileSync(modulePath, 'utf8'), mirror.marker, mirror.module), mirror.inline);

  for (const [wfRel, nodeName] of mirror.targets) {
    const wfPath = path.join(ROOT, wfRel);
    const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
    const node = (wf.nodes || []).find((n) => n.name === nodeName);
    if (!node) {
      // Not an error while a workflow is still being built out — say so and move on.
      console.log(`  --  ${wfRel} :: ${nodeName} (node not present yet)`);
      missing += 1;
      continue;
    }

    const code = node.parameters.jsCode || '';
    const WRAPPER = '// --- n8n wrapper ---';

    // A freshly added node has only its wrapper. Seed the core above it rather than making
    // someone paste 200 lines by hand — that paste is exactly how drift starts.
    if (!code.includes(`// === ${mirror.marker} START ===`)) {
      if (!code.includes(WRAPPER)) {
        console.error(`  !!  ${wfRel} :: ${nodeName} — no core markers and no '${WRAPPER}' line to seed above`);
        drifted += 1;
        continue;
      }
      if (check) {
        console.error(`  XX  ${wfRel} :: ${nodeName} has no core yet`);
        drifted += 1;
        continue;
      }
      node.parameters.jsCode = `${core}\n\n${code}`;
      fs.writeFileSync(wfPath, `${JSON.stringify(wf, null, 2)}\n`);
      console.log(`  +>  ${wfRel} :: ${nodeName} seeded from ${mirror.module}`);
      changed += 1;
      continue;
    }

    let current;
    try {
      current = extractCore(code, mirror.marker, `${wfRel}::${nodeName}`);
    } catch (e) {
      console.error(`  !!  ${wfRel} :: ${nodeName} — ${e.message}`);
      drifted += 1;
      continue;
    }

    if (norm(current) === norm(core)) {
      console.log(`  ok  ${wfRel} :: ${nodeName}`);
      continue;
    }

    if (check) {
      console.error(`  XX  ${wfRel} :: ${nodeName} has DRIFTED from ${mirror.module}`);
      drifted += 1;
      continue;
    }

    node.parameters.jsCode = code.replace(current, core);
    fs.writeFileSync(wfPath, `${JSON.stringify(wf, null, 2)}\n`);
    console.log(`  ->  ${wfRel} :: ${nodeName} updated from ${mirror.module}`);
    changed += 1;
  }
}

if (check && drifted) {
  console.error(`\n${drifted} node(s) out of sync. Run: node scripts/mirror-cores.js`);
  process.exit(1);
}
console.log(`\n${check ? 'checked' : 'mirrored'} — ${changed} updated, ${drifted} drifted, ${missing} not yet present`);
