# The public intake — `demo@cifral.io`

`demo@cifral.io` accepts an RFQ from **anyone**, resolves it to the `demo_client` tenant, and
**answers it — automatically, in the sender's own thread, with the `.docx` and the PDF attached.**
`proposal@cifral.io` is unchanged: registered clients only, matched by sender.

This is what makes the Demo Reflex CTA literal. The offer in every outbound message is *"send your
RFQ to demo@cifral.io and try it yourself"*, and that only means anything if the answer arrives
without Mark being awake. Two decisions got it there:

- **2026-08-11** — the address was opened. Any sender resolves to `demo_client`; before that, a
  prospect writing in from their own address matched no registry row and was rejected. The reply
  was held as a draft.
- **2026-08-18** — the reply is **sent**. The draft was the right default for an address nobody had
  been told about; it is the wrong one for an address printed in outbound copy, because a demo that
  answers when someone gets round to it is not a demo. The one switch that decides this is
  `DEMO_SEND_MODE` in `modules/intake/intake_core.js` (§3).

Nothing about the guards was relaxed to get there. The rate limits, the junk filter, the size caps
and the tenant isolation backstop all still run, and all still run **before** the spend.

---

## 1. How a message is routed

**By the address it was delivered to, not by who sent it.**

| Delivered to | Client | Sender must be known? | Replies |
|---|---|---|---|
| `demo@cifral.io` | always `demo_client` | **no** — anyone | per `DEMO_SEND_MODE` (currently **sent**) |
| `proposal@cifral.io` | whichever registry row's `commercial_contact_email` matches the sender | **yes** — unknown senders rejected | per `send_mode` |
| anything else | same as `proposal@` | yes | per `send_mode` |
| chat trigger (no sender, no destination) | `demo_client` | n/a | per `DEMO_SEND_MODE` |

Three details that are load-bearing:

- **Envelope headers are read before the visible ones.** `Delivered-To` is what Gmail actually
  delivered to; `To` is only what the sender typed. Alias delivery routinely puts the alias in `To`
  and the underlying mailbox in `Delivered-To`, so both are scanned, along with `Cc`,
  `X-Original-To` and `Envelope-To`.
- **If both intake addresses appear, `demo@` wins.** It is the containing route: the demo tenant,
  the demo Drive folder, the demo rate card and the intake guards. An ambiguous recipient list can
  therefore never be the thing that serves a *registered client's* material to a stranger — which
  is the loss that would actually matter. What it does buy is a demo document; that is the address
  doing its job.
- **Opening `demo@` opened nothing else.** Any address that is not one of the two named constants
  keeps the registry route, so a future alias is private until someone deliberately adds it.

Routing lives in `modules/intake/intake_core.js` (`resolveIntake`), mirrored into the orchestrator's
**Build Envelope** node.

### The Gmail trigger had to be widened too

Routing only gets a say over messages the trigger picked up. Its query was
`subject:(RFQ OR presupuesto OR proposal OR quote OR estimate)` — correct for registered clients,
who write "RFQ" in the subject because the onboarding guide tells them to, and wrong for a public
address: a prospect answering the CTA writes whatever they like, and a message the trigger skips
leaves no trace anywhere at all. It is now

```
(to:demo@cifral.io OR deliveredto:demo@cifral.io OR subject:(RFQ OR presupuesto OR proposal OR quote OR estimate))
```

so **everything** addressed to `demo@` enters the pipeline whatever its subject, and the guards do
the filtering — visibly, in the execution log — instead of the subject line doing it silently. Other
addresses are unaffected.

## 2. The guards

A public address is an open invoice: every RFQ that gets through spends LLM tokens and Drive calls
on a stranger's say-so. Four gates run in the **Intake Guard** node, which sits between
`Build Envelope` and the Notion registry read — *before* Module 1, because anywhere later is too
late to save the money.

| # | Guard | Limit | On trip |
|---|---|---|---|
| 1 | **Delivery mode** | one constant decides, in code, for the whole demo tenant | — (see below) |
| 2 | **Rate limit** | 3 RFQs per sender per UTC day; 25 per day for the address overall | refused + Telegram |
| 3 | **Junk filter** | autoresponders, bounces, mailing lists, no-reply senders, empty bodies | dropped **silently** |
| 4 | **Size cap** | 10 MB per email, 10 attachments | refused + Telegram |
| 5 | **Tenant isolation** | the open route must resolve to `demo_client` and nothing else | refused + Telegram |

Plus a body cap: over 20 000 characters the body is **truncated, not refused**, so a genuine
40-page tender still produces a proposal and simply stops paying past the cap.

### Why the numbers are what they are

- **Per-sender alone caps nothing.** Rotating the `From` costs an attacker nothing, so the global
  daily ceiling is the limit that actually bounds the bill. Both are enforced.
- **Junk is dropped silently, on purpose.** A spam wave must not become a Telegram flood. The n8n
  execution log still records every drop and its reason. Refusals that Mark can *act* on — rate
  limits, oversize — do alert.
- **Only the public address is metered.** A registered client on `proposal@` passes everything but
  the junk filter; they are paying for throughput and metering them would be a regression. The junk
  filter applies everywhere, because an out-of-office was never a valid RFQ on any address.
- **Attachments are counted, never read.** Module 1 sees subject + text only. The cap is generous
  enough that a real RFQ with drawings attached still goes through.

Raise or lower any of these in `INTAKE_LIMITS` at the top of `modules/intake/intake_core.js`, then
`npm run mirror`.

### Where the counters live

`$getWorkflowStaticData('global')` on the orchestrator — n8n persists it after each production
execution, so a counter this small needs no external store. Two honest caveats:

- it is **per workflow**, so a second orchestrator would keep its own tally;
- two executions overlapping within the same tick can both read the pre-increment value.

Both are acceptable for a cap whose job is to bound a bill. **It is not a security boundary.** If
`demo@` ever needs one, the counter belongs in a store with atomic increments, not in workflow
static data.

## 3. Guard 1 — one switch, in code, never read from Notion

```js
// modules/intake/intake_core.js
const DEMO_SEND_MODE = 'send';   // or 'draft'
```

That constant is the whole of it. Flip it, run `npm run mirror`, re-import
`workflows/00-orchestrator-end-to-end.json`, and the public address stops answering by itself —
without editing a gate, a registry row or an IF node.

**Why it is in code and not in the registry.** `docs/14` §2.3 flagged the risk before any of this
was built: the registry property is named `send mode` (with a space), the docs call it `send_mode`,
and *"a key that does not match does not raise, it yields `undefined`, and `undefined` is
interpreted as the permissive option."* Checked, and the conclusion was not quite the one feared:

- **The read is fine.** n8n's Notion node snake_cases property names, so `send mode` does arrive as
  `property_send_mode`. Renaming the Notion property is not necessary.
- **The default was not.** `String(raw || 'send')` resolves *any* miss — property renamed, select
  blanked, Notion hiccup — to a value nobody chose. A public address must not have its behaviour
  decided by an accident, in **either** direction.

So the demo tenant's mode is decided here and the registry value is not consulted for it. That was
true when the answer was `draft` and it is still true now the answer is `send`; only the answer
changed. Whatever `send mode` says on `demo_client`'s row has no effect.

### How the value travels

One decision point, and then everybody reads it:

1. `resolveIntake()` puts `demo_send_mode` on the envelope, on **every** route — the demo tenant is
   also reachable through the registry route when Mark forwards a prospect's RFQ from his own
   address, and both paths have to reach the same answer.
2. The orchestrator's **Map Client Config** resolves `client_config.send_mode` once: from
   `DEMO_SEND_MODE` for the demo tenant, from the registry row for everyone else. It also sets
   `demo_tenant`, which is what makes the document and the covering email label themselves.
3. Every gate after that — Module 4's **Compute Proposal Fields**, the orchestrator's **Build Quote
   Draft** and **Build Missing Info Reply** — *reads* that value instead of re-deriving one.

Those gates used to re-derive `'draft'` from `open_intake`, which is what made a rollback a
four-node edit. They now normalise instead, and they **fail closed**: anything that is not the
literal string `send` (missing, empty, an unexpected Notion object shape, a typo) becomes a draft.
A value lost in a future refactor therefore costs a delivery, never buys one.
`Send Mode?` and `Send Quote?` are plain equality tests against `'send'` for the same reason.

The same rule covers a **partial re-import**: an envelope built by a `Build Envelope` older than
this change carries no `demo_send_mode`, and `Map Client Config` reads that as `draft`. Of the two
ways to be wrong, a demo that has gone quiet announces itself in Telegram; a demo that sends when it
should not announces itself in a stranger's inbox.

`scripts/check-intake-routing.js` asserts all of it against the real node source: that every gate
agrees with `DEMO_SEND_MODE`, that the registry row saying the opposite changes nothing, that
Module 4's standalone copy of the constant has not drifted, and that four kinds of broken
`send_mode` all park the message.

### What a stranger receives

Sending to a stranger made the *wording* load-bearing, in a way a draft never did — a human reading
a draft supplies the context; a prospect opening an attachment does not. So:

- **The covering email says it is a demonstration**, in the language the RFQ was written in. It used
  to be one hard-coded English paragraph on the Gmail node, addressed to a reseller reviewing a
  proposal "before it goes to the customer" — wrong on both counts once the reader is the prospect.
  It is composed in **Compute Proposal Fields** now, and asserted by the checks.
- **The document says it too** — on the cover, in the running header, in the footer of every page,
  and in a notice page of its own. See `templates/demo-proposal-template-{es,en}.docx` and
  [`TEMPLATE-GUIDE.md`](TEMPLATE-GUIDE.md).
- **The `pricing_only` answer prints no subtotal.** The reseller version does, because a reseller is
  entitled to their own cost basis; on the public route the reader is the customer, so only sell
  prices go out. The document itself never carried a subtotal tag at all.

## 4. Guard 5 — what a stranger can and cannot see

The reply now goes to an unknown person, so the question is whether Module 4 can put another
client's material in front of them. Traced end to end:

**Cannot leak, structurally.** `Load Client Registry` returns every row, but `Map Client Config`
selects exactly one and returns only that one. No other row travels downstream. Everything Module 4
renders — `.docx` template, clause library, rate card, proposals folder, reference-docs folder — is
read from that single resolved `client_config`. On the open route it is pinned to `demo_client` by
`client_id`, and a backstop refuses the run outright if the lookup ever resolves to a different row
(`open_intake_misrouted`). `scripts/check-intake-routing.js` runs the real node code against a
registry holding a second, paying client and asserts that not one of that client's field values
appears anywhere in what reaches the render.

**Can leak, operationally — the one thing to keep an eye on.** `demo_client`'s Drive folders are
served verbatim to strangers. Module 2 grounds its writing on up to 10 documents from
`reference_docs_folder_id`, and quotes from them end up in the generated text. So:

> **Rule: `demo_client`'s Drive folder is public-facing. Its reference-docs folder, Proposal Config
> sheet, pricing sheet and `.docx` templates may contain only generic seed material — never a real
> client's proposal, rate card, clause text or logo.**

Nothing in code can enforce that; it is a property of what is in the folder. It is the one thing to
re-check before pointing outbound traffic at `demo@`, and again whenever anything is added to that
folder. Onboarding a real client means a **new registry row**, never reusing the demo tenant's.

This rule was already the load-bearing one when the reply was a draft; sending makes it the *only*
one. A human no longer reads the document before the prospect does, so anything in that folder is
one RFQ away from a stranger's inbox.

Two lesser notes:

- The recipient is the actual sender, and the reply threads into their original message. It is
  addressed from `demo@cifral.io`, which must be a **verified 'Send mail as' alias** on the Gmail
  account that owns the credential — an unverified alias survives draft creation and fails at
  `drafts.send`, which is exactly the step that used not to run.
- The document prints sell prices only; the internal `subtotal` is deliberately not in the render
  context, and the public quote email drops it too.

## 5. Testing it

### Offline — runs in seconds, no n8n

```bash
npm run check
```

Three of its steps cover this:

- `node modules/intake/intake_core.js` — routing, the guards and the demo switch in isolation.
- `node scripts/check-intake-routing.js` — the end-to-end check. It pulls the `jsCode` **straight
  out of the workflow JSON** and executes it through a small n8n shim in graph order —
  Gmail item → Build Envelope → Intake Guard → Notion rows → Map Client Config → Module 4's
  Compute Proposal Fields — so it tests what actually ships, not a copy. It asserts a stranger's
  RFQ to `demo@` produces a proposal addressed to that stranger, from the demo template, with
  every gate resolving to `DEMO_SEND_MODE` while the registry row says the opposite; that a
  garbled `send_mode` still parks the message; that the covering email names itself a
  demonstration and answers a Spanish RFQ in Spanish; that `proposal@` still rejects the same
  stranger and still serves a registered client their own template and their own kill switch; and
  that no path from any trigger reaches the registry read or a module without passing the guard.
- `npm run render` — six real docxtemplater renders, two of them against the **demo templates**
  that go out to strangers.

### Live — do this before publishing the address anywhere

Offline checks prove the logic; only a live run proves the alias, the credential and Gmail's
threading. **Sending raises the stakes of step 1: there is no longer a human between the render and
the prospect.**

1. Confirm `demo_client`'s registry row is `Client Status = trial`, and — the load-bearing one —
   that its Drive folders hold **only generic material** (§4). Read the reference-docs folder, the
   Proposal Config sheet and the pricing sheet, not just their names.
2. Confirm `demo@cifral.io` is a **verified 'Send mail as' alias** on the Gmail account that owns
   the n8n credential. An unverified alias creates the draft happily and fails on `drafts.send`,
   which is the step that never used to run.
3. From an address that is **not** in the registry — and that you can read — email
   `demo@cifral.io` with a real RFQ. Do this once with a Spanish RFQ and once with an English one.
4. Expect, within a few minutes: a Telegram `🆕 Demo used` lead alert, a second alert reading
   **`proposal SENT ✅`**, a `.docx` + PDF in the demo proposals folder, and **the mail in that
   inbox** — threaded onto your message, from `demo@cifral.io`, with both files attached.
5. Open it as the prospect would. The covering mail must be in the RFQ's language and must say it
   is a demonstration; the PDF's cover, header and footer must carry the demo marking; the contents
   list must have real page numbers.
6. Send a fourth RFQ from the same address the same day and confirm the rate-limit Telegram alert
   fires and nothing is generated.

If nothing arrives at step 4 but Telegram says `SENT ✅`, the alias is the first thing to check. If
the Telegram says `drafted 📝`, the running n8n is behind the repo — re-import
`workflows/00-orchestrator-end-to-end.json` and `workflows/04-proposal-assembly.json`.

### The rollback

One line, and it does not need a decision from anyone else:

```bash
# modules/intake/intake_core.js -> const DEMO_SEND_MODE = 'draft';
npm run check && npm run mirror
```

then re-import the orchestrator. Every gate follows, because every gate reads that one value.

## 6. What changed in the repo

### 2026-08-11 — the address was opened

| File | Change |
|---|---|
| `modules/intake/intake_core.js` | **new** — routing + guards + 33 self-checks |
| `scripts/check-intake-routing.js` | **new** — end-to-end check against the real node source |
| `workflows/00-orchestrator-end-to-end.json` | `Gmail Trigger` query widened to catch all `demo@` mail; `Build Envelope` routes on destination; **new** `Intake Guard` + `Intake OK?`; `Map Client Config` resolves per route and forces draft; `Build Quote Draft` re-asserts it; `Client Rejected` reports every reason |
| `workflows/04-proposal-assembly.json` | `Compute Proposal Fields` and the standalone `Map Client Config` force draft for public intake / the demo tenant |
| `scripts/mirror-cores.js` | mirrors the intake core into the two orchestrator nodes |
| `package.json` | both new checks run in `npm run check` |

### 2026-08-18 — the demo answers by itself

| File | Change |
|---|---|
| `modules/intake/intake_core.js` | **new** `DEMO_SEND_MODE` — the one switch; `resolveIntake` carries it on every route |
| `workflows/00-orchestrator-end-to-end.json` | `Map Client Config` resolves the mode once from that switch and flags `demo_tenant`; `Build Quote Draft` and `Build Missing Info Reply` read it instead of re-deriving `draft`, and fail closed; the quote email has a demo version with no subtotal; `RFQ Needs Review` reports what actually happened |
| `workflows/04-proposal-assembly.json` | `Compute Proposal Fields` reads the resolved mode and **composes the covering email** per language and per tenant; the Gmail node renders it instead of its own hard-coded English |
| `scripts/check-intake-routing.js` | asserts every gate against `DEMO_SEND_MODE`, that the registry cannot override it, that Module 4's standalone copy has not drifted, that four broken values all park the message, and that the demo mail says what it is |
| `templates/build-templates.js` | generates `demo-proposal-template-{es,en}.docx` alongside the seeds |
| `package.json` | the two demo templates are rendered by `npm run check` too |

No change to Modules 1, 2 or 3 in either round: they receive the same envelope they always did.
