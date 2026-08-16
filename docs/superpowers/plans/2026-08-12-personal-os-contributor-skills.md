# Personal OS contributor skills implementation plan

> **For contributors:** Follow the repository instructions in `AGENTS.md` and use the named workflow skill that best matches the requested work.

**Goal:** Publish a discoverable, public-safe set of reusable Personal OS contributor skills and repository guidance without exposing maintainer-specific orchestration, personal task tracking, or local-machine details.

**Architecture:** Keep implementation-domain skills as the entry points for code changes, add concise workflows for repository knowledge, quality assurance, GitHub delivery, PR maintenance, and release visibility, and provide a repository-wide compatibility pointer for agents that consume GitHub instructions. Each workflow remains narrow, evidence-based, and explicit about whether it may write.

**Tech Stack:** Markdown skills and agent metadata, repository documentation, Python standard-library helper scripts, Node.js static validation.

---

## Task 1: Add the public workflow bundle

**Files:**
- Create: `.agents/skills/{catchup,create-pr,github-issue-janitor,github-work-context,github-work-sync,ilo-current-state,ilo-deploy-status,ilo-knowledge-base,ilo-product-planning,personal-os-qa,pr-briefing,pr-shepherd,resolve-pr-comments,review-pr}/**`
- Modify: imported `SKILL.md` and `agents/openai.yaml` metadata as needed

**Steps:**
1. Import only reusable skills from the private working branch.
2. Exclude maintainer-only coordination, individual work-queue, and branch-ownership workflows.
3. Replace user-specific branch conventions and human-facing ilo branding with repository-neutral, Personal OS wording.
4. Preserve deterministic boundaries: GitHub is delivery truth, docs are product/engineering truth, and each skill states its write authority.

## Task 2: Add discoverability and compatibility guidance

**Files:**
- Create: `.github/copilot-instructions.md`
- Create: `docs/engineering/contributor-agent-workflows.md`

**Steps:**
1. Point GitHub-compatible agents to `AGENTS.md`, the verified lifecycle commands, and the public skill map.
2. Document a small routing table that avoids duplicate workflow selection and keeps code, tests, docs, and GitHub artifacts in sync.
3. Keep the guidance compatible with public contributors and omit private identities, routines, and machine state.

## Task 3: Make validation deterministic

**Files:**
- Create: `scripts/check-public-agent-skills.mjs`
- Create: `scripts/check-public-agent-skills.test.mjs`
- Modify: `package.json`

**Steps:**
1. Write a failing validation test that verifies the public skill manifest, mandatory metadata, forbidden private skill absence, and public-safety text rules.
2. Implement the checker using Node built-ins and add a package script.
3. Run the checker’s test plus imported helper-script tests, frontmatter validation, formatting, and repository verification.

## Task 4: Exercise prompt-quality rubrics and publish

**Files:**
- Create: `docs/engineering/contributor-agent-workflows.md` (rubric section)
- Modify: affected skills based on findings

**Steps:**
1. Review each workflow against routing, authority, evidence, public-safety, and failure-mode rubrics.
2. Correct ambiguous default actions or mismatched labels before publishing.
3. Commit, push, inspect the draft PR, and update its body with concrete contents and validation evidence.

## Verification

Run from the repository root:

```bash
node scripts/check-public-agent-skills.test.mjs
node scripts/check-public-agent-skills.mjs
python3 .agents/skills/ilo-deploy-status/scripts/check_deploy_status_test.py
python3 .agents/skills/pr-shepherd/scripts/pr_shepherd_test.py
python3 .agents/skills/resolve-pr-comments/scripts/fetch_pr_review_feedback_test.py
pnpm lint
pnpm verify
```

Also run `git diff --check`, validate each new skill’s frontmatter using the skill-creator validator with PyYAML, inspect the draft PR head and changed-files list, and record any external-state checks that cannot run locally.
