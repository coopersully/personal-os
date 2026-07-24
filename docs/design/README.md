# Personal OS design system

Personal OS is a calm, opinionated workspace for a person and their agents. The
system exists to make the product feel intentional at every scale, while making
its UI predictable to build and review.

## Source of truth

- [`system.md`](system.md) defines the cross-product visual language, interaction
  rules, component contracts, and the agent implementation protocol.
- [`pages/today.md`](pages/today.md) is the reference page specification. New
  page specifications use its structure: user job, information hierarchy, block
  contract, state matrix, and verification criteria.
- [`../engineering/settings-ui-standards.md`](../engineering/settings-ui-standards.md)
  remains the settings-specific extension of this system.

Design documentation is a product contract, not a mood board. A UI change that
introduces a shared pattern updates this directory in the same change.
