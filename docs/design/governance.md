# ilo design governance

- Status: Active working agreement
- Purpose: Turn observations into durable improvements without turning taste
  into accidental law

## Core rule

Treat feedback as evidence of a possible system problem. Fix the earliest
stable layer that can prevent the failure without erasing a legitimate local
need.

A visible symptom does not prove its root cause. “The padding is wrong” might
mean the spacing token is missing, the primitive has inconsistent anatomy, the
page groups unrelated material, the copy is doing work the layout should do, or
the page has no clear primary job. Diagnose before editing.

## Sources of design truth

Use the narrowest source that owns the decision:

| Source | Owns | Does not own |
| --- | --- | --- |
| `docs/product/master-design.md` | Product promise, target jobs, safety, material, and automation invariants | Component geometry |
| `docs/design/foundations.md` | Brand character, experience principles, voice, and visual direction | Page-specific behavior |
| `docs/design/system.md` | Cross-product grammar, semantic tokens, shared patterns, and implementation protocol | Domain meaning |
| `docs/design/pages/*.md` | One page's user job, hierarchy, state matrix, and interaction contract | New global primitives by implication |
| `docs/engineering/*.md` | Ownership, reliability, data, and delivery constraints | Visual preference |
| `.agents/skills/personal-os-frontend` | The procedure agents follow to apply these sources | Durable product doctrine |

When sources disagree, do not silently choose the most convenient one. Resolve
the conflict at the owning layer and update every affected downstream contract
in the same change.

## Diagnosis ladder

Move from outcome to implementation. Stop at the earliest layer that fully
explains the failure.

| Layer | Diagnostic question | Typical owner |
| --- | --- | --- |
| User outcome | What is the person trying to decide or do, and is the surface serving it? | Product principle or user need |
| Information hierarchy | Is the right material present, ordered, grouped, and disclosed? | Page specification |
| Pattern | Does the relationship recur across contexts with one stable behavior? | Design-system block or pattern |
| Primitive | Does a shared control have the wrong anatomy, semantics, or state model? | `components/ui` or shared composed control |
| Token | Is a named role missing or inconsistently valued across themes/states? | Semantic token layer |
| Composition | Is an established rule applied incorrectly in this feature? | Feature component or page layout |
| Defect | Does code simply fail to implement the documented contract? | Local implementation and test |

The highest layer is not automatically the best answer. Choose the earliest
**responsible** layer, not the most abstract explanation available.

## Feedback-to-rule workflow

1. **Record the symptom.** Describe what is visible without embedding the
   proposed fix: “selected cards move their contents,” not “add 4 px padding.”
2. **Reproduce the conditions.** Capture route, viewport, theme, input method,
   data density, and loading/empty/error/permission state where relevant.
3. **Name the user cost.** State what becomes harder to understand, predict,
   reach, compare, or complete. If there is no user or system cost, label the
   observation as taste rather than manufacturing a rationale.
4. **Walk the diagnosis ladder.** Inspect existing docs, tokens, primitives,
   patterns, and at least one reference surface before choosing ownership.
5. **Write the invariant.** Express the condition and outcome, not a screenshot:
   “choice controls reserve identical geometry in every state.”
6. **Choose scope and maturity.** Decide whether it is required, established,
   trial, exception, or deprecated. Do not present a hypothesis as settled.
7. **Change the owner.** Update the shared layer and its consumers. A local
   override is acceptable only when the page spec records why the context is
   genuinely different.
8. **Verify the failure mode.** Add the smallest automated check that protects
   semantics or behavior and perform live QA for visual hierarchy, density, and
   responsive behavior.
9. **Update durable guidance.** Change this book, the relevant page spec, and
   the frontend skill only when their contracts changed.

## Rule maturity

Every new design rule should have one of these states in its proposal or change
description. Established rules may omit the label in normative documents.

| State | Meaning | Required evidence |
| --- | --- | --- |
| `required` | External standard or hard safety/accessibility/product invariant | Link to the authority and a conformance check |
| `established` | Reusable ilo contract implemented on reference surfaces | Rationale, shared owner, states, and regression evidence |
| `trial` | Plausible approach being evaluated in bounded contexts | Hypothesis, intended learning, owner, and review point |
| `exception` | Deliberate divergence for a specific context | Scope, reason the shared rule fails, and containment |
| `deprecated` | Rule or pattern being removed | Replacement and migration boundary |

Implementation is evidence that a rule is feasible, not evidence that it works
for users. Automated tests are evidence of behavior, not evidence of visual
quality or comprehension. A stakeholder preference is an input, not user
research.

## When a rule belongs in the system

Promote an observation into `system.md` or a shared primitive when at least one
condition applies:

- it follows an external accessibility or platform requirement;
- the same failure appears on multiple surfaces;
- multiple surfaces share the implementation that caused the failure;
- the rule protects a product invariant such as source fidelity, visible
  autonomy, or stable geometry;
- a new reusable component or pattern has evidence of a recurring user need.

Keep it in a page specification when the rule depends on that page's user job,
material, or state model. Keep it a trial when we have one observation and no
shared cause. Reject it when it merely restyles an existing meaning, duplicates
a pattern, or cannot name a user/system cost.

## Pattern and component admission

Before adding or materially expanding a shared pattern, show that it is:

| Criterion | ilo requirement |
| --- | --- |
| Needed | A named user job or recurring failure requires it. |
| Distinct | Existing primitives and patterns cannot express the need without distortion. |
| Coherent | It follows ilo foundations, tokens, copy, and interaction grammar. |
| Accessible | It meets WCAG 2.2 AA and follows native/APG keyboard conventions. |
| Stateful | Loading, empty, error, disabled, permission, pending, and success behavior is defined as applicable. |
| Versatile | It works across its intended content lengths, themes, widths, input methods, and data density. |
| Verifiable | Public behavior has focused coverage and the visual result has live QA evidence. |
| Owned | Its source, documentation, consumers, and future change path are clear. |

These criteria adapt the GOV.UK Design System's [contribution criteria](https://design-system.service.gov.uk/community/contribution-criteria/),
including its emphasis on usefulness, uniqueness, usability, consistency, and
versatility.

### Admitting an icon

A glyph enters the product the same way a pattern does. Adding one means adding
an entry to `apps/web/src/components/icons.ts`, never a local import, and the
change is reviewed against the same **Needed** and **Distinct** criteria: a new
entry must carry a meaning the vocabulary does not already have. Reaching for a
second icon pack because a glyph is missing or reads wrong is a rejected answer;
choose a different reicon glyph, or argue the meaning is genuinely new. The
registry name states the meaning rather than repeating reicon's vendor name.
`docs/design/system.md` holds the resulting contract.

## Accessibility baseline

- Target WCAG 2.2 Level AA for the complete user flow, not isolated components.
- Use native HTML before ARIA. When a composite widget is necessary, follow the
  closest WAI-ARIA APG semantics and keyboard convention or document and test
  the reason for divergence.
- Preserve logical DOM, reading, and focus order. Responsive layout must not
  create a different or surprising sequence.
- Focus must be visible, unobscured, and at least as clear as hover. ilo may use
  flat semantic surface, border, text, or underline treatment; “no ring” never
  means “no focus indication.”
- Provide a non-drag and non-pointer path for every action. Do not use keyboard
  shortcuts as a substitute for normal keyboard access.
- Validate zoom, text growth, contrast, reduced motion, accessible names,
  error recovery, and target size in context.
- Combine automated checks, component behavior tests, browser/assistive
  technology inspection, and human evaluation. W3C explicitly notes that
  [no tool alone can determine accessibility](https://www.w3.org/WAI/test-evaluate/).

## Design review evidence

Review the actual product, not only a clean screenshot. For a bounded change,
collect evidence proportional to risk:

1. **Contract:** the user job, rule maturity, owner, and applicable page/system
   docs are identified.
2. **Static:** token checks, lint, types, and semantic structure catch drift.
3. **Behavior:** tests cover interaction, state transition, and recovery.
4. **Responsive:** inspect 320 px and normal desktop widths, plus intermediate
   widths when layout changes.
5. **State:** inspect realistic populated, long-content, empty, loading, error,
   stale, permission, and pending states as applicable.
6. **Input and access:** inspect keyboard, focus, pointer/touch, zoom, reduced
   motion, and screen-reader semantics as applicable.
7. **User evidence:** for consequential or novel workflows, test the task with
   representative users, including disabled users. Record what was learned,
   not whether people said they liked it.

Research questions and untested assumptions belong in the work record until
they become durable findings. GOV.UK recommends continual, inclusive research
in small rounds and treating non-user opinions as assumptions; see its
[user-research introduction](https://www.gov.uk/service-manual/user-research/how-user-research-improves-service-design)
and [research planning guidance](https://www.gov.uk/service-manual/user-research/plan-user-research-for-your-service).

## Refinement record template

Use this compact structure in an issue, PR, or design note when feedback may
change the system:

```text
Symptom:
Conditions:
User/system cost:
Evidence:
Root-cause layer:
Invariant or hypothesis:
Maturity: required | established | trial | exception | deprecated
Owner:
Affected surfaces/states:
Verification:
Docs/skill updates:
```

Do not create a permanent repository document for every observation. The
template is a reasoning and review tool; only durable rules graduate into the
design book.
