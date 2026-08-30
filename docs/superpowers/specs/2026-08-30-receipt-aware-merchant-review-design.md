# Receipt-aware ambiguous merchant review

- Status: Approved implementation slice
- Date: 2026-08-30

Mixed retailers such as Amazon, Walmart, and CVS are not reliable categories.
Finance therefore treats merchant identity as a review signal only. A person or
scoped agent may explicitly request a bounded Mail lookup for one transaction;
the API compares merchant, amount, and a short transaction-date window and
returns only redacted source identifiers, dates, matched fields, confidence,
and a next action. Mail remains the owner of mailbox access and provider data.

Receipt evidence never applies a category, creates a merchant rule, or reveals
message bodies. Exactly one strong match leads to evidence review; no match,
multiple matches, partial matches, connector failure, or disabled Mail asks
what the person bought or paid for. The existing Finance review decision is the
only categorization mutation and retains its normal audit, policy, and
idempotency behavior.
