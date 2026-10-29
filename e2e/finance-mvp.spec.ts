import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { expect, test } from "@playwright/test";
import { qaFixtureAccounts } from "../apps/api/src/qa-fixtures.js";
import type {
  FinanceAnswer,
  FinanceContextualQuestionResult,
} from "../packages/domain/src/index.js";

const owner = qaFixtureAccounts.find((account) => account.key === "demo-full");
const other = qaFixtureAccounts.find((account) => account.key === "qa-empty");
if (!owner || !other) throw new Error("Finance acceptance requires the demo and empty fixtures.");

test("saved manual context survives reload without changing the ledger and stays owner-only", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Log in" }).click();
  const { sessionToken } = await (await login).json();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  const headers = { authorization: `Session ${sessionToken}` };
  const accountResponse = await page.request.post("/v1/finances/accounts", {
    headers,
    data: {
      name: `Acceptance ${testInfo.project.name}`,
      institution: "Fixture",
      provider: "manual",
    },
  });
  expect(accountResponse.status()).toBe(201);
  const { account } = await accountResponse.json();
  const guardedBodyStartedAt = performance.now();
  let bodyThrew = false;
  let bodyError: unknown;
  let bodyCompleted = false;
  let stepFailed = false;
  let cleanupThrew = false;
  let cleanupError: unknown;
  try {
    await test.step("Finance manual context body", async () => {
      try {
        const transactionResponse = await page.request.post("/v1/finances/transactions", {
          headers,
          data: {
            accountId: account.id,
            merchant: "Acceptance manual purchase",
            amount: 120,
            date: "2026-09-15",
            direction: "expense",
          },
        });
        expect(transactionResponse.status()).toBe(201);
        const { transaction } = await transactionResponse.json();
        const questionResponse = await page.request.post(
          `/v1/finances/transactions/${transaction.id}/contextual-question`,
          { headers, data: { operationId: randomUUID() } },
        );
        expect(questionResponse.ok()).toBe(true);
        const result = (await questionResponse.json()) as FinanceContextualQuestionResult;
        expect(result.state).toBe("available");
        if (result.state !== "available") throw new Error("Manual context question unavailable.");
        const question = result.question;
        await page.goto(`/finances/review?contextualQuestion=${question.id}`);
        await expect(
          page.getByRole("heading", { name: "Acceptance manual purchase" }),
        ).toBeVisible();
        await page
          .getByLabel(question.prompt)
          .fill("Workshop supplies; expecting half reimbursed.");
        const savedResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/v1/finances/contextual-questions/answer") &&
            response.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Save context", exact: true }).click();
        const saved = await savedResponse;
        expect(saved.ok()).toBe(true);
        expect((await saved.json()).state).toBe("accepted");
        const command = saved.request().postDataJSON() as FinanceAnswer;
        await expect(page.getByText(/1 completed · \d+ left · \d+ total/)).toBeVisible();
        await page.reload();
        await expect(page.getByText("Answered · financial review open")).toBeVisible();
        const replay = await page.request.post("/v1/finances/contextual-questions/answer", {
          headers,
          data: command,
        });
        expect(replay.ok()).toBe(true);
        expect((await replay.json()).state).toBe("accepted");
        const ledgerResponse = await page.request.get(
          `/v1/finances/transactions/${transaction.id}`,
          {
            headers,
          },
        );
        expect(ledgerResponse.ok()).toBe(true);
        const ledger = await ledgerResponse.json();
        expect(ledger.transaction ?? ledger.data ?? ledger).toMatchObject({
          amount: 120,
          category: null,
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath("finance-saved-context.png"),
          fullPage: true,
        });

        const foreignLogin = await page.request.post("/v1/auth/login", {
          data: { email: other.email, password: other.password },
        });
        expect(foreignLogin.ok()).toBe(true);
        const foreignSession = await foreignLogin.json();
        const foreignHeaders = { authorization: `Session ${foreignSession.sessionToken}` };
        const foreignRead = await page.request.get(
          `/v1/finances/contextual-questions/${question.id}`,
          {
            headers: foreignHeaders,
          },
        );
        expect(foreignRead.ok()).toBe(true);
        expect((await foreignRead.json()).state).toBe("unavailable");
        const foreignAnswer = await page.request.post("/v1/finances/contextual-questions/answer", {
          headers: foreignHeaders,
          data: { ...command, operationId: randomUUID() },
        });
        expect(foreignAnswer.ok()).toBe(true);
        expect((await foreignAnswer.json()).state).not.toBe("accepted");
        bodyCompleted = true;
      } catch (error) {
        bodyThrew = true;
        bodyError = error;
        // Only this fixed sentinel crosses step instrumentation; restore the original outside it.
        throw new Error("Finance manual context body failed.");
      }
    });
  } catch (stepError) {
    stepFailed = true;
    if (bodyThrew) throw bodyError;
    throw stepError;
  } finally {
    const cleanupStartedAt = performance.now();
    const guardedBodyMs = Math.max(0, Math.round(cleanupStartedAt - guardedBodyStartedAt));
    let cleanupOutcome: "pending" | "passed" | "threw" = "pending";
    let cleanupStatus: number | null = null;
    const observeCleanup = (phase: "start" | "end") => {
      try {
        console.info(
          JSON.stringify({
            event: "finance-context-cleanup",
            phase,
            bodyOutcome: bodyThrew ? "threw" : bodyCompleted ? "passed" : "unknown",
            stepOutcome: stepFailed ? "threw" : "passed",
            cleanupOutcome,
            cleanupStatus,
            guardedBodyMs,
            cleanupMs: Math.max(0, Math.round(performance.now() - cleanupStartedAt)),
            retry: testInfo.retry,
            configuredTimeoutMs: testInfo.timeout,
          }),
        );
      } catch {
        // Best-effort metadata must not replace the primary or cleanup exception.
      }
    };
    observeCleanup("start");
    try {
      const removed = await page.request.delete(`/v1/finances/accounts/${account.id}`, { headers });
      cleanupStatus = removed.status();
      expect(removed.status()).toBe(204);
      cleanupOutcome = "passed";
    } catch (error) {
      cleanupOutcome = "threw";
      cleanupThrew = true;
      cleanupError = error;
    } finally {
      observeCleanup("end");
    }
  }
  if (cleanupThrew) throw cleanupError;
});
