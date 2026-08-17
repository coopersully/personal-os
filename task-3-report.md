# Task 3 question-answer contract report

Status: DONE

- Published bounded, action-specific public answer descriptors for all supported Finance action families.
- Rejected malformed JSON, unknown fields, invalid types, and invalid enumerated choices without superseding the pending question.
- Preserved pending questions when a valid shaped answer needs another preparation pass; a valid answer can proceed to normal disposition.
- Verified with focused domain and Finance action-service integration tests, both domain/API type checks, Biome formatting, and a diff check.

Biome reports four pre-existing non-null assertion warnings in `apps/api/src/finance-action-service.integration.test.ts`; it exits successfully and reports no errors.

## Disposition matrix follow-up

Status: DONE

- Added table-driven API coverage for all eight supported action families across bypass-on apply, bypass-off review, missing evidence, and foreign-target denial.
- Asserted public reviews retain action-specific changes and source references without private payloads.
- Added MCP coverage that `set_finance_budget_plan` preserves `applied`, `pending_review`, and `needs_input` outcomes unchanged.
