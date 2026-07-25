# Reseller request guide + email templates

Cifral's client is the **company/reseller** (e.g. an intralogistics integrator). They email a
request to Cifral's inbox; Cifral produces a **price estimate and/or a written proposal** and returns
it as a **draft to the reseller** — who reviews it and forwards it to their own end customer. The
reseller is always the human-in-the-loop: nothing is auto-sent to the end customer.

This guide is what you hand the reseller so their emails contain what Module 1 needs. The better the
email, the fewer "needs review" bounce-backs.

## What to put in the subject

Include one of these words so the inbox trigger picks it up: **RFQ**, **quote**, **estimate**,
**proposal**, **presupuesto**. Example: `RFQ — Acme Manufacturing conveyor line`.

## The three things Cifral reads

1. **What you want back** (the *request type*):
   - "Please send **only a price estimate**" → price only.
   - "Please draft **the technical proposal** (no pricing)" → written proposal only.
   - "Please send **the full proposal with pricing**" → both.
   - If you don't say, Cifral uses your account's default.
2. **The scope of supply for THIS job** — list what is included, and call out what is **excluded**.
   This is per request: one job can be full turnkey, the next can be supply-only.
   - e.g. "Scope: materials + engineering only. **Installation and commissioning by the customer.**
     No spare parts."
3. **The RFQ details** — customer, project, and the technical requirements.

## Fields Cifral looks for

| Field | Needed for | Notes |
|-------|------------|-------|
| End-customer company | all | who the proposal is addressed to |
| Contact name | proposal / full | person at the end customer |
| Contact email | proposal / full | the end customer's email (Cifral never emails them directly) |
| Project type | proposal / full | e.g. "automated conveyor line" |
| Location | optional | plant / city |
| Desired deadline | optional | date or timeframe |
| Technical requirements | all | one line each: item, quantity, spec |
| Scope of supply | all | included / excluded items (see above) |
| Language | auto | Cifral detects ES/EN from your email |

> A **price-only** request needs less: company + the technical requirements + scope. A **proposal**
> or **full** request also needs the contact name, contact email and project type — if those are
> missing Cifral replies "needs review" instead of guessing.

---

## Email template A — Full proposal with pricing

```
Subject: RFQ — <End customer> <project>

Hi Cifral,

Please prepare the full proposal WITH pricing for the following.

End customer: <Company>
Contact: <Name> <Surname> — <email>
Project: <e.g. automated conveyor line>
Location: <plant / city>          (optional)
Deadline: <e.g. Q4 2026>          (optional)

Scope of supply:
- Included: materials, engineering, installation, commissioning, project management, warranty
- Excluded: <none / spare parts / training / ...>

Technical requirements:
- <item> — qty <n> — <spec>
- <item> — qty <n> — <spec>

Notes: <anything else>
```

## Email template B — Price estimate only

```
Subject: Quote — <End customer> <project>

Hi Cifral,

Please send ONLY a price estimate (no written proposal) for:

End customer: <Company>
Scope of supply:
- Included: materials, engineering
- Excluded: installation, commissioning (handled by the customer), spare parts

Technical requirements:
- <item> — qty <n> — <spec>
- <item> — qty <n> — <spec>
```

## Email template C — Technical proposal only (no pricing)

```
Subject: Proposal — <End customer> <project>

Hi Cifral,

Please draft ONLY the technical proposal (no pricing) for:

End customer: <Company>
Contact: <Name> <Surname> — <email>
Project: <type>

Scope of supply:
- Included: materials, engineering, installation, commissioning, warranty
- Excluded: spare parts, training

Technical requirements:
- <item> — qty <n> — <spec>
```

## Why spelling out scope matters

The scope you write drives three things at once: which **cost lines** are priced, which **sections**
are written, and which **template blocks** appear. "Installation by the customer" removes the
installation labour from the price *and* drops the implementation section from the document. If you
leave scope unstated, Cifral applies sensible defaults (materials, engineering and warranty in;
installation, commissioning, spare parts, shipping, training out) and prints the assumed scope at the
top of the proposal so you can catch it on review.
