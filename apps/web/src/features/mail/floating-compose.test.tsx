// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { MailDraft, MailSetupAccount } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { FloatingMailComposer } from "./floating-compose.js";

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
  intent,
  onIntentHandled,
}: {
  accounts?: MailSetupAccount[];
  intent?: Parameters<typeof FloatingMailComposer>[0]["intent"];
  onIntentHandled?: () => void;
} = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <FloatingMailComposer
        accounts={accounts}
        {...(intent === undefined ? {} : { intent })}
        {...(onIntentHandled === undefined ? {} : { onIntentHandled })}
      />
    </QueryClientProvider>,
  );
}

describe("FloatingMailComposer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens from the end-justified plus action and restores focus on Escape", async () => {
    renderComposer();
    const trigger = screen.getByRole("button", { name: "Compose a message" });
    await userEvent.click(trigger);
    expect(screen.getByRole("region", { name: "New message" })).toBeVisible();
    expect(screen.getByLabelText("To")).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "New message" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("region", { name: "New message" })).not.toBeInTheDocument();
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

    expect(await screen.findByRole("region", { name: "New message" })).toBeVisible();
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
    expect(screen.queryByRole("region", { name: "New message" })).not.toBeInTheDocument();
  });

  it("keeps reconnect-only accounts visible while preventing send", async () => {
    const reconnectAccount = {
      ...account,
      email: null,
      sendCapability: "reconnect" as const,
    };
    renderComposer({ accounts: [reconnectAccount] });

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Reconnect this account before sending");
    expect(screen.getByRole("option", { name: "Personal" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review and send" })).toBeDisabled();
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
    expect(await screen.findByRole("region", { name: "New message" })).toBeVisible();
    expect(screen.getByLabelText("From")).toHaveValue(account.accountId);
    expect(screen.getByRole("button", { name: "Review and send" })).toBeDisabled();
    first.unmount();

    const reconnectAccount = { ...account, sendCapability: "reconnect" as const };
    const reconnect = renderComposer({ accounts: [reconnectAccount], intent: {} });
    expect(await screen.findByLabelText("From")).toHaveValue(reconnectAccount.accountId);
    reconnect.unmount();

    renderComposer({ accounts: [], intent: {} });
    await screen.findByRole("region", { name: "New message" });
    expect(screen.getByLabelText("From")).not.toHaveValue(account.accountId);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review and send" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "New message" })).not.toBeInTheDocument();
  });

  it("keeps the composer open when saving on close fails", async () => {
    vi.spyOn(api, "createMailDraft").mockRejectedValue(new Error("Draft storage unavailable"));
    renderComposer();

    await userEvent.click(screen.getByRole("button", { name: "Compose a message" }));
    await userEvent.type(screen.getByLabelText("Subject"), "Do not lose this");
    await userEvent.keyboard("{Escape}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Draft storage unavailable");
    expect(screen.getByRole("region", { name: "New message" })).toBeVisible();
  });

  it("returns a failed send to the editable durable draft", async () => {
    const updated = { ...draft, updatedAt: "2026-08-28T12:00:04.000Z" };
    vi.spyOn(api, "updateMailDraft").mockResolvedValue(updated);
    vi.spyOn(api, "sendMailDraft").mockRejectedValue(new Error("Provider rejected delivery"));
    renderComposer({ intent: { draft } });

    await screen.findByRole("region", { name: "New message" });
    await userEvent.click(screen.getByRole("button", { name: "Review and send" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Send this message?" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Review and send" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Provider rejected delivery");
    expect(screen.queryByRole("dialog", { name: "Send this message?" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "New message" })).toBeVisible();
  });
});
