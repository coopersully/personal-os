# MCP Link Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Ilo MCP metadata link use the configured application origin and prevent production deployments from silently inheriting or generating localhost links.

**Architecture:** Centralize URL parsing and link construction in a pure MCP module consumed by HTTP, stdio, and tool metadata. Make production configuration fail at startup, inject `APP_BASE_URL` into every rendered MCP task definition, and enforce both behaviors with unit and deployment-contract tests.

**Tech Stack:** TypeScript, Node.js URL, Vitest, MCP SDK, GitHub Actions shell/JQ, ECS task definitions, Terraform.

## Global Constraints

- HTTP production requires an absolute `https:` `APP_BASE_URL`.
- Local development may use an explicit `http://localhost:8081` origin.
- Production never receives localhost through an implicit fallback.
- `_ilo.links`, resource documentation, icons, and other MCP-owned links use the same normalized origin.
- Workspace access links target `section=workspace-access`; operational approvals target the owning workspace or Reviews.
- Deployment evidence must validate the rendered runtime task, not only Terraform source.

---

### Task 1: Centralize application URL and link construction

**Files:**
- Create: `apps/mcp/src/app-links.ts`
- Create: `apps/mcp/src/app-links.test.ts`
- Modify: `apps/mcp/src/tool-surface.ts`
- Modify: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Produces: `resolveAppBaseUrl(environment, options): string` and `createIloAppLinks(appBaseUrl, domain): IloAppLinks`.
- Consumes: `IloToolDefinition["domain"]` for domain-specific approval destinations.

- [ ] **Step 1: Write failing URL and mapping tests**

```ts
expect(() => resolveAppBaseUrl({}, { production: true })).toThrow(/APP_BASE_URL/);
expect(() =>
  resolveAppBaseUrl({ APP_BASE_URL: "http://app.example.com" }, { production: true }),
).toThrow(/https/);
expect(
  resolveAppBaseUrl({ APP_BASE_URL: "https://app.example.com/" }, { production: true }),
).toBe("https://app.example.com");
expect(createIloAppLinks("https://app.example.com", "finances")).toMatchObject({
  agentAccess: "https://app.example.com/settings?section=workspace-access",
  approvals: "https://app.example.com/finances/review",
  recovery: "https://app.example.com/settings?section=connections",
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm exec vitest run apps/mcp/src/app-links.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure helpers**

Define the exact public shape:

```ts
export type IloAppLinks = {
  activity: string;
  agentAccess: string;
  approvals: string;
  recovery: string;
  today: string;
};

export function resolveAppBaseUrl(
  environment: Pick<NodeJS.ProcessEnv, "APP_BASE_URL">,
  options: { production: boolean },
): string;

export function createIloAppLinks(
  appBaseUrl: string,
  domain: IloToolDefinition["domain"],
): IloAppLinks;
```

Normalize with `new URL`, reject credentials/query/hash and non-HTTP protocols, require `https:` in production, and remove the trailing slash. Map Mail to `/mail`, Finances to `/finances/review`, Calendar to `/calendar`, Tasks/Reminders to `/tasks`, and cross-domain assistant output to `/reviews`.

- [ ] **Step 4: Replace metadata string concatenation**

Call `createIloAppLinks(options.appBaseUrl, definition.domain)` inside `attachIloMetadata`. Update server expectations from `section=agents` to the canonical routes.

- [ ] **Step 5: Run MCP tests**

Run: `pnpm exec vitest run apps/mcp/src/app-links.test.ts apps/mcp/src/server.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the canonical link builder**

```bash
git add apps/mcp/src/app-links.ts apps/mcp/src/app-links.test.ts apps/mcp/src/tool-surface.ts apps/mcp/src/server.test.ts
git commit -m "fix: centralize mcp application links"
```

### Task 2: Fail closed at MCP entry points

**Files:**
- Modify: `apps/mcp/src/http.ts`
- Modify: `apps/mcp/src/stdio.ts`
- Modify: `apps/mcp/src/http-contract.test.ts`

**Interfaces:**
- Consumes: `resolveAppBaseUrl(...)` and `createIloAppLinks(...)` from Task 1.
- Produces: validated startup origin and canonical resource documentation.

- [ ] **Step 1: Write failing entry-point contract tests**

Read the entry-point source and assert both use `resolveAppBaseUrl`; assert HTTP resource documentation uses `createIloAppLinks(...).agentAccess` and no source contains `APP_BASE_URL ?? "http://localhost:8081"`.

```ts
expect(httpSource).toContain("resolveAppBaseUrl(process.env");
expect(httpSource).not.toContain('APP_BASE_URL ?? "http://localhost:8081"');
expect(stdioSource).not.toContain('APP_BASE_URL ?? "http://localhost:8081"');
```

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `pnpm exec vitest run apps/mcp/src/http-contract.test.ts`

Expected: FAIL on both implicit fallbacks and the legacy Settings link.

- [ ] **Step 3: Validate the entry points**

Resolve once at startup:

```ts
const appBaseUrl = resolveAppBaseUrl(process.env, {
  production: process.env.NODE_ENV === "production",
});
const appLinks = createIloAppLinks(appBaseUrl, "assistant");
```

Use `appLinks.agentAccess` for OAuth `resource_documentation`. Pass `appBaseUrl` to the server and discovery surfaces. Non-production execution still requires an explicit value supplied by `.env` or the lifecycle scripts; tests exercise local HTTP explicitly.

- [ ] **Step 4: Run MCP unit, build, and type validation**

Run: `pnpm exec vitest run apps/mcp/src && pnpm --filter @personal-os/mcp typecheck && pnpm --filter @personal-os/mcp build`

Expected: PASS.

- [ ] **Step 5: Commit fail-closed startup**

```bash
git add apps/mcp/src/http.ts apps/mcp/src/stdio.ts apps/mcp/src/http-contract.test.ts
git commit -m "fix: validate mcp application origin"
```

### Task 3: Repair deployment drift on every release

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `scripts/check-deployment-drain-contract.mjs`
- Modify: `infra/compute.tf` only if the canonical variable declaration differs from the existing MCP task definition.

**Interfaces:**
- Consumes: production `APP_URL` already required by the deploy job.
- Produces: an MCP task definition whose `APP_BASE_URL` is replaced with `APP_URL` every release.

- [ ] **Step 1: Add a failing deployment-contract assertion**

Require the task-definition renderer to pass `--arg app_url "$APP_URL"` and replace any existing MCP value with one exact entry:

```js
assert.match(
  deployWorkflow,
  /--arg app_url "\$APP_URL"[\s\S]*?\.name != "APP_BASE_URL"[\s\S]*?\{name: "APP_BASE_URL", value: \$app_url\}/,
  "deployment must render the canonical app URL into every MCP task definition",
);
```

- [ ] **Step 2: Run the contract check and confirm failure**

Run: `node scripts/check-deployment-drain-contract.mjs`

Expected: FAIL because the current workflow only replaces the image.

- [ ] **Step 3: Inject the value in the immutable task renderer**

Pass `APP_URL` into JQ and add an MCP branch that filters any prior `APP_BASE_URL` entry before appending the canonical one. Preserve the existing API restore-state and recovery-marker logic unchanged.

```jq
if $container == "mcp" then
  .environment = (
    [.environment[]? | select(.name != "APP_BASE_URL")] +
    [{name: "APP_BASE_URL", value: $app_url}]
  )
elif $container == "api" then
  .environment = (.environment | map(select(.name != "ILO_DEPLOYMENT_RESTORE_STATE")))
else .
end
```

- [ ] **Step 4: Run deployment and infrastructure contracts**

Run: `node scripts/check-deployment-drain-contract.mjs`

Run: `pnpm lint`

Expected: PASS, including the existing provider-network, drain, connector, and deployment contracts.

- [ ] **Step 5: Commit deployment repair**

```bash
git add .github/workflows/deploy.yml scripts/check-deployment-drain-contract.mjs infra/compute.tf
git commit -m "fix: pin mcp app url during deployment"
```

### Task 4: Integrated verification

**Files:**
- Modify if verification exposes a defect: files already owned by Tasks 1–3.

**Interfaces:**
- Consumes: both MCP implementation and deployment rendering.
- Produces: repository and production-equivalent evidence for the PR.

- [ ] **Step 1: Search for stale generic and localhost links**

Run: `rg -n 'settings\?section=agents|APP_BASE_URL \?\?|localhost:8081' apps/mcp .github/workflows infra`

Expected: no production fallback or retired generic Settings link; explicit local test fixtures may remain.

- [ ] **Step 2: Run complete MCP verification**

Run: `pnpm exec vitest run apps/mcp/src && pnpm --filter @personal-os/mcp typecheck && pnpm --filter @personal-os/mcp build`

Expected: PASS.

- [ ] **Step 3: Run repository verification**

Run: `pnpm verify`

Expected: PASS for environment checks, lint, typecheck, coverage, builds, and desktop/mobile E2E.

- [ ] **Step 4: Review the final diff and commit any verification correction**

```bash
git diff --check
git status --short
```

If tracked corrections were required, stage only those named files and commit them with a message describing the verified defect.
