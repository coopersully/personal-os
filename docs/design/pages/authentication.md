# Authentication — account access specification

## User job

**Enter or recover my nohmi account with clear requirements and no avoidable
submission errors.**

## Information hierarchy

```text
Orientation
├── nohmi identity
├── current access job
└── one sentence of scope

Credentials
├── invitation eligibility first on account creation
├── persistent labels
├── reusable validated fields
└── inline recovery action beside Password

Movement
├── one primary submit action
└── one explicit route to the alternate access flow

Product context
└── desktop-only neutral brand card; omitted on mobile
```

## Field contracts

- A small static logo and wordmark sit above the form column: top-left on
  desktop, centered on mobile, sharing the desktop card's 1.5rem outer inset.
  The lockup is 0.875rem tall, with the logo matching the wordmark's line height.
  Its frame uses the shared small-radius token capped at 0.3em, preserving a
  rounded square as the logo scales instead of collapsing into a circle.
  Its sticky, opaque page-colored header reserves space in the layout and masks
  scrolling content across the form column, so text never shows through the brand.
  Short forms center in the remaining space; long forms scroll naturally without
  overlapping the brand header. Page titles and descriptions are centered;
  input labels, field guidance, and validation retain their form alignment.
- At desktop widths (1024 px and up), the form occupies the left half and a
  flat neutral shadcn Card occupies the right half. Smaller screens show only
  the centered form. Login, signup, recovery, and verification share this layout.
- Auth mode links use the same plain-text treatment in login and signup. The
  invite-code separator is small and secondary, with space between code groups.
- Email fields use the shared domain validator and `EmailField`. Their default
  example is the reserved fictional address `sam@example.com`.
- Invitation redemption uses the Shadcn `InputOTP` composition as two groups
  of four alphanumeric characters. Newly issued codes use the same
  eight-character contract. It is the first account-creation field and checks
  the live, rate-limited API when focus leaves the field. Account creation
  remains unavailable until that exact code has been accepted.
- Text, email, password, and confirmation fields compose the shared Shadcn
  `Field`, `Input`, and `InputGroup` primitives. Focus changes their semantic
  selection surface and border only; it never adds a ring, outline, shadow, or
  second nested input boundary.
- Typed and autofilled inputs retain the same tonal surface. The shared autofill
  compatibility rule uses a flat inset repaint, not a decorative or focus shadow.
  Only InputGroup's transparent inner control may clip autofill to text.
- New-password surfaces use `PasswordFields` and the canonical domain
  `passwordSchema`. The checklist updates while typing and requires 12–128
  characters, mixed case, a number, and a symbol.
- Account creation and password reset confirm the new password before their
  primary action enables. Both password inputs share visibility state; either
  eye control shows or hides the pair.
- Sign-in keeps **Forgot your password?** beside the Password label. The
  invitation route says **I have an invite code**.
- Submit remains disabled until every visible field satisfies the same domain
  contract enforced by the API. Server errors remain visible because client
  validation is not an authorization boundary.
- The desktop brand card tiles the static nohmi symbol with independent, slow,
  randomized opacity pulses. It has no hover effect or orbit and remains still
  with reduced motion. It is decorative, hidden from assistive technology, and
  contains no controls or information required to sign in.

## Verification

1. Confirm incomplete and invalid invitations fail on blur and cannot submit;
   confirm editing the code invalidates the prior server result.
2. Confirm invalid email, weak password, and mismatched confirmation cannot
   submit.
3. Confirm each password requirement changes state as its condition becomes
   true.
4. Confirm either visibility button toggles both new-password fields.
5. Confirm the API rejects weak registration and reset-password payloads.
6. Confirm keyboard entry and pasted invitation codes populate all OTP slots.
7. Inspect every focused auth control for one flat boundary and inspect desktop
   and 390 × 844 layouts without horizontal overflow.
8. Confirm the brand card appears only on desktop and the form stays centered
   on smaller screens, without horizontal overflow.
