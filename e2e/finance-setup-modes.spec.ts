import { randomUUID } from "node:crypto";
import type { FinanceOnboardingSnapshot } from "@personal-os/domain";
import { expect, test } from "@playwright/test";
import {
  addReviewedManualSource,
  browserFinanceHuman,
  completeFinanceSetupViaApi,
  createFinanceSetupHost,
  createFinanceSetupPersona,
  verifyFinanceChatThroughOriginalAgent,
} from "./finance-setup-fixtures.js";
import { financeLegacyBrowserAccounts } from "./finance-setup-legacy.js";

// Runs under both repository projects. The server prepares historical canonical
// records before the actual published migration; browser tests never insert grants.
test.describe("durable Finance manual setup", () => {
  test("actual migration eligibility survives source loss without implying completion or Chat", async ({
    page,
    baseURL,
  }, info) => {
    if (!baseURL) throw new Error("Browser runtime baseURL is required");
    const runtimeURL = baseURL;
    const persona = financeLegacyBrowserAccounts.find(
      (account) => account.project === info.project.name,
    );
    if (!persona) throw new Error(`Missing legacy fixture for ${info.project.name}`);
    async function login(account: { email: string; password: string }) {
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(account.email);
      await page.getByLabel("Password", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
      return browserFinanceHuman(page, runtimeURL);
    }
    const human = await login(persona.legacy);
    const initial = await human.getFinanceOnboarding();
    expect(initial).toMatchObject({ existingAccess: true, completedAt: null });
    expect(initial.automation.canSendChat).toBe(false);
    const source = (await human.listFinanceAccounts()).accounts.find(
      (account) => account.name === "Legacy checking",
    );
    if (!source) throw new Error("Historical canonical source is missing");
    await human.disconnectFinanceAccount(source.id, { idempotencyKey: randomUUID() });
    await human.updateFinanceAccount(source.id, {
      idempotencyKey: randomUUID(),
      includeInPlanning: false,
    });
    const lostSource = await human.getFinanceOnboarding();
    expect(lostSource).toMatchObject({
      existingAccess: true,
      completedAt: null,
      source: { state: "missing" },
    });
    expect(lostSource.automation.canSendChat).toBe(false);
    await page.goto("/finances/transactions?view=table");
    await expect(page).toHaveURL(/\/finances\/transactions\?view=table$/);
    await expect(page.getByRole("region", { name: "Setup review", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(/\/finances\/transactions\?view=table$/);
    await page.goto("/finances/accounts");
    await page
      .getByRole("button", { name: "Account options for Legacy checking", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit Legacy checking", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edit account", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/finances/setup");
    await expect(page.getByRole("region", { name: "Setup review", exact: true })).toBeVisible();
    await expect(page.getByText("Setup complete. Your workspace remains available.")).toHaveCount(
      0,
    );
    expect((await human.getFinanceOnboarding()).completedAt).toBeNull();
    await human.logout();

    const control = await login(persona.generalSetupOnly);
    expect((await control.getMe()).setup.status).toBe("complete");
    const controlBefore = await control.getFinanceOnboarding();
    expect(controlBefore).toMatchObject({
      existingAccess: false,
      completedAt: null,
      source: { state: "missing" },
    });
    await addReviewedManualSource(control);
    const controlAfter = await control.getFinanceOnboarding();
    expect(controlAfter).toMatchObject({
      existingAccess: false,
      completedAt: null,
      source: { state: "usable" },
    });
    await page.goto("/finances/spending");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/finances/setup" &&
        url.searchParams.get("returnTo") === "/finances/spending",
    );
    await control.logout();
    const { human: postMigration } = await createFinanceSetupPersona(page, baseURL);
    await addReviewedManualSource(postMigration);
    const newOwner = await postMigration.getFinanceOnboarding();
    expect(newOwner).toMatchObject({
      existingAccess: false,
      completedAt: null,
      source: { state: "usable" },
    });
    await info.attach("actual-legacy-migration-browser-snapshots", {
      body: JSON.stringify({
        migration: "0118_finance_preferences_legacy_access",
        initial,
        lostSource,
        controlBefore,
        controlAfter,
        newOwner,
      }),
      contentType: "application/json",
    });
  });

  test("registered Now can finish while Chat waits for original-agent proof, then revocation locks only sending", async ({
    page,
    baseURL,
  }, info) => {
    if (!baseURL) throw new Error("Browser runtime baseURL is required");
    const { human, email } = await createFinanceSetupPersona(page, baseURL);
    await addReviewedManualSource(human);
    const host = await createFinanceSetupHost(human, baseURL);
    try {
      const pending = await human.getFinanceOnboarding();
      expect(pending.automation).toMatchObject({
        registrationCount: 1,
        authorizedRegistrationWithCadence: true,
        chatVerification: "pending",
        canSendChat: false,
      });
      const saved = await human.saveFinanceOnboardingAnswers({
        expectedRevision: pending.revision,
        idempotencyKey: randomUUID(),
        automationChoice: "now",
        displayPreferencesReviewed: true,
        answers: pending.questions.map(({ questionId }) => ({
          questionId,
          disposition: "unknown",
        })),
      });
      await page.goto("/finances/setup");
      const review = page.getByRole("region", { name: "Setup review", exact: true });
      await review.getByRole("button", { name: "Finish setup", exact: true }).click();
      await expect(page.getByText("Setup complete", { exact: true })).toBeVisible();
      const completed = await human.getFinanceOnboarding();
      expect(completed.revision).toBeGreaterThan(saved.revision);
      expect(completed.completedAt).not.toBeNull();
      expect(completed.automation.canSendChat).toBe(false);
      await page.goto("/finances/chat");
      const chat = page.getByRole("region", { name: "Finance chat", exact: true });
      await chat.getByLabel("Message", { exact: true }).fill("Pending fixture draft");
      await expect(chat.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
      await expect(chat.getByText(/Chat sending is locked\./)).toBeVisible();
      expect((await human.getFinanceConversationHistory()).messages).toHaveLength(0);
      await verifyFinanceChatThroughOriginalAgent(human, host.client, host.scheduleId);
      const verified = await human.getFinanceOnboarding();
      expect(verified.automation).toMatchObject({
        chatVerification: "verified",
        canSendChat: true,
      });
      expect(verified.completedAt).toBe(completed.completedAt);
      await page.reload();
      const message = `Disposable original host browser message ${randomUUID()}`;
      await chat.getByLabel("Message", { exact: true }).fill(message);
      await expect(chat.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
      await chat.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(chat.getByText(message, { exact: true })).toBeVisible();
      await expect
        .poll(async () =>
          (await human.getFinanceConversationHistory()).messages.map((item) => item.text),
        )
        .toContain(message);
      const history = await human.getFinanceConversationHistory();
      await page.reload();
      await expect(chat.getByText(message, { exact: true })).toBeVisible();
      await host.revokeOriginalToken();
      expect(await human.getFinanceConversationReadiness()).toMatchObject({ canSend: false });
      await page.reload();
      await chat.getByLabel("Message", { exact: true }).fill("Revoked fixture draft");
      await expect(chat.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
      await expect(chat.getByText(/Chat sending is locked\./)).toBeVisible();
      await expect(chat.getByText(message, { exact: true })).toBeVisible();
      expect((await human.getFinanceConversationHistory()).messages.map((item) => item.id)).toEqual(
        history.messages.map((item) => item.id),
      );
      const revoked = await human.getFinanceOnboarding();
      expect(revoked.completedAt).toBe(completed.completedAt);
      expect(revoked.automation.canSendChat).toBe(false);
      await info.attach("host-setup-snapshots", {
        body: JSON.stringify({
          email,
          scheduleId: host.scheduleId,
          connectionId: host.connectionId,
          pending,
          saved,
          completed,
          verified,
          revoked,
          transport:
            "SDK linked MCP transports with actual authenticated loopback HTTP API; controlled schedule binding; no external scheduler or public MCP HTTP smoke",
        }),
        contentType: "application/json",
      });
    } finally {
      await host.close();
    }
  });

  test("an incomplete Finance owner can repair setup while Tasks remains reachable", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Browser runtime baseURL is required");
    const { human } = await createFinanceSetupPersona(page, baseURL);
    await human.updateAccountSetup({ action: "preferences", selectedWorkspaces: ["tasks"] });
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/tasks(?:[/?#]|$)/);
    await expect(page.getByRole("region", { name: "Setup review", exact: true })).toHaveCount(0);
    await page.goto("/finances/setup");
    const review = page.getByRole("region", { name: "Setup review", exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByRole("button", { name: "Finish setup", exact: true })).toBeDisabled();
    await page.goto("/finances/accounts");
    await expect(page).toHaveURL(/\/finances\/accounts(?:[/?#]|$)/);
    expect((await human.getFinanceOnboarding()).completedAt).toBeNull();
  });

  test("source loss preserves completion and account corrections in every manual visibility mode", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Browser runtime baseURL is required");
    const { human } = await createFinanceSetupPersona(page, baseURL);
    const account = await addReviewedManualSource(human);
    const completed = await completeFinanceSetupViaApi(human);
    await human.updateFinanceAccount(account.id, {
      idempotencyKey: randomUUID(),
      includeInPlanning: false,
    });
    for (const visibility of ["auto", "show", "hide"] as const) {
      const settings = await human.getWorkspaceSettings("finances");
      await human.updateWorkspaceSettings("finances", {
        expectedRevision: settings.revision,
        preferences: { financeManualVisibility: visibility },
      });
      await page.goto("/finances/accounts");
      await page.reload();
      const snapshot = await human.getFinanceOnboarding();
      expect(snapshot.completedAt).toBe(completed.completedAt);
      expect(snapshot.manualVisibility).toBe(visibility);
      expect(snapshot.source.state).toBe("missing");
      await expect(page.getByText("Setup checking", { exact: true })).toBeVisible();
      const creation = page.getByRole("button", { name: "Add account", exact: true });
      await expect(creation.first()).toBeVisible();
      await creation.first().click();
      const manual = page.getByRole("button", { name: "Track account manually", exact: true });
      if (visibility === "hide") await expect(manual).toHaveCount(0);
      else await expect(manual).toBeVisible();
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Account options for Setup checking", exact: true })
        .click();
      await page.getByRole("button", { name: "Edit Setup checking", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Edit account", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      // Canonical correction remains writable even while creation is hidden.
      await human.updateFinanceAccount(account.id, {
        idempotencyKey: randomUUID(),
        ownershipType: "joint",
        ownershipShare: 0.5,
      });
      expect(
        (await human.listFinanceAccounts()).accounts.find((item) => item.id === account.id),
      ).toMatchObject({ ownershipType: "joint", ownershipShare: 0.5, includeInPlanning: false });
    }
    await page.goto("/finances/setup");
    await expect(page.getByText("Setup complete. Your workspace remains available.")).toBeVisible();
  });

  test("unknown and none persist separately; Later finishes only with server confirmation", async ({
    page,
    baseURL,
  }, info) => {
    if (!baseURL) throw new Error("Browser runtime baseURL is required");
    const { human, email } = await createFinanceSetupPersona(page, baseURL);
    const initial = await human.getFinanceOnboarding();
    expect(initial.completedAt).toBeNull();
    expect(initial.source.state).toBe("missing");
    await addReviewedManualSource(human);
    const source = await human.getFinanceOnboarding();
    expect(source.source.state).toBe("usable");
    const intendedRoute = "/finances/spending?from=setup-browser#monthly";
    await page.goto(intendedRoute);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/finances/setup" && url.searchParams.get("returnTo") === intendedRoute,
    );
    const review = page.getByRole("region", { name: "Setup review", exact: true });
    for (const question of source.questions) {
      const field = review.getByLabel(question.label, { exact: true });
      if (!question.allowsNone) await expect(field.locator('option[value="none"]')).toHaveCount(0);
      await field.selectOption(question.allowsNone ? "none" : "unknown");
    }
    await review.getByLabel("I reviewed my display preferences").check();
    await review.getByRole("radio", { name: "Use Finance manually", exact: true }).check();
    await expect(review.getByRole("button", { name: "Finish setup", exact: true })).toBeDisabled();
    await review.getByRole("button", { name: "Save review", exact: true }).click();
    await expect(page.getByText("Setup review saved", { exact: true })).toBeVisible();
    const saved = await human.getFinanceOnboarding();
    expect(saved.revision).toBeGreaterThan(source.revision);
    expect(saved.completedAt).toBeNull();
    await page.reload();
    for (const question of saved.questions) {
      expect(question.disposition).toBe(question.allowsNone ? "none" : "unknown");
      await expect(review.getByLabel(question.label, { exact: true })).toHaveValue(
        question.disposition,
      );
    }
    // Insurance is canonical profile material outside the essential setup answers.
    // Advancing that profile version must not reinterpret explicit unknown as zero/none.
    const profileBefore = (await human.getFinancialProfile()).data;
    const profileAfter = await human.updateFinancialProfile({
      expectedVersion: profileBefore?.version ?? 0,
      idempotencyKey: randomUUID(),
      changes: {
        insurance: [
          {
            name: "Disposable coverage",
            kind: "property",
            status: "unknown",
            annualPremium: null,
            coverageAmount: null,
          },
        ],
      },
    });
    expect(profileAfter.data.version).toBeGreaterThan(profileBefore?.version ?? 0);
    await review.getByRole("button", { name: "Reload setup review", exact: true }).click();
    const afterProfile = await human.getFinanceOnboarding();
    expect(
      afterProfile.questions.map(({ questionId, disposition }) => ({ questionId, disposition })),
    ).toEqual(saved.questions.map(({ questionId, disposition }) => ({ questionId, disposition })));
    for (const question of afterProfile.questions) {
      await expect(review.getByLabel(question.label, { exact: true })).toHaveValue(
        question.disposition,
      );
    }
    await page.reload();
    expect((await human.getFinanceOnboarding()).questions.map((q) => q.disposition)).toEqual(
      saved.questions.map((q) => q.disposition),
    );
    const finishedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/finances/onboarding/complete") &&
        response.request().method() === "POST",
    );
    await review.getByRole("button", { name: "Finish setup", exact: true }).click();
    const response = await finishedResponse;
    expect(response.ok()).toBe(true);
    const completed = await human.getFinanceOnboarding();
    expect(completed.completedAt).not.toBeNull();
    expect(completed.revision).toBeGreaterThan(saved.revision);
    expect(completed.automation.registrationCount).toBe(0);
    expect(completed.automation.canSendChat).toBe(false);
    await page.reload();
    expect((await human.getFinanceOnboarding()).completedAt).toBe(completed.completedAt);
    await expect(
      review.getByText("Setup complete. Your workspace remains available."),
    ).toBeVisible();
    await expect(review.getByRole("link", { name: "Continue", exact: true })).toHaveAttribute(
      "href",
      intendedRoute,
    );
    await review.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(
      (url) => `${url.pathname}${url.search}${url.hash}` === intendedRoute,
    );
    await page.goto("/finances/accounts");
    await expect(page.getByText("Setup checking", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await info.attach("durable-snapshots", {
      body: JSON.stringify({ email, initial, source, saved, completed }),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("manual-complete.png"), fullPage: true });
  });

  test("a concurrent save preserves the draft and requires explicit reload", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Browser runtime baseURL is required");
    const { human } = await createFinanceSetupPersona(page, baseURL);
    await addReviewedManualSource(human);
    await page.goto("/finances/setup");
    const review = page.getByRole("region", { name: "Setup review", exact: true });
    await expect(
      review.getByRole("radio", { name: "Set up with an agent", exact: true }),
    ).toBeVisible();
    const snapshot = await human.getFinanceOnboarding();
    await review.getByRole("radio", { name: "Set up with an agent", exact: true }).check();
    const concurrent = await human.saveFinanceOnboardingAnswers({
      expectedRevision: snapshot.revision,
      idempotencyKey: randomUUID(),
      answers: [],
      automationChoice: "later",
      displayPreferencesReviewed: true,
    });
    await review.getByRole("button", { name: "Save review", exact: true }).click();
    await expect(
      page.getByText(
        "Setup outcome unconfirmed. Your edits are still here. Reload the review before trying again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      review.getByRole("radio", { name: "Set up with an agent", exact: true }),
    ).toBeChecked();
    await expect(review.getByRole("button", { name: "Save review", exact: true })).toBeDisabled();
    expect((await human.getFinanceOnboarding()).revision).toBe(concurrent.revision);
    await review.getByRole("button", { name: "Reload setup review", exact: true }).click();
    await expect(review.getByLabel("Automation", { exact: true })).toHaveValue("later");
    expect((await human.getFinanceOnboarding()).completedAt).toBeNull();
  });

  test("Finish transport failure leaves completion unconfirmed until explicit recovery", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Browser runtime baseURL is required");
    const { human } = await createFinanceSetupPersona(page, baseURL);
    await addReviewedManualSource(human);
    const initial = await human.getFinanceOnboarding();
    const saved = await human.saveFinanceOnboardingAnswers({
      expectedRevision: initial.revision,
      idempotencyKey: randomUUID(),
      automationChoice: "later",
      displayPreferencesReviewed: true,
      answers: initial.questions.map(({ questionId }) => ({ questionId, disposition: "unknown" })),
    });
    await page.goto("/finances/setup");
    const review = page.getByRole("region", { name: "Setup review", exact: true });
    await page.route("**/v1/finances/onboarding/complete", (route) => route.abort("failed"));
    await review.getByRole("button", { name: "Finish setup", exact: true }).click();
    await expect(
      page.getByText(
        "Setup outcome unconfirmed. Your edits are still here. Reload the review before trying again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(review.getByRole("button", { name: "Finish setup", exact: true })).toBeDisabled();
    expect(await human.getFinanceOnboarding()).toMatchObject({
      revision: saved.revision,
      completedAt: null,
    });
    await expect(review.getByText("Setup complete. Your workspace remains available.")).toHaveCount(
      0,
    );
    await page.unroute("**/v1/finances/onboarding/complete");
    await review.getByRole("button", { name: "Reload setup review", exact: true }).click();
    await expect(page.getByText("Setup review reloaded", { exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Finish setup", exact: true }).click();
    await expect(page.getByText("Setup complete", { exact: true })).toBeVisible();
    const completed = await human.getFinanceOnboarding();
    expect(completed.completedAt).not.toBeNull();
    await page.reload();
    expect((await human.getFinanceOnboarding()).completedAt).toBe(completed.completedAt);
  });

  test("load and save transport failures preserve draft and retry reloads real state", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Browser runtime baseURL is required");
    const { human } = await createFinanceSetupPersona(page, baseURL);
    await addReviewedManualSource(human);
    const before = await human.getFinanceOnboarding();
    await page.route("**/v1/finances/onboarding", (route) => route.abort("failed"));
    await page.goto("/finances/setup");
    await expect(
      page.getByText("Finance setup could not be checked. Try again.", { exact: true }),
    ).toBeVisible();
    await page.unroute("**/v1/finances/onboarding");
    await page.getByRole("button", { name: "Retry setup review", exact: true }).click();
    const review = page.getByRole("region", { name: "Setup review", exact: true });
    await review.getByRole("radio", { name: "Use Finance manually", exact: true }).check();
    await page.route("**/v1/finances/onboarding/answers", (route) => route.abort("failed"));
    await review.getByRole("button", { name: "Save review", exact: true }).click();
    await expect(
      page.getByText(
        "Setup outcome unconfirmed. Your edits are still here. Reload the review before trying again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      review.getByRole("radio", { name: "Use Finance manually", exact: true }),
    ).toBeChecked();
    await expect(review.getByRole("button", { name: "Save review", exact: true })).toBeDisabled();
    const after: FinanceOnboardingSnapshot = await human.getFinanceOnboarding();
    expect(after.revision).toBe(before.revision);
    expect(after.completedAt).toBeNull();
    await page.unroute("**/v1/finances/onboarding/answers");
    await review.getByRole("button", { name: "Reload setup review", exact: true }).click();
    await expect(
      review.getByRole("radio", { name: "Use Finance manually", exact: true }),
    ).not.toBeChecked();
  });
});
