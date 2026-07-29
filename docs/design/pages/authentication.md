# Authentication — account access specification

## User job

**Enter or recover my ilo account with clear requirements and no avoidable
submission errors.**

## Information hierarchy

```text
Orientation
├── ilo identity
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
```

## Field contracts

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
