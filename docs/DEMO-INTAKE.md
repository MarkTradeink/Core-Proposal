# The public intake — `demo@cifral.io`

`demo@cifral.io` accepts an RFQ from **anyone**, resolves it to the `demo_client` tenant, and
answers with a proposal **that is never sent** — it stops as a Gmail draft for a human to read.
`proposal@cifral.io` is unchanged: registered clients only, matched by sender.

This is what makes the Demo Reflex CTA literal. The offer in every outbound message is *"send me a
real RFQ, even an old one, and I'll send back a sample proposal"*, and until now that could not be
taken at face value — a prospect writing in from their own address matched no registry row and was
rejected. The documented workaround (`docs/14` §2.1 in the Vegapunk repo) was for Mark to forward
the prospect's RFQ from his own address. That workaround still works and is still safe; it is now
a convenience rather than a requirement.

Decision: Mark, 2026-08-11.

---

## 1. How a message is routed

**By the address it was delivered to, not by who sent it.**

| Delivered to | Client | Sender must be known? | Replies |
|---|---|---|---|
| `demo@cifral.io` | always `demo_client` | **no** — anyone | **draft only** |
| `proposal@cifral.io` | whichever registry row's `commercial_contact_email` matches the sender | **yes** — unknown senders rejected | per `send_mode` |
| anything else | same as `proposal@` | yes | per `send_mode` |
| chat trigger (no sender, no destination) | `demo_client` | n/a | draft only |

Three details that are load-bearing:

- **Envelope headers are read before the visible ones.** `Delivered-To` is what Gmail actually
  delivered to; `To` is only what the sender typed. Alias delivery routinely puts the alias in `To`
  and the underlying mailbox in `Delivered-To`, so both are scanned, along with `Cc`,
  `X-Original-To` and `Envelope-To`.
- **If both intake addresses appear, `demo@` wins.** It is the strictly safer of the two — demo
  tenant, forced draft — so an ambiguous recipient list can never be the thing that buys live
  sending to a stranger.
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
| 1 | **Draft mode** | `demo_client` never sends | — (see below) |
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

## 3. Guard 1 — why draft is forced in code, not read from Notion

`docs/14` §2.3 flagged the risk before this was built: the registry property is named `send mode`
(with a space), the docs call it `send_mode`, and *"a key that does not match does not raise, it
yields `undefined`, and `undefined` is interpreted as the permissive option."*

Checked, and worth recording precisely, because the conclusion is not the one that was feared:

- **The read is fine.** n8n's Notion node snake_cases property names, so `send mode` does arrive as
  `property_send_mode`. Renaming the Notion property is not necessary.
- **The default was not fine.** `String(raw || 'send')` resolves *any* miss — property renamed,
  select blanked, Notion hiccup — to **`send`**. That is a permissive failure mode, and a public
  address cannot have one.

So the demo tenant's `send_mode` is now **forced to `draft` in code** and the registry value is not
consulted for it. Setting `send mode = draft` in Notion is still good hygiene, and now nothing
depends on it.

It is asserted at all three gates that stand between a rendered proposal and Gmail's `drafts.send`,
because any single one of them is one refactor away from being wrong:

1. the orchestrator's **Map Client Config** (`intake.open || client_id === 'demo_client'`);
2. Module 4's **Compute Proposal Fields** and its standalone **Map Client Config**
   (`client_config.open_intake === true`, or the demo tenant by id);
3. the orchestrator's **Build Quote Draft**, for the `pricing_only` branch.

`Send Mode?` and `Send Quote?` fire only on `send_mode === 'send'` exactly, so anything unexpected
lands on the draft branch rather than the send branch.

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

Two lesser notes:

- The draft's recipient is the actual sender, and the reply threads into their original message.
  That is the intent, and draft mode is what makes it safe.
- The document prints sell prices only; the internal `subtotal` is deliberately not in the render
  context. That predates this change and still holds for public traffic.

## 5. Testing it

### Offline — runs in seconds, no n8n

```bash
npm run check
```

Two of its steps cover this change:

- `node modules/intake/intake_core.js` — routing and the guards in isolation.
- `node scripts/check-intake-routing.js` — the end-to-end check. It pulls the `jsCode` **straight
  out of the workflow JSON** and executes it through a small n8n shim in graph order —
  Gmail item → Build Envelope → Intake Guard → Notion rows → Map Client Config → Module 4's
  Compute Proposal Fields — so it tests what actually ships, not a copy. It asserts a stranger's
  RFQ to `demo@` produces a proposal addressed to that stranger, from the demo template, with
  `send_mode = draft` at every gate; that `proposal@` still rejects the same stranger and still
  serves a registered client their own template with `send_mode = send`; and that no path from any
  trigger reaches the registry read or a module without passing the guard.

### Live — the check `docs/14` §2.3 calls blocking

Offline checks prove the logic; only a live run proves the alias, the credential and Gmail's
threading. Before pointing any outbound traffic at `demo@`:

1. Confirm `demo_client`'s registry row is `Client Status = trial`, and that its Drive folders hold
   only generic material (§4).
2. From an address that is **not** in the registry, email `demo@cifral.io` with a real RFQ.
3. Expect, within a few minutes: a Telegram "draft ready" alert, a `.docx` + PDF in the demo
   proposals folder, and **a draft in the mailbox that has not been sent**.
4. Verify in Gmail that the message sits in **Drafts**, not in **Sent**, addressed to the sender's
   address, threaded onto their message, from `demo@cifral.io`.
5. Send a fourth RFQ from the same address the same day and confirm the rate-limit Telegram alert
   fires and nothing is generated.

If anything is *sent* at step 4, stop and do not publish the address — that means a send gate was
reached, which the offline checks say is impossible, so something differs between the repo JSON and
what is running in n8n. Re-import `workflows/00-orchestrator-end-to-end.json` and
`workflows/04-proposal-assembly.json`.

## 6. What changed in the repo

| File | Change |
|---|---|
| `modules/intake/intake_core.js` | **new** — routing + guards + 33 self-checks |
| `scripts/check-intake-routing.js` | **new** — end-to-end check against the real node source |
| `workflows/00-orchestrator-end-to-end.json` | `Gmail Trigger` query widened to catch all `demo@` mail; `Build Envelope` routes on destination; **new** `Intake Guard` + `Intake OK?`; `Map Client Config` resolves per route and forces draft; `Build Quote Draft` re-asserts it; `Client Rejected` reports every reason |
| `workflows/04-proposal-assembly.json` | `Compute Proposal Fields` and the standalone `Map Client Config` force draft for public intake / the demo tenant |
| `scripts/mirror-cores.js` | mirrors the intake core into the two orchestrator nodes |
| `package.json` | both new checks run in `npm run check` |

No change to Modules 1, 2 or 3: they receive the same envelope they always did.
