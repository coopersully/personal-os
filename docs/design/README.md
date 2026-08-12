# ilo design book

ilo is a calm, opinionated workspace for a person and their agents. The
design book exists to make the product intentional at every scale and its
experience predictable to design, build, test, and refine.

## Source of truth

- [`foundations.md`](foundations.md) defines the product's brand idea,
  experience principles, character, voice, and visual expression.
- [`governance.md`](governance.md) defines how observations become hypotheses,
  exceptions, page rules, shared patterns, tokens, primitives, and verified
  system invariants.
- [`system.md`](system.md) defines the cross-product visual language, interaction
  rules, component contracts, and the agent implementation protocol.
- [`pages/today.md`](pages/today.md) is the reference page specification. New
  page specifications use its structure: user job, information hierarchy, block
  contract, state matrix, and verification criteria.
- [`pages/setup.md`](pages/setup.md) defines immediate, resumable account setup
  and the shared provider-connection contract.
- [`pages/authentication.md`](pages/authentication.md) defines sign-in,
  invitation redemption, recovery, and reusable credential-field contracts.
- [`../engineering/settings-ui-standards.md`](../engineering/settings-ui-standards.md)
  remains the settings-specific extension of this system.

Design documentation is a product contract, not a mood board. A UI change that
introduces a shared pattern updates this directory in the same change.

## How to use the book

1. Start with the person's immediate job and the product/brand principles.
2. Diagnose feedback with the governance ladder before prescribing a local
   visual fix.
3. Apply the system grammar and relevant page specification.
4. Implement through semantic tokens and shared primitives.
5. Verify behavior, accessibility, responsive hierarchy, realistic states, and
   the original failure mode.

The book records durable decisions. Research questions, screenshots, review
conversation, and delivery progress belong in issues and pull requests until
they establish a reusable contract.
