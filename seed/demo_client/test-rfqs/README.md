# Test RFQs for `demo@cifral.io`

Seven messages to send to the demo, each chosen because it exercises something different and
because its *failure* would look like success. Paste the `Subject:` line into the subject and
everything after the blank line into the body — they are written to be indistinguishable from real
mail, because that is the only kind the guards will ever see.

**Send them from an address that is not in the Notion registry**, or you get the registry route
instead of the public one and the whole point is lost.

> ⚠️ The public intake allows **3 RFQs per sender per UTC day** and 25 for the address overall. Seven
> messages is three days from one mailbox, or one day from three. Dry-run first (below) and spend
> the live ones on what a dry run cannot answer.

## Dry-run before you send

```bash
node scripts/dry-run-rfq.js seed/demo_client/test-rfqs/01-full-pipeline-es.txt
```

It runs the message through the real routing, the real guards and the real cover-variable capture —
the deterministic half, which is also the half that fails *silently*. It prints what it cannot know
(request type, scope, tier, missing fields) rather than guessing, because those come from a model
call inside n8n.

```bash
node scripts/dry-run-rfq.js <file> --to proposal@cifral.io   # the private route instead
node scripts/dry-run-rfq.js <file> --client beumer_marcos    # another client's Fields tab
```

## The seven

| File | What it should produce | What it is really testing |
|---|---|---|
| `01-full-pipeline-es.txt` | A priced proposal in Spanish, tier B, full scope | The headline case. Carries `Oferta nº`, `Att.` and `Asset` in one pasted header line, so the cover variables and the multi-label-per-line capture are both exercised. |
| `02-proposal-only-en.txt` | A written proposal in **English**, **no price chapter** | `request_type = proposal_only` — `oferta_economica` must be gone entirely, not empty. Also that an English RFQ is answered in English, cover labels included. |
| `03-pricing-only-es.txt` | A **price estimate email**, no document | `request_type = pricing_only` — the quote branch. Check the mail quotes a total and **no subtotal**. It declares no cover variables at all, so the cover must come out with empty boxes, never `undefined`. |
| `04-incomplete-es.txt` | A reply **asking for what is missing** | No company, no contact, no email, no project type. Module 1 must flag it `incomplete`, no proposal is produced, and the sender gets a readable list in Spanish. |
| `05-tender-c-en.txt` | A tender response, tier C, with annexes | Eight numbered clauses, three reference documents and a hard constraint. The compliance matrix, the BOM and the risk register only appear at tier C. |
| `06-supply-only-es.txt` | A proposal with installation, commissioning and engineering **absent** | Scope pruning. The RFQ says those are excluded in as many words; if their chapters survive, the scope map was not read. |
| `07-autoresponder-junk.txt` | **Nothing at all** | The junk filter. It must be dropped silently — no proposal, no Telegram, only a line in the n8n execution log. Sending it as a genuine out-of-office reply to one of your own test runs is the truest version of this test. |

## What to check on each

Beyond whatever the row above says:

- The mail **arrives** (not a draft), in your original thread, from `demo@cifral.io`, with the
  `.docx` and the PDF attached.
- The covering mail is in the RFQ's language and says it is a demonstration.
- The PDF carries the demo marking in the header, the footer and on the cover, and the "About this
  document" page sits after the cover.
- The contents list has **real page numbers** and matches the chapters that are actually there.
- Chapter numbers run 1, 2, 3 with no gaps, even where chapters were dropped.
- The cover shows the values you wrote after `Oferta nº`, `Att.` and the rest — **verbatim**, and
  never the word `undefined`.

## When something is wrong

| Symptom | Where to look |
|---|---|
| Nothing happened at all | The junk filter, or the Gmail trigger never picked it up. `docs/DEMO-INTAKE.md` §2. |
| `undefined` on the cover | The live Proposal Config sheet is missing the `Fields` tab, or a key the template uses. `docs/CLIENT-DRIVE-SETUP.md`. |
| A cover box is blank | The label in the sheet and the label you typed are not the same string. Dry-run the file. |
| It arrived as a draft | The running n8n is behind the repo, or `DEMO_SEND_MODE` is `draft`. |
| Chapters you did not expect | The `Chapters` tab, the tier and the scope, in that order. `node scripts/render-sample.js es B demo_client` shows the resolved set offline. |
