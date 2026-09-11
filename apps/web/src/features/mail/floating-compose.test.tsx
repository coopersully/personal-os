// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { MailDraft, MailSetupAccount } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { FloatingMailComposer, isRetrySafeMailSendFailure } from "./floating-compose.js";

const account: MailSetupAccount = {
  accountId: "22222222-2222-4222-8222-222222222222",
  automation: {
    failedCount: 0,
    inProgressCount: 0,
    lastCompletedAt: null,
    pendingCount: 0,
    reconciliationCount: 0,
  },
  automaticRuleExecution: true,
  email: "me@example.com",
  health: { message: null, nextSyncAt: null, recovery: null, state: "ready" },
  label: "Personal",
  lastSyncAttemptAt: null,
  lastSyncedAt: null,
  mailboxes: [],
  nextSyncAt: null,
  provider: "google",
  sendCapability: "available",
  syncError: null,
  syncStatus: "idle",
};

const draft: MailDraft = {
  accountId: account.accountId,
  body: "Hello there",
  cc: [],
  createdAt: "2026-08-28T12:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  reconciliationState: "none",
  sendClaimedAt: null,
  sendStatus: "draft",
  sentAt: null,
  subject: "Hello",
  threadId: null,
  to: [{ address: "you@example.com", name: null }],
  updatedAt: "2026-08-28T12:00:01.000Z",
};

function renderComposer({
  accounts = [account],
  accountsState,
  intent,
  onIntentHandled,
  onRetryAccounts,
}: {
  accounts?: MailSetupAccount[];
  accountsState?: Parameters<typeof FloatingMailComposer>[0]["accountsState"];
  intent?: Parameters<typeof FloatingMailComposer>[0]["intent"];
  onIntentHandled?: () => void;
  onRetryAccounts?: () => void;
} = {}) {
  return render(
    <MemoryRouter initialEntries={["/mail"]}>
      <QueryClientProvider client={new QueryClient()}>
        <FloatingMailComposer
          accounts={accounts}
          {...(accountsState === undefined ? {} : { accountsState })}
          {...(intent === undefined ? {} : { intent })}
          {...(onIntentHandled === undefined ? {} : { onIntentHandled })}
          {...(onRetryAccounts === undefined ? {} : { onRetryAccounts })}
        />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{`${location.pathname}${location.search}`}</output>;
}

describe("FloatingMailComposer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("recognizes only explicit retry-safe provider failures", () => {
    expect(isRetrySafeMailSendFailure(new Error("ambiguous"))).toBe(false);
    expect(
      isRetrySafeMailSendFailure(
        new ApiClientError({ code: "conflict", message: "conflict", status: 409 }),
      ),
    ).toBe(false);
    expect(
      isRetrySafeMailSendFailure(
        new ApiClientError({
          code: "service_unavailable",
          details: { retrySafe: false },
          message: "not safe",
          status: 503,
        }),
      ),
    ).toBe(false);
    expect(
      isRetrySafeMailSendFailure(
        new ApiClientError({
          code: "service_unavailable",
          details: { retrySafe: true },
          message: "safe",
          status: 503,
        }),
      ),
    ).toBe(true);
  });

  it("opens from the end-justified plus action and restores focus on Escape", async () => {
    renderComposer();
    const trigger = screen.getByRole("button", { name: "Compose a message" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "New message" })).toBeVisible();
    expect(screen.getByLabelText("To")).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "New message" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compose a message" })).toHaveFocus();
  });

  it("saves a just-typed draft before closing", async () => {
    const create = vi.spyOn(api, "createMailDraft").mockResolvedValue(draft);
    renderComposer();

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    await userEvent.type(screen.getByLabelText("Subject"), "A thought");
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ subject: "A thought" }));
    expect(screen.queryByRole("dialog", { name: "New message" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compose a message" })).toHaveFocus();
  });

  it("autosaves a durable draft and requires confirmation before sending", async () => {
    const create = vi.spyOn(api, "createMailDraft").mockResolvedValue(draft);
    vi.spyOn(api, "updateMailDraft").mockResolvedValue({
      ...draft,
      updatedAt: "2026-08-28T12:00:02.000Z",
    });
    const send = vi.spyOn(api, "sendMailDraft").mockResolvedValue();
    renderComposer();

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    await userEvent.type(screen.getByLabelText("To"), "you@example.com");
    await userEvent.type(screen.getByLabelText("Subject"), "Hello");
    await userEvent.type(screen.getByLabelText("Message"), "Hello there");

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(screen.getByText("Saved")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Review and send" }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Send this message?" })).toBeVisible();
    expect(screen.getByText("you@example.com")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        confirmedUpdatedAt: "2026-08-28T12:00:02.000Z",
        draftId: draft.id,
      }),
    );
  });

  it("offers an explicit draft save action", async () => {
    const create = vi.spyOn(api, "createMailDraft").mockResolvedValue(draft);
    const successToast = vi.spyOn(toast, "success");
    renderComposer();

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(successToast).toHaveBeenCalledWith("Draft saved");
  });

  it("opens and updates an existing Cc draft from a reply or Drafts intent", async () => {
    const existing = {
      ...draft,
      cc: [{ address: "copy@example.com", name: null }],
      threadId: "44444444-4444-4444-8444-444444444444",
    };
    const updated = { ...existing, subject: "Hello again", updatedAt: "2026-08-28T12:00:03.000Z" };
    const update = vi.spyOn(api, "updateMailDraft").mockResolvedValue(updated);
    const handled = vi.fn();

    renderComposer({ intent: { draft: existing }, onIntentHandled: handled });

    expect(await screen.findByRole("dialog", { name: "New message" })).toBeVisible();
    expect(screen.getByLabelText("Cc")).toHaveValue("copy@example.com");
    expect(screen.getByLabelText("Subject")).toHaveValue("Hello");
    expect(handled).toHaveBeenCalledOnce();
    await userEvent.clear(screen.getByLabelText("Subject"));
    await userEvent.type(screen.getByLabelText("Subject"), "Hello again");
    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        existing.id,
        expect.objectContaining({
          expectedUpdatedAt: existing.updatedAt,
          subject: "Hello again",
          threadId: existing.threadId,
        }),
      ),
    );
    expect(screen.queryByRole("dialog", { name: "New message" })).not.toBeInTheDocument();
  });

  it("removes reconnect-only accounts from sender selection and offers recovery", async () => {
    const reconnectAccount = {
      ...account,
      email: null,
      sendCapability: "reconnect" as const,
    };
    renderComposer({ accounts: [reconnectAccount] });

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Reconnect an account to compose");
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect account" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Review and send" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect account" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/settings?section=connections",
    );
  });

  it("keeps loading and multi-account recovery states explicit", async () => {
    const loading = renderComposer({ accounts: [], accountsState: "loading" });
    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Loading mail accounts");
    loading.unmount();

    const reconnectAccount = { ...account, sendCapability: "reconnect" as const };
    renderComposer({
      accounts: [
        reconnectAccount,
        { ...reconnectAccount, accountId: "55555555-5555-4555-8555-555555555555" },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    expect(screen.getByRole("button", { name: "Reconnect 2 accounts" })).toBeEnabled();
  });

  it("persists pending edits before navigating to Connections", async () => {
    let resolveDraft: ((saved: MailDraft) => void) | undefined;
    const create = vi.spyOn(api, "createMailDraft").mockImplementation(
      () =>
        new Promise<MailDraft>((resolve) => {
          resolveDraft = resolve;
        }),
    );
    const view = renderComposer();
    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    await userEvent.type(screen.getByLabelText("Subject"), "Keep this draft");

    view.rerender(
      <MemoryRouter initialEntries={["/mail"]}>
        <QueryClientProvider client={new QueryClient()}>
          <FloatingMailComposer accounts={[{ ...account, sendCapability: "reconnect" }]} />
          <LocationProbe />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Reconnect account" }));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ subject: "Keep this draft" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/mail");
    resolveDraft?.(draft);
    await waitFor(() =>
      expect(screen.getByLabelText("Current route")).toHaveTextContent(
        "/settings?section=connections",
      ),
    );
  });

  it("never offers a disconnected account when another sender is available", async () => {
    const reconnectAccount = {
      ...account,
      accountId: "55555555-5555-4555-8555-555555555555",
      email: "offline@example.com",
      label: "Disconnected",
      sendCapability: "reconnect" as const,
    };
    renderComposer({ accounts: [account, reconnectAccount] });

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));

    expect(screen.getByLabelText("From")).toHaveTextContent("Personalme@example.com");
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
  });

  it("keeps account setup failures recoverable without dropping the compose action", async () => {
    const retry = vi.fn();
    renderComposer({ accounts: [], accountsState: "error", onRetryAccounts: retry });

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Mail accounts are unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "New message" })).toBeVisible();
  });

  it("continues a later queued autosave after an earlier save fails", async () => {
    let rejectFirst: (reason: Error) => void = () => undefined;
    const firstSave = new Promise<MailDraft>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const create = vi
      .spyOn(api, "createMailDraft")
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ ...draft, subject: "First updated" });
    const errorToast = vi.spyOn(toast, "error");
    renderComposer();

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    await userEvent.type(screen.getByLabelText("Subject"), "First");
    await waitFor(() => expect(create).toHaveBeenCalledOnce(), { timeout: 2_000 });
    await userEvent.type(screen.getByLabelText("Subject"), " updated");
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    rejectFirst(new Error("Temporary draft failure"));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0]).toMatchObject({ subject: "First updated" });
    expect(errorToast).toHaveBeenCalledWith("Draft couldn’t be saved", {
      description: "Temporary draft failure",
    });
  });

  it("prefills and saves a new reply or forward intent", async () => {
    const created = {
      ...draft,
      body: "Quoted context",
      subject: "Re: Hello",
      threadId: "44444444-4444-4444-8444-444444444444",
    };
    const create = vi.spyOn(api, "createMailDraft").mockResolvedValue(created);
    renderComposer({
      intent: {
        accountId: account.accountId,
        body: created.body,
        subject: created.subject,
        threadId: created.threadId ?? undefined,
        to: "you@example.com",
      },
    });

    expect(await screen.findByLabelText("To")).toHaveValue("you@example.com");
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: Hello");
    expect(screen.getByLabelText("Message")).toHaveValue("Quoted context");
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: account.accountId,
          body: "Quoted context",
          subject: "Re: Hello",
          threadId: created.threadId,
        }),
      ),
    );
  });

  it("opens an empty intent and an account-free composer without inventing send authority", async () => {
    const first = renderComposer({ intent: {} });
    expect(await screen.findByRole("dialog", { name: "New message" })).toBeVisible();
    expect(screen.getByLabelText("From")).toHaveTextContent("Personalme@example.com");
    expect(screen.getByRole("button", { name: "Review and send" })).toBeDisabled();
    first.unmount();

    const reconnectAccount = { ...account, sendCapability: "reconnect" as const };
    const reconnect = renderComposer({ accounts: [reconnectAccount], intent: {} });
    expect(await screen.findByRole("alert")).toHaveTextContent("Reconnect an account to compose");
    reconnect.unmount();

    renderComposer({ accounts: [], intent: {} });
    await screen.findByRole("dialog", { name: "New message" });
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review and send" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "New message" })).not.toBeInTheDocument();
  });

  it("keeps the composer open when saving on close fails", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.spyOn(api, "createMailDraft").mockRejectedValue(new Error("Draft storage unavailable"));
    renderComposer();

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    await userEvent.type(screen.getByLabelText("Subject"), "Do not lose this");
    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith("Draft couldn’t be saved", {
        description: "Draft storage unavailable",
      }),
    );
    expect(screen.getByRole("dialog", { name: "New message" })).toBeVisible();
  });

  it("returns a failed send to the editable durable draft", async () => {
    const errorToast = vi.spyOn(toast, "error");
    const updated = { ...draft, updatedAt: "2026-08-28T12:00:04.000Z" };
    const released = { ...updated, updatedAt: "2026-08-28T12:00:05.000Z" };
    const edited = {
      ...released,
      body: "Hello there again",
      updatedAt: "2026-08-28T12:00:06.000Z",
    };
    const update = vi
      .spyOn(api, "updateMailDraft")
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(edited);
    vi.spyOn(api, "listMailDrafts").mockResolvedValue([released]);
    vi.spyOn(api, "sendMailDraft").mockRejectedValue(
      new ApiClientError({
        code: "service_unavailable",
        details: { retrySafe: true },
        message: "Provider rejected delivery",
        status: 503,
      }),
    );
    renderComposer({ intent: { draft } });

    await screen.findByRole("dialog", { name: "New message" });
    await userEvent.click(screen.getByRole("button", { name: "Review and send" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Send this message?" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Review and send" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith("Message couldn’t be sent", {
        description: "Provider rejected delivery",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Send this message?" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New message" })).toBeVisible();

    await userEvent.type(screen.getByLabelText("Message"), " again");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3), { timeout: 2_000 });
    expect(update.mock.calls[2]).toEqual([
      draft.id,
      expect.objectContaining({
        body: "Hello there again",
        expectedUpdatedAt: released.updatedAt,
      }),
    ]);
  });
});
