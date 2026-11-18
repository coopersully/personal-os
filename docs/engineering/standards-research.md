# Engineering standards research

Reviewed 2026-10-18. These primary sources inform nohmi's standards; they do not establish a
universal enterprise certification or prove current repository conformance. The application is a
multi-user modular TypeScript product with provider integrations, not a reason to adopt every
enterprise framework. The rules below are nohmi adaptations, with local acceptance evidence.

| Source | Supported principle | nohmi application and limit |
| --- | --- | --- |
| [Google Engineering Practices: review criteria](https://google.github.io/eng-practices/review/reviewer/looking-for.html) | Review design, complexity, behavior, tests and context; avoid speculative generality and taste-based blocking. | CS-04/14/15: require concrete consequences, meaningful negative tests and consumer inspection. No arbitrary file-size or abstraction quota. |
| [Microsoft: architectural principles](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/architectural-principles) | Separate concerns, encapsulate state, centralize knowledge and depend on explicit abstractions. | CS-01–04/17: use domain-owned operations and narrow capabilities. Apply to TypeScript functions/modules; no mandated .NET layers or class hierarchy. |
| [Martin Fowler: bounded context](https://martinfowler.com/bliki/BoundedContext.html) | Models belong to explicit contexts whose relationships must be understood. | Keep workspace semantics under their domain owners; share mechanics only when contracts match. Do not force Mail and Finances into one generic model. |
| [OWASP ASVS](https://owasp.org/projects/asvs) | Security verification benefits from explicit, versioned requirements and evidence. | CS-05/06/10: trace tenant, authority and sensitive-data boundaries. When adopting individual ASVS controls, cite the version and control ID. This work does not claim ASVS certification or full control coverage. |
| [Google SRE: canarying releases](https://sre.google/workbook/canarying-releases/) | Automated reproducible releases need evaluation of actual rollout results. | AC-05/07: record deployment identity, safe observation criteria and recovery owner. This is not a claim nohmi has a canary rollout platform. |
| [TypeScript performance guidance](https://github.com/microsoft/TypeScript/wiki/Performance) | Diagnose compiler cost and use suitable project boundaries/incremental strategies. | CS-18: select affected projects/consumers during iteration and measure before changing compiler configuration. A cache or fast subset is not final verification. |

## Decisions

Use DRY for duplicated knowledge and authoritative rules, not every repeated expression. Use SOLID
as responsibility, substitutability and dependency questions, not a checklist of objects to create.
Use the [placement rubric](code-placement.md) to resolve where code belongs. An extraction must
preserve each consumer's policy, error, provenance and lifecycle behavior.

Keep local readiness decisions pure and offline; budget network collection separately. Reduce
redundant work by assigning one verification owner and binding receipts to inputs. Do not remove
required suites or security evidence to achieve a speed target. Optimize only after measuring a
specific bottleneck; use representative cold/warm data when evaluating compiler changes.

Future proposals must identify the source-backed principle, local failure it addresses, owner,
applicability, evidence and migration boundary. External guidance is evidence for a decision, not
an instruction that can overrule the repository's approved product contracts.
