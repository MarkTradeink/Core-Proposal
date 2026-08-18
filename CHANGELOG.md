# Changelog

All notable changes to this repo are recorded here. Dates are ISO-8601.

## [Unreleased]

### Feature — seven RFQs to send at the demo, and a dry run so they are not wasted (2026-08-18)

There were no test RFQs anywhere in the repo. The only ones that existed were fixtures buried
inside `check-intake-routing.js` and `render-sample.js`, written to make an assertion rather than to
be sent, and the generated `demo_client-rfq-template.md` is a blank form pointed at
`proposal@cifral.io`. So the first real exercise of the public address would have been improvised
prose, which tests whatever the author happened to think of.

`seed/demo_client/test-rfqs/` now holds seven, each picked because its *failure* looks like success:
a full pipeline in Spanish, a proposal-only in English (the price chapter must be **gone**, not
empty), a pricing-only that declares no cover variables at all (empty boxes, never `undefined`), an
incomplete one that should come back asking for what is missing, a tier-C tender with eight numbered
clauses, a supply-only one that says installation and engineering are excluded in as many words, and
an autoresponder that must be swallowed in silence. The README says what each should produce and
what to check.

**`scripts/dry-run-rfq.js`** replays one through the real routing, the real guards and the real
cover-variable capture, offline, against the actual node source. The demo allows three RFQs per
sender per UTC day, so learning by email that a label did not match costs a third of the day's
budget and four minutes of waiting — and it is precisely the deterministic half that fails
*silently*: a junk-filter drop leaves no alert at all, and a label the sheet does not declare leaves
a blank box on a cover. What the script cannot know it prints as such rather than guessing: request
type, scope, tier and the missing-field check are a model call inside n8n.

### Docs — a Proposal Config sheet older than the tabs it is missing (2026-08-18)

`Client`, `Templates` and `Fields` were added on 2026-08-12, and a sheet created before then simply
does not have them. The pipeline treats that as valid — all three are optional by design, so a
client onboarded earlier keeps working — which is correct and is also why nothing tells you.

Two of the three cost almost nothing. The third reaches the customer: with no `Fields` tab, `campos`
is empty and **every `{campos.*}` tag in the template prints the literal word `undefined`**. The
totality rule that keeps every other key present-but-empty cannot cover it, because with no tab
there is nothing to enumerate. Verified by rendering the demo template against a config with the tab
removed: `render-sample.js` fails on the word, exactly as it would appear on paper.

That is now a section in `docs/CLIENT-DRIVE-SETUP.md` — what each absent tab costs, how to add the
missing ones from the CSVs the repo already holds, and `check-template.js` as the tool that catches
this specific failure before a document does.


### Feature — the demo answers by itself, from a template that says it is one (2026-08-18)

`demo@cifral.io` has been open to any sender since 2026-08-11, but its answer stopped in Mark's
drafts. That was the right default for an address nobody had been told about, and the wrong one for
an address about to appear in outbound copy: the CTA is *"send your RFQ to demo@cifral.io and try
it yourself"*, and a demo that replies when somebody gets round to it is not a demo. The reply is
now delivered — in the sender's own thread, with the `.docx` and the PDF attached.

**One switch, and every gate reads it.** `DEMO_SEND_MODE` in `modules/intake/intake_core.js` rides
out on the envelope from `resolveIntake` and is resolved once, in the orchestrator's
`Map Client Config`. The four gates downstream — Module 4's `Compute Proposal Fields`, the
orchestrator's `Build Quote Draft` and `Build Missing Info Reply` — used to re-derive `'draft'` from
`open_intake` each for themselves, which made a rollback a four-node edit and made "are they all
still agreeing?" a question nobody could answer by reading one file. They now read the resolved
value and **normalise** it: anything that is not the literal `send` becomes a draft. So a value lost
in some future refactor costs a delivery rather than buying one, and the rollback is one line plus
`npm run mirror`.

What did *not* change is the thing worth keeping: the demo tenant's mode is still decided in code
and never read from Notion. The reasoning in `docs/DEMO-INTAKE.md` §3 was never "draft is safe" — it
was that a property which can be renamed, blanked or mistyped resolves to whatever the default
happens to be, and a public address must not have its behaviour decided by an accident **in either
direction**. Only the answer changed.

**Sending made the wording load-bearing.** A human reading a draft supplies the missing context; a
prospect opening an attachment does not.

- The covering email was one hard-coded English paragraph on the Gmail node, addressed to a reseller
  reviewing a proposal *"before it goes to the customer"* — wrong on both counts once the reader is
  the prospect, and wrong again for the Spanish and German senders it answered in English. It is
  composed in `Compute Proposal Fields` now, in the RFQ's own language, with a demo version that
  says plainly what the document is and what gets adapted per client.
- The `pricing_only` answer has a demo version too, and it prints **no subtotal**. The reseller
  version does, because a reseller is entitled to their own cost basis; on the public route the
  reader is the customer. The document itself never carried a subtotal tag at all.
- `templates/build-templates.js` now emits four files: the two neutral seeds plus
  `demo-proposal-template-{es,en}.docx`, marked as a demonstration on the cover, in the running
  header, in the footer of every page and on an "About this document" notice page — which also
  explains, to a reader who has never heard of any of this, which parts of what they are holding
  are real and which are sample content.

`scripts/check-intake-routing.js` carries the assertions, and they got sharper rather than weaker:
every gate must agree with `DEMO_SEND_MODE`; the registry row is set to the *opposite* value and
must still lose; Module 4's standalone copy of the constant must not have drifted from the core;
four kinds of broken `send_mode` must all park the message while `'  Send '` must still normalise;
and the demo mail must name itself a demonstration and answer a Spanish RFQ in Spanish.

### Feature — the seed templates caught up with the catalog they are generated from (2026-08-18)

Three gaps between what `render_context.js` emits and what `build-templates.js` puts on paper, all
of them dating from the client-fields work below and all of them silent:

**The cover printed `{proyecto.tipo}` and not `{proyecto.titulo}`.** The context has emitted the
project's own title — as the sender words it, falling back to the type — since that work landed;
the generated cover never used it, so every seed-derived template threw the better string away.

**No `{campos.*}` anywhere.** The whole point of the `Fields` tab is that a client's ERP offer
number reaches their cover, and the generated template had nowhere for it to land. It could not
simply be added, either: a `{campos.*}` key the client's sheet does not declare prints the literal
word `undefined`, so those tags can only be generated *per client*. The generator now reads
`seed/<client_id>/proposal-config/fields.csv` through the same `parseFieldDefinitions()` the
pipeline uses, and lays the cover out from it — a `request` field becomes a labelled line, the first
`static` field becomes the issuer line above the title, and `auto` fields are deliberately left off
because each one duplicates something the cover already prints under its own tag.

**Which word to print was unanswerable.** `capture_label` holds comma-separated alternatives and the
capture looks for all of them in any language, which is correct and unchanged. But nothing said
which one a cover should *print*, and position cannot say it: `Oferta nº, Offer no` puts Spanish
first while `Asset, Activo` puts English first, so the first English demo cover came out reading
"Activo" and "Nº proyecto". An alternative may now carry an optional `es:` / `en:` tag, stripped
before matching and used only for display. Untagged rows behave exactly as before, so no existing
sheet has to change; `demo_client` and `beumer_marcos` are tagged.

`npm run check` renders six documents now instead of four — the two demo templates included, since
those are the ones that reach strangers with nobody in between. `scripts/render-sample.js` grew an
`--out` flag so two templates at the same tier and language stop overwriting each other's output,
which would otherwise have left a check quietly examining a document nobody meant to check.


### Change — workflow JSON now mirrors the live n8n layout (2026-08-14)

Re-importing had become a chore: the repo carried its own node positions, so every import needed the
canvas rearranged by hand, and workflow 02's agent prompts were plain text in the repo where the live
ones were expressions — a manual fix, four nodes, every time. The Google Sheets nodes carried no
credential reference at all, so six of them had to be re-picked from a dropdown on each import.

All five workflows are now pulled from the live instance and carry its node positions, node ids,
`settings` (including the error workflow) and credential references, with the repo's newer *logic*
merged back over the top — `Map Client Config` in all five and `Resolve Route` in the orchestrator.
The division is now stated in `docs/DEPLOYMENT.md`: the repo owns logic, the live instance owns
layout, and neither silently overwrites the other.

### Feature — the demo reports its own leads, and an incomplete RFQ answers the sender (2026-08-14)

Telegram was carrying three different kinds of message to one audience. Two of them were in the wrong
place:

**A used demo is a lead, not a log line.** `demo@cifral.io` produced no signal beyond the ordinary
"proposal drafted" alert, so a prospect who tried it was indistinguishable from routine traffic. A
`Demo Used Alert` now fires with the sender's address, the subject and the intake address, wired to
run *before* the pipeline it accompanies — a demo that later fails is still a lead worth chasing.

**An incomplete RFQ is a conversation with whoever sent it.** It was reported only to Cifral's
Telegram, which cannot ask the sender for the missing field. The orchestrator now also composes a
reply to the sender, in their own thread, listing what is missing — in the RFQ's language, and using
readable labels rather than machine keys. For a client's own declared fields the label is the one
*they* chose in their `Fields` tab, which is also the exact string the capture looks for, so the
reply asks for the value using the words that will match it. Module 1 emits `missing_fields_detail`
for this; `missing_fields` is unchanged, because the orchestrator and the alerts branch on it.

Three properties this was built around, all of them the kind that only announce themselves in
production:
- **Cifral's Telegram alert is wired first** on that branch, so the internal copy fires whatever the
  Gmail leg does, and a missing reply address is reported as `deliverable: false` rather than thrown
  on top of an alert that has already gone out.
- **The public intake still cannot send.** `Build Missing Info Reply` re-asserts the draft-only rule
  for `open_intake` at the last gate before Gmail, exactly as Module 4 does.
- **The reply goes to the sender, never the extracted end customer** — legacy gap G1. That rule was
  only ever a manual test; `scripts/check-workflow-graph.js` now enforces it statically, failing any
  Gmail node whose recipient reads from the extracted data or is hard-coded.

### Fix — Notion property shapes leaked through `prop()` and defeated the routing clamp (2026-08-12)

The tier clamp below was correct and the route was *still* `full_pipeline` in production. Cause: the
`prop()` helper that reads the Notion registry ends in `?? p ?? null`, so any property shape it does
not recognise is returned as the **raw object**. Two live failures, and they had to coincide to
produce the symptom:

- **`service_tier` as a Select** arrived as an object, not `'proposal_only'`, so `TIER_ALLOWS[…]`
  missed and the tier fell back to `full_pipeline` — the permissive option;
- **`pricing_sheet_id`, empty**, arrived as `[]` or `{}` — both **truthy** — so the capability
  backstop read "no sheet id" as "pricing configured" and declined to downgrade.

Either alone was survivable: a bad tier still got caught by the backstop, and a truthy-empty sheet id
still got caught by the clamp. Together they cancelled each other out. Neither was visible, because
both fail toward the permissive answer and the only client that existed before this one was
`full_pipeline` anyway — the same failure class the intake code already calls out in a comment about
`send_mode` resolving `undefined` to `'send'`.

`prop()` now normalises to a string or `null` through an `asText()` that understands the shapes n8n
and the Notion API actually emit (plain string, `{name}`, `{value}`, `{type,select:{name}}`,
`{type,status:{name}}`, rich-text arrays), passing booleans through untouched. Fixed in all five
workflows. `Resolve Route` normalises again on its own input rather than trusting its caller, and now
echoes `service_tier_raw` and `has_pricing` in its output, so the next misroute is one glance at the
node instead of a debugging round.

`scripts/check-routing.js` gained the shape matrix: 8 registry value shapes for `service_tier` and
4 empty shapes for `pricing_sheet_id`. Replayed against the previous node source, the new cases fail
— which is the only evidence worth having that a regression test tests anything.

### Fix — `service_tier` is now a ceiling, not just a default (2026-08-12)

Found live: a `proposal_only` client sent a technical RFQ, the extractor read it as `full_pipeline`,
and the orchestrator followed that classification into Module 3, which threw
`No pricing source for client '<id>'` three steps downstream of where the information to prevent it
lived. `service_tier` was never consulted, because `request_type` only fell back to it when the
extractor said `unspecified` — and here it didn't.

The first cut of this fix added a capability guard: if the client has no rate card, don't route to
pricing. That fixed the crash and missed the cause. Mark pushed back — the Notion row already
carries the three tiers, so why is routing this complicated? — and he was right. The README had
described the correct behaviour all along: *"a client **on `full_pipeline`** can still ask for just
a price on a given RFQ"*. That is narrowing **within** what was contracted. The code implemented it
as "the email wins outright", which also permitted widening past it, and widening is what broke.

`Resolve Route` now clamps `request_type` to what the tier permits — `pricing_only` and
`proposal_only` admit only themselves, `full_pipeline` admits all three; anything else, including
`unspecified`, falls back to the tier. One misread email can no longer buy a deliverable the client
never contracted for, and the documented per-request narrowing survives untouched.

The capability check stays as a **backstop**, now with a much narrower job: once the clamp holds, a
pricing route can only appear because the tier says so, so a missing rate card is purely
misconfiguration. `full_pipeline` degrades to `proposal_only`, `pricing_only` stops at a new
`Pricing Not Configured` alert. It should never fire in normal operation; it earns its place because
`full_pipeline` runs Modules 2 and 3 in parallel, so failing here costs nothing while failing inside
Module 3 costs a full content-generation pass first.

Any substitution is reported as `route_note` and printed in Module 4's Telegram alert, alongside
`config_warnings` and `fields_missing` — both computed since the client-fields work but never
actually surfaced, contrary to what `docs/CLIENT-DRIVE-SETUP.md` already promised.

`scripts/check-routing.js` replays all 24 tier × request × pricing combinations against the real
node source on every `npm run check`, asserting three invariants that all fail silently otherwise:
a route never exceeds its tier, Module 3 is never entered without a rate card, and no route changes
without a note explaining it. Writing it caught a wrong expectation in its own first draft.

### Feature — a client's own cover variables, their own templates, and a real table of contents (2026-08-12)

Driven by the first production client (`beumer_marcos`), whose real offers carry things the
catalog had no room for. Three gaps, one mechanism each, and none of them needs a deploy for the
*next* client.

**The `Fields` tab: variables only this client has.** A real cover carries an offer number out of
the client's ERP, an asset number, the legal name above it. The render context's vocabulary was
closed, so there was nowhere to put them. The Proposal Config sheet now has a `Fields` tab whose
rows become `{campos.<key>}` tags, with three sources: `static` (the sheet), `request` (read out
of the RFQ email) and `auto` (wired to something the pipeline already computed —
`proposal_number`, `date`, `project_title`, …).

**`request` capture is deterministic, and that is the whole point.** These values are
identifiers. A hallucinated offer number is strictly worse than a missing one: it lands on the
cover of a document that reaches a customer, it looks entirely plausible, and nobody catches it.
So `modules/proposal/field_capture.js` matches a label and nothing else — no model anywhere in the
path. It folds case, accents and the `º`/`°` ordinals; it lets several fields share one line
(header blocks pasted out of an ERP always do); it stops a value at the next label *including one
this client never declared*, so `Oferta nº: 905149921  Versión: 1.0` cannot put the version inside
the offer number; and the longest label wins, so `Project number` beats `Project`. A `required`
field the sender omitted appends `custom_fields.<key>` to `missing_fields` and marks the RFQ
**incomplete** — the run stops for review instead of shipping a cover with a hole in it.

**The `Templates` tab: more than two documents per client.** Selection was `templates[lang] ||
templates.en` against two Notion columns. A client is not one template per language — they have
product lines, and a tender answers to a different document than a spare-parts quotation. Variants
now live in the sheet with an optional keyword `match`, resolved where the sheet and the request
are both in hand, and reported in the Telegram alert because "which template did this come out
of" is the first question asked when a document looks wrong. The registry columns remain the
fallback, so no existing client changes behaviour.

**The `Client` tab: one place per client.** `proposals_folder_id`, `reference_docs_folder_id`,
`pricing_sheet_id`, plus `document_version` and `author` (which previously had *no* source at all —
the version silently defaulted to 1.0 and the version table's author column came out blank). The
split is now stateable in a sentence: **Notion says who the client is and whether they may send;
the sheet says what their document is made of.** `commercial_contact_email` cannot move — it is the
key the incoming sender is matched against, and that must resolve before anyone knows which sheet
to open. `Client Status` and `send_mode` deliberately do not move either: a copy-paste slip in a
spreadsheet must not be able to put a client into live sending. Every key falls back to its Notion
column, so nothing breaks for a client onboarded before the tab existed.

**A real table of contents.** The contents list was a generated loop without page numbers, on the
belief that the headless PDF leg could not refresh field-based TOCs. That is true of a bare
`soffice --convert-to pdf`, but the conversion runs through Gotenberg's LibreOffice route, whose
`updateIndexes` property defaults to true. The seed templates now carry a real `TOC \h \o "1-2"`
field plus `<w:updateFields/>` — without the second half the `.docx` the client opens would show an
empty list until someone pressed F9. Unnumbered front matter is pushed off the outline
(`outlineLevel: 9`) so the TOC still skips it. The render context keeps emitting `indice` /
`tabla_indice`, so a template already using the loop is unaffected. **The pagination itself is the
one thing not checkable offline** — verify it on the first real run.

**`project.title`.** A cover carries a project title, not a category. Module 1 now extracts one and
`{proyecto.titulo}` falls back to `{proyecto.tipo}`, so older templates are unaffected.

**`scripts/client-docs.js`.** Generates two documents per client from their own sheet: a setup
guide (what they are configured to do, and the exact `{campos.*}` tags their template may use) and
an RFQ email template carrying the exact labels the `Fields` tab declares. Generated rather than
written because capture matches a string: hand-maintained, the sheet and the email drift the first
time a field is added, and the failure is silent — the cover just comes out blank.

**Two checks added, both for failure modes that were invisible until a live run.** The workflow
graph checker now parses every Code node (n8n only compiles one when execution reaches it, so a
syntax error from `mirror-cores` sat dormant until an RFQ hit that branch), and it verifies the
Merge barrier has exactly one input port per tab read — a port with no feeder never receives data
and *hangs* the run rather than failing it.

### Feature — `demo@cifral.io` accepts an RFQ from anyone, in draft mode (2026-08-11)
Mark's decision, 2026-08-11: the demo address must serve `demo_client` by default and accept RFQs
from any sender, so the "send me a real RFQ and I'll send back a sample proposal" CTA is literal.
`proposal@cifral.io` stays reserved for registered clients. Full write-up: `docs/DEMO-INTAKE.md`.

**Identity now comes from the destination, not the sender.** The orchestrator used to resolve a
client by matching the incoming `From` against `commercial_contact_email`, so a prospect writing
from their own address matched no row and was rejected — the CTA could only be honoured by having
Mark forward the RFQ himself. `Build Envelope` now reads the delivery address (`Delivered-To`,
`X-Original-To`, `Envelope-To`, `To`, `Cc`) and picks a route: mail to `demo@cifral.io` resolves to
`demo_client` whoever sent it; everything else keeps the strict sender match, and an unknown sender
is rejected exactly as before. When both intake addresses appear, `demo@` wins — it is the safer
route, so an ambiguous recipient list can never buy live sending. Any address that is not one of the
two named constants stays private, so opening one alias opened nothing else.

**The Gmail trigger had to be widened, or none of the above would fire.** Its query filtered on
`subject:(RFQ OR presupuesto OR …)`, which is right for registered clients — the onboarding guide
tells them to write "RFQ" — and wrong for a public address, where a prospect writes whatever they
like and a skipped message leaves no trace anywhere. It now also matches `to:`/`deliveredto:`
`demo@cifral.io`, so everything sent there enters the pipeline whatever the subject says and the
guards do the filtering visibly, in the execution log, instead of the subject line doing it
silently. Other addresses are unaffected.

**A public address needed guards before it needed anything else.** New `Intake Guard` +
`Intake OK?` nodes sit between `Build Envelope` and the Notion read — before Module 1, because
anywhere later is too late to save the spend:

- **junk filter** (every route): autoresponders (`Auto-Submitted`, `X-Autoreply`, `Precedence:
  bulk`, out-of-office subjects in EN/ES/DE), bounces (null `Return-Path`), mailing lists
  (`List-Id`/`List-Unsubscribe`), no-reply senders and bodies with nothing in them once quoting is
  stripped. Dropped **silently** — the node returns no items, so the branch ends without firing
  Telegram. A spam wave must not become a notification flood.
- **rate limit** (public route): 3 RFQs per sender per UTC day *and* 25 per day for the address
  overall. Per-sender alone caps nothing — rotating the `From` is free — so the global ceiling is
  what actually bounds the bill. Counters live in `$getWorkflowStaticData('global')`; documented as
  a cost control, explicitly not a security boundary.
- **size cap** (public route): 10 MB, 10 attachments. Attachments are counted, never read.
- **body cap**: over 20 000 characters the body is truncated, not refused, so a genuine 40-page
  tender still produces a proposal.

Rate-limit and size refusals alert over Telegram; `Client Rejected` now reports which of the nine
reasons fired, with the sender, the intake address and a detail line. (It also had a small
formatting bug — sender and client ran onto one line — fixed in passing.)

**Draft mode is forced in code, not read from Notion.** `docs/14` §2.3 in the Vegapunk repo flagged
this before it was built, and it was half right. The *read* is fine: n8n snake_cases Notion property
names, so `send mode` does arrive as `property_send_mode`, and no rename is needed. The *default*
was not: `String(raw || 'send')` resolves any miss — renamed property, blanked select, Notion
hiccup — to `send`, which is a permissive failure mode, and a public address cannot have one. So
`demo_client` and anything arriving through `demo@` are pinned to `draft` in code, at all three
gates that stand between a rendered proposal and `drafts.send`: the orchestrator's
`Map Client Config`, its `Build Quote Draft` (the `pricing_only` branch), and Module 4's
`Compute Proposal Fields` plus its standalone `Map Client Config`. Any one of them is one refactor
away from being wrong; all three are cheap.

**Cross-client leakage, traced.** The reply now goes to a stranger, so Module 4 was checked for
whether it can put another client's material in front of them. Structurally it cannot:
`Load Client Registry` returns every row but `Map Client Config` selects exactly one and returns
only that, and every artefact Module 4 touches — template, clause library, rate card, folders —
comes from that single resolved `client_config`. On the public route it is pinned by `client_id`,
with a backstop (`open_intake_misrouted`) that refuses the run if the lookup ever lands elsewhere.
The residual risk is operational, not structural, and is written down as a rule:
`demo_client`'s Drive folder is public-facing, Module 2 grounds its writing on its
`reference_docs_folder_id`, so that folder may hold generic seed material only.

**New:** `modules/intake/intake_core.js` (routing + guards, mirrored into both nodes by
`scripts/mirror-cores.js`, 33 self-checks) and `scripts/check-intake-routing.js`, which pulls the
`jsCode` straight out of the workflow JSON and replays the whole chain — Gmail item → Build Envelope
→ Intake Guard → Notion rows → Map Client Config → Module 4 — through an n8n shim, against a
registry holding a second paying client whose field values must appear nowhere in what reaches the
render. It also walks the graph from every trigger to prove no path reaches the registry read or any
module without passing the guard. Both run in `npm run check`.

### Fix — parallel Sheets reads needed a Merge barrier, not three edges into one input (2026-07-26)
The previous fix (below) parallelized the three Proposal Config reads by connecting all three
directly into the same input index of `Build Proposal Config`, assuming n8n would wait for all
three and run it once. Two live runs proved that assumption wrong: one run left the workflow
"running" indefinitely, a second fired the entire downstream chain - PDF render, Drive upload,
Gmail send - three times, once per branch.

n8n's actual primitive for "wait for N independent branches, then continue once" is a **Merge**
node: it exposes one input PORT per branch and only fires once every port has received data. Three
separate connections into a single input index is a different thing n8n does not treat the same
way, and can behave inconsistently depending on version and on whether an upstream node took an
`onError` branch (all three reads have `onError: continueRegularOutput` set).

Added a `Merge Config Tabs` node (mode `append`, 3 inputs) between the three reads and
`Build Proposal Config` in all three workflows. Each read now connects to its own input port on the
merge node; the merge node's single output feeds `Build Proposal Config`, guaranteeing it runs
exactly once, after all three tabs have been read. The merged item's own shape is irrelevant -
`Build Proposal Config` never reads `$json`/`$input` for the tab data, it pulls each tab back out by
name (`$('Read Content Tab').all()`, etc.) - so `append` mode, the simplest option, is enough; there
is no shared key to match rows on across three tabs with unrelated schemas and unrelated row counts.

`scripts/check-workflow-graph.js` now asserts the three reads converge through `Merge Config Tabs`
specifically, not into `Build Proposal Config` directly - the exact shape of this incident.

### Fix — chained Sheets reads dropped the request envelope and quadrupled every clause (2026-07-26)
First live test surfaced two bugs that turned out to be one root cause, reported independently by
a different session working the same pipeline from the Module 4 side.

The three Proposal Config reads (Chapters/Content/Rules) were wired as a CHAIN -
`Has Config Sheet? -> Read Chapters Tab -> Read Content Tab -> Read Rules Tab -> Build Proposal
Config` - across all three workflows (00, 02, 04), instead of three parallel branches off the same
gate. A Google Sheets read node replaces its input item with however many rows it read and n8n
executes a node once per incoming item, so chaining meant each read fed the next one N times, once
per row of the tab before it. The seed `Chapters` tab has exactly 4 rows, so `Read Content Tab` was
invoked 4 times and every distinct clause, exclusion, premise and obligation in the document -
including pure static boilerplate typed straight into the template - came out duplicated exactly
4x: a 6-row obligations table printed 24 rows, a 9-row exclusions table printed 36. The cover page,
built from a different path, was untouched, which is what made the multiplier visible as clean 4x
rather than an obvious crash.

The same chaining broke `Build Proposal Config`'s output a second way: with the reads now merged
into that node's own input, its bare `$json` was never the request envelope, only ever a
spreadsheet row (a Chapters-tab row on the true branch, whatever fed it on the fallback). Both
return statements did `{ ...$json, client_config, proposal_config }`, so the final envelope lost
`data.rfq.client` / `data.rfq.project` entirely - the cover page, the email body and the Telegram
alert all rendered blank client/project fields, even though Module 1's extraction was correct and
`Build Proposal Config`'s own INPUT (before the merge) had it right.

Fixed in all three workflows: the gate now fans out to three parallel connections, each read goes
straight to `Build Proposal Config` (`scripts/mirror-cores.js`'s three targets already read each
tab by node name, `$('Read Content Tab').all()` etc., so parallelizing needed no code change
there). In Modules 2 and 4, `Build Proposal Config` now spreads `trig`
(`$('Execute Workflow Trigger').first().json`) instead of `$json` - the orchestrator's copy was
already doing this correctly, which is why its client/project data never broke.

Also added, as defense in depth: `resolveProposalConfig()` now deduplicates clause rows by `id`,
keeping the first occurrence and warning on the rest - `id` is documented as a stable, citable
reference ("premise 7"), so two rows can never legitimately share one, regardless of whether the
duplication comes from a wiring bug or someone pasting a sheet's contents in twice by hand.

New: `scripts/check-workflow-graph.js`, wired into `npm run check`. It asserts no two row-reading
nodes (Sheets, Notion) connect directly into one another anywhere in the workflow graph, and that
`Build Proposal Config` never spreads bare `$json`. Neither of these bugs was catchable by the
existing offline module self-checks - those call `resolveProposalConfig()` directly with an
in-memory object and never exercise n8n's item-per-execution model - so this is a permanent guard
against the exact shape of bug that only a live run exposes.

### Fix — Module 2's agent chain lost Plan Chapters' data past the first agent (2026-07-26)
Two independent reference bugs compounded into "A1 writes something, A2 and A3 write nothing."

`A2` and `A3` read Plan Chapters' fields (`langName`, `tier`, `rfq`, `briefs`, `tables_*`,
`rules_text`) through bare `$json`. That only works for `A1`, whose immediate predecessor really
is Plan Chapters - `$json` always means "the node right before this one," and for A2 that is A1,
for A3 that is A2. Neither carries those fields, so the expressions silently resolved to
`undefined`. Editing them by hand in the n8n UI to `$('Plan Chapters').item.json...` traded that
bug for a second one: `.item` needs n8n to trace paired-item lineage back through the Agent nodes
in between, which those nodes don't reliably preserve, so the field showed stuck on the unresolved
literal instead of the interpolated prompt. Both are now `$('Plan Chapters').first().json...`,
which needs no lineage - it just reads that node's last output - matching what A4, Assemble Draft
and Apply QA Patches already did correctly.

Separately, `Plan Chapters` itself read `proposal_config` from `$json`, but `Aggregate Grounding`
and `No Grounding` each rebuild their item from scratch (`{ grounding, grounded_on }` only) and
drop everything upstream, `proposal_config` included. Every brief came back empty, A1 was asked to
write zero sections, and correctly wrote zero sections - the symptom looked like a broken agent
but the agent was doing exactly what an empty brief told it to. `Plan Chapters` now reads
`proposal_config` via `$('Build Proposal Config').first().json`; `grounding` was already correct,
since that field really does come from the immediate predecessor.

### Fix — PDF attachment had Gotenberg's internal trace id as its filename (2026-07-26)
`Convert To PDF` called Gotenberg with no filename hint, so the response's `Content-Disposition`
carried Gotenberg's own trace id (a UUID-looking string) instead of the proposal's name — it showed
up as the PDF's filename wherever it landed, which read as unpolished next to the correctly-named
`.docx`. Two fixes, so the result does not depend on Gotenberg's behaviour alone: the request now
sends a `Gotenberg-Output-Filename` header with `doc_name`, and `Collect Artifacts` explicitly sets
`binary.pdf.fileName` (and `docx.fileName`, defensively) to the computed `pdf_file_name` /
`docx_file_name` before either reaches Gmail — the actual attachment name always comes from the
binary object's own property, not from whatever an intermediate service decided to call it.

### Phase 12 — Chapter catalog, five-stage generation, and per-client config in Drive (2026-07-26)
Seven narrative sections covered roughly 40% of a real capital-modernization proposal. The reference
document — a 26-page airport baggage-handling modernization — has 9 top-level chapters and three
levels of hierarchy; Cifral produced 4-8 flat pages. Worse, the structure was baked into two places
at once (a hardcoded `NARRATIVE_SECTIONS` array, mirrored, plus whatever chapters the client's `.docx`
happened to contain), so adding a chapter took five coordinated edits.

- **`schemas/chapter-catalog.json` — the closed vocabulary.** 14 body chapters plus front matter and
  annexes; 105 render keys, 24 tables. Each entry declares its tier, owning agent, content type and
  scope gate. Chapter ids *are* render keys, so the Phase 11 tag contract is unchanged — there are
  just more of them. **New chapters**: executive summary, background, technical solution, operational
  continuity / safety / risk, scope boundaries, next steps. **Split**: scope of supply (deliverables)
  from project execution (services) — they are read by different people for different reasons.
- **Three tiers over one structure.** A quotation (4-8 pp), B standard proposal (15-25 pp), C tender
  (30-60 pp + annexes). Not three documents: one catalog, three filters.
- **Per-client configuration moved to Google Drive.** A `Proposal Config` sheet in the client's own
  folder holds their chapter selection, renames and ordering (`Chapters`), their clause library,
  exclusions, assumptions and client obligations (`Content`), and their house style (`Rules`). Same
  split already used for pricing: the repo owns the formula, Drive owns the data. n8n cannot read
  repo files at runtime, and a salesperson should not need a deployment to add an exclusion. Clients
  with no sheet keep working on catalog defaults, with a warning on the run.
  New registry column `proposal_config_sheet_id`; full reference in `docs/CLIENT-DRIVE-SETUP.md`.
- **Boilerplate stopped going through the LLM.** About half of a proposal is contract text —
  warranty, liability, exclusions, general conditions. It used to be generated, which is
  hallucinating a contractual commitment for no benefit. It now travels from the client's spreadsheet
  into the same paragraph stream as generated text, through the same parser, with no model in
  between. The QA agent sees it as read-only and a patch aimed at it is refused.
- **Module 2 became five stages.** The single agent had `maxTokensToSample: 8192` and had to return
  seven JSON keys; a 20-30 page document does not fit in one reply, so the ceiling was arithmetic,
  not prompting. Now: **A5** resolves chapters and clauses (deterministic — a token matcher, because
  this stage decides which liability text ships), then **A1** technical → **A2** execution and risk →
  **A3** executive and commercial, each with its own budget, then **A4** reviews the assembled draft
  for contradictions, invented commitments and uncovered RFQ requirements. A1→A2→A3 run in sequence
  rather than in parallel: the execution plan must match the architecture, and a summary must
  summarise rather than guess.
- **Grounding widened.** Was 1 500 characters per document and 6 000 total — about a thousand words
  to ground a document that should run to eight thousand. Now 6 000 / 24 000 across up to 10
  documents, split per agent.
- **Gapless numbering.** Chapter numbers are assigned *after* empty and out-of-scope chapters are
  dropped, and the headings use Word multilevel numbering rather than typed numbers, so a proposal
  that omits chapters still reads 1, 2, 3. The contents list is a deterministic loop over what
  actually rendered, not a Word TOC field — the PDF leg runs through headless LibreOffice, which does
  not refresh field TOCs, so a field-based one would ship empty.
- **Version control is calculated** from the same date as the cover and footer. In the reference
  document these had drifted apart (footer 03/02, version table 16/02) — the kind of defect only
  manual assembly produces. The duplicated payment-terms block in the reference master is likewise
  one clause now.
- **Seed `.docx` templates, generated from the catalog** (`npm run templates`). A superset of 105
  conditional blocks that has to agree with the render context key for key is not a thing to maintain
  by hand. Onboarding copies a seed and restyles it; templates still live per-client in Drive.
- **Module 1 extracts what the new chapters need**: current situation, objectives, operational
  constraints, tender requirements with clause references (for the compliance matrix), risks, hot
  buttons, reference documents, and a tier hint. Also `phone`, which the template has had a tag for
  since Phase 11 and never had data for.
- **`scope-catalog.json` v2**: `narrative_section` (one string) → `sections` (an array). The old
  one-to-one mapping is what fused deliverables with execution.
- **`npm run check`** runs everything offline: three core self-checks, the mirror drift check, and
  four real docxtemplater renders reading the real seed config. **`npm run mirror`** copies the three
  logic cores into the five n8n Code nodes that run them — the drift checker used to only detect
  divergence, never fix it.

> **Templates must be rebuilt.** Chapter ids changed, so Phase 11 templates no longer match. There is
> no automatic migration, same as the Google Docs → docxtemplater move; `chapter-catalog.json`
> carries a `legacy_key_map` and `docs/TEMPLATE-GUIDE.md` is rewritten.

### Phase 11 — Document engine: Google Docs text replacement → .docx rendering (2026-07-25)
The proposal came out flat, and not by accident: `replaceAll` on a Google Doc can only swap *text
for text*, so a generated chapter inherited the styling of the paragraph its token sat in — no real
headings, bullets faked with a `•` character, the price summary as three bullet lines. Headings,
lists and tables are **structure**, and structure cannot travel through a text placeholder. Module 4
now renders the client's own **`.docx`** with docxtemplater instead.

- **Templates are Word files.** `template_id_en` / `_es` now point at a `.docx` in the client's Drive
  folder rather than a Google Doc. The client's styles, headers, footers, logo and page setup are
  preserved byte-for-byte instead of being degraded by a Docs conversion on the way in. **Existing
  templates must be rebuilt — there is no automatic migration** (`docs/TEMPLATE-GUIDE.md` is rewritten
  from scratch).
- **Structured render context.** `Compute Proposal Fields` stopped emitting pre-formatted strings and
  now emits paragraphs, bullet arrays and table rows. Module 2 is untouched: a deterministic parser
  turns its plain-text sections (whose format its prompt already pins) into that structure, which
  keeps the inter-module contract stable and costs no extra tokens.
- **Out-of-scope chapters vanish with their headings** via `{#has_*}` blocks — the thing the old
  token scheme explicitly could not do, and the reason `TEMPLATE-GUIDE.md` used to tell authors to
  type headings in UPPERCASE inside the generated text.
- **Real price table.** Module 3 gained `lines[]` (`modules/pricing/pricing_core.js` + its mirrored
  node), one row per priced category. Lines carry both the internal cost basis and the customer-facing
  `sell_amount`; per-line rounding residue is absorbed into the largest line so **the column sums to
  the total exactly**.
- **The subtotal is no longer printed in the document.** It is the pre-margin cost basis, and this
  document is forwarded by the reseller to their own end customer — printing it beside the total
  handed the customer the reseller's margin. The reseller still sees it in the quote email.
- **Money is localised.** `12345.6 EUR` became `12.345,60 €` / `€12,345.60` via `Intl.NumberFormat`,
  matching the proposal's language rather than the server's locale.
- **Both files are attached** — the editable `.docx` the reseller tweaks, and the PDF they forward.
  PDF conversion moved to **Gotenberg** (LibreOffice), which also fixes the pre-existing bug where
  `Convert to PDF` was a plain Drive download with no conversion, producing a Google Doc export named
  `.pdf`.
- **New `modules/proposal/render_context.js`**, mirrored into the node between `PROPOSAL RENDER CORE`
  markers exactly like the pricing core, checkable offline with `node modules/proposal/render_context.js`.
  `schemas/scope-catalog.json`'s dead `template_block` field (`MATERIALS`, `INSTALLATION`, … read by
  nothing) is repopulated with the real docxtemplater flags.

> ⚠️ **Before deploying:** install the community node `n8n-nodes-docxtemplater` (Settings → Community
> Nodes) and add a `gotenberg/gotenberg:8` service beside n8n. Both are covered in `DEPLOYMENT.md`,
> which also gains a Module 4 troubleshooting table.

Two constraints of the render node shaped the design and are worth knowing before editing a template:
it exposes no `nullGetter`, so a tag with no matching key prints the literal word `undefined` (the
context is therefore total — every key always present); and it parses tags as **Jexl** expressions, so
key names avoid `-` and loops iterate named objects rather than bare strings.

**The trap to know about:** loop tags written *inline* (`{#items}{texto}{/items}`) repeat only the
content inside the paragraph and concatenate every item into one run-on paragraph. Tags must sit
**alone on their own lines** for `paragraphLoop` to repeat the whole styled paragraph. This is the
difference between a native bullet list and the exact flat text this phase set out to eliminate, and
it is the first thing to check when a list looks wrong.

### Phase 10 — Live sending: send-as alias + in-thread replies (2026-07-25)
Quotes and proposals are now **delivered**, not parked as Gmail drafts, and they come from a Cifral
address instead of the personal mailbox that receives the RFQs:

- **Send-as alias.** `Map Client Config` derives `client_config.from_alias` from `Client Status` —
  `trial` → `demo@cifral.io`, everything else → `proposal@cifral.io` — and Module 4 / the quote
  branch pass it as the Gmail node's `fromAlias`. This finally gives `trial` behaviour of its own;
  it was cosmetic before.
- **Draft-then-send, not send.** The Gmail node's *Send Message* operation rebuilds `From` from the
  authenticated mailbox and silently discards any alias, while *Create Draft* honours `fromAlias`
  and `threadId`. Delivery is therefore `Create Draft` → new **`Send Draft`** / **`Send Quote`** HTTP
  node calling `gmail/v1/users/me/drafts/send`.
- **Replies land in the RFQ thread.** `Build Envelope` now keeps the trigger's `threadId`,
  `Message-ID` and a `Re: <original subject>` line in a new per-request `email_context`, carried
  beside `client_config` into Module 4. Gmail threads only when the thread id *and* the subject
  match, so the synthetic `Proposal PROP-… — Company` subject is now a fallback for runs with no
  thread (chat trigger, standalone module calls) rather than the default.
- **`send_mode` kill switch.** New per-client Notion column (`send` | `draft`, default `send`).
  `draft` skips the send step and restores exactly the previous behaviour — the per-client rollback
  for the first production deploy. DDL is in `CLIENT-REGISTRY-SCHEMA.md` and **not yet applied**.
- **`appendAttribution: false`** on both mail nodes — outgoing client mail was carrying n8n's own
  promotional footer.
- **Output records delivery.** `proposal-assembly.schema.json` gains `sent`, `sent_message_id`,
  `from_alias`, `thread_id`; the Telegram alerts now say `SENT ✅` / `drafted 📝` with the From and
  To addresses instead of always claiming a draft was created. `sent: false` always means
  "deliberately not sent" — a genuine send failure fails the node and the run.
- **Recipient guard hardened.** Gap G1 ("never the extracted end customer") now protects a real
  send, and Module 4 additionally throws if no `from_alias` resolved rather than falling back to the
  raw mailbox address. `TESTING-MANUAL.md` gains scenarios 13–15 (alias by status, in-thread reply,
  live sending + rollback) and promotes the recipient-safety check to every regression pass.

> ⚠️ **Before deploying:** verify `demo@cifral.io` and `proposal@cifral.io` as "Send mail as"
> addresses on the Gmail account (`DEPLOYMENT.md`), and link the Gmail OAuth2 credential to the two
> new HTTP Request nodes. Gmail rejects an unverified alias at send time, not at draft time.

Known unrelated defect, left for the document-engine work: Module 4's `Convert to PDF` node is a
plain Drive download with no `googleFileConversion` option, so the "PDF" attachment is the raw Google
Doc export with a `.pdf` name.

### Phase 9.1 — Extractor truncation + wider boolean coercion (2026-07-25)
Manual test with a real, detailed RFQ (12 technical requirements + full Included/Excluded scope
list) failed at the Information Extractor with `OUTPUT_PARSING_FAILURE` (`` ```json {...` `` not
valid JSON):
- **Root cause: token cap too low.** Module 1's Anthropic Chat Model had `maxTokensToSample: 800`,
  enough for the small demo fixture but not a real multi-item RFQ; the model's JSON got cut off
  mid-object (`"engineering": "yes"` then nothing), which is unparseable. Raised to `4000`.
- **Wider boolean coercion.** The same failed generation showed the model drifting to `"yes"`
  instead of `"true"` for scope values. `toBool()` in the Validate node now also accepts
  `yes/no`, `included/excluded`, `y/n`, `1/0` (case-insensitive), not just `true/false`, so scope
  extraction survives normal LLM wording variance instead of only the exact literal expected.

### Phase 9 — Multi-client identification, reply-to-sender, status gating (2026-07-24)
The orchestrator now supports more than one client and stops hardcoding `demo_client`:
- **Identify by sender email.** Build Envelope reads the Gmail sender; Map Client Config matches it to
  the registry row via `commercial_contact_email` and sets `client_id` from that row. The chat trigger
  (no sender) falls back to `demo_client` for testing.
- **Reply to the original sender.** `client_config.reply_to` = the actual sender; Module 4's draft and
  the pricing-only quote are addressed there (fallback: `commercial_contact_email`), never the
  extracted end customer.
- **Status gating.** A new `Client OK?` gate rejects unknown senders and `paused`/`churned` clients
  with an admin Telegram alert (`Client Rejected`); `active`/`trial` proceed, and the status is shown
  in the success alerts. Onboarding a trial client is now just a registry row (their sender email in
  `commercial_contact_email`, `Client Status` = `trial`, tier + folder/sheet ids).

### Phase 8 — Manual-test fixes + formatting polish (2026-07-24)
Reconciled fixes found during manual testing of the live workflows, plus proposal formatting:
- **Notion property prefix.** The n8n Notion node returns properties flattened as
  `property_<snake_cased_name>`. The orchestrator's "Map Client Config" now reads those keys, and the
  standalone fallbacks in Modules 1–4 tolerate both forms.
- **Pricing node is JavaScript.** Replaced the Python/Pyodide "Compute Pricing" with plain JS (the
  self-hosted n8n has no Python). `modules/pricing/pricing_engine.py` → `modules/pricing/pricing_core.js`
  (same formula, `node …/pricing_core.js` to check). Module 3 reads the sheet tab named `Pricing`.
- **Module 4 Copy Template** sets `sameFolder:false` so the generated doc lands in the proposals
  folder, not next to the template.
- **Module 2 empty-folder guard.** `Search Reference Docs` now has *Always Output Data* + a `Found
  Docs?` IF, so an empty reference-docs folder skips extraction instead of stalling the flow.
- **Scope extraction fixed (root cause: string booleans).** The Information Extractor returns
  `scope_of_supply` values as strings (`"true"`/`"false"`), so Module 1's strict `=== true` check was
  discarding every value and falling back to defaults — collapsing installation/commissioning/PM/
  shipping to `false` and under-pricing full-scope RFQs. The Validate node now coerces string
  booleans and normalizes `language` (`"English"` → `en`). The extractor prompt also maps the
  reseller's Included/Excluded phrases to catalog keys (installation supervision → installation,
  commissioning support → commissioning, freight → shipping, fabrication/procurement → materials, …).
- **Proposal formatting.** Module 2 emits plain text (no markdown) with `•` bullets and no self-made
  headings; Module 4 gives optional sections an uppercase heading and renders the pricing block as a
  self-contained "Economic Proposal" chapter. `docs/TEMPLATE-GUIDE.md` rewritten with a concrete,
  professional template layout (and a note on the Docs-API upgrade for native bullets).

### Phase 7 — Service tiers, per-request scope, Sheets pricing, manual testing (2026-07-23)
Reworked the demo after review, without changing the module boundaries:
- **Three service tiers instead of four module checkboxes.** Notion registry: added `service_tier`
  (`pricing_only` / `proposal_only` / `full_pipeline`) and `pricing_sheet_id`; dropped the four
  `module_*` checkboxes and `plan_tier`. The orchestrator now **routes per request**: Module 1
  extracts `request_type`, and the orchestrator branches (pricing_only → M3 + quote draft;
  proposal_only → M2+M4, no pricing; full_pipeline → M2 ∥ M3 → M4), falling back to `service_tier`.
- **Per-request scope of supply.** New `schemas/scope-catalog.json` defines the canonical scope
  items. Module 1 extracts a `scope_of_supply` map; it drives pricing lines (M3), narrative sections
  (M2) and template blocks (M4) together. Module 4 renders in-scope `{{SECCION_*}}` tokens and removes
  out-of-scope ones; it also prints a visible Scope-of-Supply block for the reviewing reseller.
- **Pricing data moved to Google Sheets.** Module 3 reads the rate card at runtime from the client's
  pricing Google Sheet (`pricing_sheet_id`); removed `example_client_config.json`.
  `modules/pricing/pricing_engine.py` stays as the versioned, self-contained reference formula.
- **Manual testing replaces the Python test suite.** Removed `scripts/` (`deploy_workflows.py`,
  `smoke_test.py`, `check_pricing_sync.py`, `requirements.txt`) and `modules/pricing/tests/`. Added
  `docs/TESTING-MANUAL.md`.
- **New docs:** `PRICING-SHEET-TEMPLATE.md`, `TEMPLATE-GUIDE.md` (master template with conditional
  section tokens), `RESELLER-EMAIL-GUIDE.md` (request instructions + email templates). Updated
  README, ARCHITECTURE, DEPLOYMENT, ONBOARDING, CLIENT-REGISTRY-SCHEMA.

### Phase 6 — Smoke test + deploy script (2026-07-21)
- `scripts/smoke_test.py`: runs a demo_client RFQ fixture through all four contract stages,
  validating each against `schemas/*.json`, executing the pricing engine for real, and asserting
  the business invariants (recipient fix G1, missing-field flagging G3, language template G2,
  deterministic numbering B2). All checks pass offline.
- `scripts/deploy_workflows.py`: pushes `workflows/*.json` to n8n via REST (POST create / PATCH
  update by name), env-gated on `N8N_API_URL`/`N8N_API_KEY` (refuses to run without them),
  retries with exponential backoff, and a `--relink` mode that repoints the orchestrator's
  Execute Workflow nodes to deployed sub-workflow ids by name.
- `scripts/requirements.txt`.

### Phase 5 — Orchestrator + Notion registry (2026-07-21)
- Applied the client-registry schema to the Notion "Projects" DB and seeded the `demo_client` row.
- `workflows/00-orchestrator-end-to-end.json`: resolve-once client config, M1 → (M2 ∥ M3) → M4,
  with an incomplete-RFQ branch to a Telegram review alert.

### Phase 4 — Pricing engine (2026-07-21)
- `modules/pricing/pricing_engine.py` + 14 pytest cases + `example_client_config.json`.
- `workflows/03-pricing-commercial-logic.json` embeds the tested core via Pyodide;
  `scripts/check_pricing_sync.py` guards against drift (fixes gap G5).

### Phase 3 — Module 2 content generation (2026-07-21)
- `workflows/02-technical-content-generation.json`: per-client document grounding (fixes gap G4)
  with a graceful no-folder fallback.

### Phase 2 — Modules 1 & 4 workflows (2026-07-21)
- `workflows/01-data-collection-validation.json`: deterministic missing-field flagging (gap G3),
  snake_case keys (bug B1).
- `workflows/04-proposal-assembly.json`: recipient fix (gap G1), language-driven template (G2),
  deterministic proposal number (B2), config-driven folder/chat.

### Phase 1 — Scaffold, schemas, docs, gap analysis (2026-07-21)
- Created repo structure: `workflows/`, `schemas/`, `modules/pricing/`, `reference/`, `docs/`,
  `scripts/`.
- Added `reference/DEMO-01-RFQ_reference_export.json` (the legacy monolith export, do not modify) and
  `reference/legacy-demo-analysis.md` (written analysis of the 5 known gaps + 4 additional bugs found:
  wrong draft recipient, dead `language` field, no missing-field flagging, ungrounded content,
  untested logic, silent `quantity` key mismatch, non-deterministic proposal numbering).
- Defined the shared contract envelope (`client_id` / `client_config` / `data` / `status` / `errors`)
  and JSON Schemas for all four module I/O contracts under `schemas/`.
- Wrote `README.md`, `docs/ARCHITECTURE.md`, `docs/CLIENT-REGISTRY-SCHEMA.md`, `docs/DEPLOYMENT.md`,
  `docs/ONBOARDING.md`.
- Key architecture decisions: thin separate orchestrator (Module 4 stays a pure assembly module);
  resolve `client_config` once and pass it through; repurpose the empty Notion "Projects" DB as the
  client registry (separate from the untouched "Customers Manager" CRM).
