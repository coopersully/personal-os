// @vitest-environment jsdom
import type { CreateMailDraftInput } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailComposerScreen } from "./composer";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  pick: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
  list: vi.fn(),
  back: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  error: vi.fn(),
  success: vi.fn(),
  params: {} as { id?: string; threadId?: string; messageId?: string; mode?: string },
  source: undefined as unknown,
  records: [] as unknown[],
  capability: "available",
  prevent: false,
  onClose: () => {},
  alerts: [] as { text: string; onPress?: () => void }[][],
}));
vi.mock("./attachment-files", () => ({ pickAttachments: h.pick }));
const account = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const draft = {
  id: "33333333-3333-4333-8333-333333333333",
  accountId: account,
  to: [],
  cc: [],
  subject: "Lunch",
  body: "Friday?",
  threadId: null,
  sendStatus: "draft",
  updatedAt: "2026-11-09T12:00:00.000Z",
};
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "owner" } },
    session: {
      api: () => ({
        createMailDraft: h.create,
        updateMailDraft: h.update,
        sendMailDraft: h.send,
        listMailDrafts: h.list,
      }),
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    isPending: false,
    isError: false,
    data: queryKey.includes("accounts")
      ? {
          accounts: [
            {
              accountId: "11111111-1111-4111-8111-111111111111",
              label: "Personal",
              email: "sam@example.com",
              sendCapability: h.capability,
            },
            {
              accountId: "22222222-2222-4222-8222-222222222222",
              label: "Work",
              email: "work@example.com",
              sendCapability: "available",
            },
          ],
        }
      : queryKey.includes("compose-source")
        ? h.source
        : h.records,
  }),
}));
vi.mock("expo-router", () => ({
  router: { back: h.back },
  useLocalSearchParams: () => h.params,
  usePreventRemove: (prevent: boolean, close: () => void) => {
    h.prevent = prevent;
    h.onClose = close;
  },
  Stack: {
    Screen: ({
      options,
    }: {
      options: { headerLeft: () => unknown; headerRight: () => unknown };
    }) => (
      <header>
        {options.headerLeft() as React.ReactNode}
        {options.headerRight() as React.ReactNode}
      </header>
    ),
  },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  Alert: {
    alert: (
      _title: string,
      _message: string,
      buttons: { text: string; onPress?: () => void }[],
    ) => {
      h.alerts.push(buttons);
    },
  },
}));
vi.mock("sonner-native", () => ({
  toast: { loading: vi.fn(() => "toast"), error: h.error, success: h.success, dismiss: vi.fn() },
}));
vi.mock("../../components/app-toaster", () => ({ AppToaster: () => null }));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock("../../components/forms/form-save", () => ({
  useFormKeyboardOffset: () => 0,
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      Save changes
    </button>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.params = {};
  h.source = undefined;
  h.records = [];
  h.capability = "available";
  h.alerts = [];
  h.create.mockImplementation(async (input: CreateMailDraftInput) => ({ ...draft, ...input }));
  h.update.mockImplementation(async (_id, input) => ({
    ...draft,
    ...input,
    updatedAt: "2026-11-09T12:01:00.000Z",
  }));
  h.send.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("selects a sender, quietly autosaves, then explicitly saves and closes", async () => {
  render(<MailComposerScreen />);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "From, sam@example.com" }));
  fireEvent.click(screen.getByRole("radio", { name: "work@example.com" }));
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Lunch on Friday" } });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Are you free at noon?" },
  });
  await waitFor(
    () =>
      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: second,
          subject: "Lunch on Friday",
          body: "Are you free at noon?",
        }),
      ),
    { timeout: 1800 },
  );
  expect(h.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.create).toHaveBeenCalledOnce();
});
it("keeps invalid recipients and unsaved text open instead of silently discarding", async () => {
  render(<MailComposerScreen />);
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "unfinished@" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Keep this text" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Message")).toHaveValue("Keep this text");
  expect(h.back).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.alerts.at(-1)?.map((b) => b.text)).toEqual(["Keep writing", "Save draft"]);
});
it("requires explicit send confirmation for the saved revision", async () => {
  render(<MailComposerScreen />);
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "alex@example.com" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Lunch" } });
  fireEvent.click(screen.getByRole("button", { name: "Review and send" }));
  await waitFor(() => expect(h.alerts).toHaveLength(1));
  expect(h.send).not.toHaveBeenCalled();
  await act(async () => {
    h.alerts[0].find((b) => b.text === "Send")?.onPress?.();
  });
  await waitFor(() =>
    expect(h.send).toHaveBeenCalledWith({ draftId: draft.id, confirmedUpdatedAt: draft.updatedAt }),
  );
  expect(h.back).toHaveBeenCalledOnce();
});
it("reopens existing drafts and permits saving with a disconnected sender but prevents sending", async () => {
  h.params = { id: draft.id };
  h.records = [{ ...draft, to: [{ address: "alex@example.com", name: null }] }];
  h.capability = "reconnect";
  render(<MailComposerScreen />);
  expect(screen.getByLabelText("Message")).toHaveValue("Friday?");
  expect(screen.getByRole("button", { name: "Review and send" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Updated offline-capable account draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(h.update).toHaveBeenCalledWith(
      draft.id,
      expect.objectContaining({ expectedUpdatedAt: draft.updatedAt, accountId: account }),
    ),
  );
  expect(h.create).not.toHaveBeenCalled();
});

it("prefills the selected message, locks the reply account and persists its thread", async () => {
  h.params = { threadId: draft.id, messageId: "selected", mode: "replyAll" };
  h.source = {
    thread: { id: draft.id, accountId: second, subject: "Project review" },
    message: {
      threadId: draft.id,
      from: { address: "alex@example.com", name: null },
      to: [{ address: "work@example.com", name: null }],
      cc: [{ address: "pat@example.com", name: null }],
      replyTo: [],
      receivedAt: "2026-11-09T12:00:00.000Z",
      bodyText: "Original text",
      attachments: [],
    },
  };
  render(<MailComposerScreen />);
  expect(screen.getByRole("button", { name: "From, work@example.com" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  expect(screen.getByLabelText("To")).toHaveValue("alex@example.com");
  expect(screen.getByLabelText("Cc")).toHaveValue("pat@example.com");
  expect(screen.getByLabelText("Subject")).toHaveValue("Re: Project review");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks, looks good." } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: second, threadId: draft.id }),
    ),
  );
});

it("adds and removes files through the same durable draft writer", async () => {
  const file = {
    id: "file-1",
    filename: "Lunch menu.pdf",
    contentType: "application/pdf",
    size: 4,
    data: "dGVzdA==",
  };
  h.pick.mockResolvedValue([file]);
  h.create.mockImplementation(async (input: CreateMailDraftInput) => ({
    ...draft,
    ...input,
    attachments: (input.attachments ?? []).map(({ data, ...metadata }) => metadata),
  }));
  render(<MailComposerScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Add attachments" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "View Lunch menu.pdf, 1 KB" })).toBeInTheDocument(),
  );
  await waitFor(
    () => expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ attachments: [file] })),
    { timeout: 1800 },
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove Lunch menu.pdf" }));
  await waitFor(
    () =>
      expect(h.update).toHaveBeenCalledWith(draft.id, expect.objectContaining({ attachments: [] })),
    { timeout: 1800 },
  );
  expect(h.send).not.toHaveBeenCalled();
});
it("reports picker failures through Sonner without an inline error", async () => {
  h.pick.mockRejectedValue(new Error("Attachments must total 10 MB or less."));
  render(<MailComposerScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Add attachments" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Attachments must total 10 MB or less."),
  );
  expect(screen.queryByText("Attachments must total 10 MB or less.")).not.toBeInTheDocument();
  expect(h.create).not.toHaveBeenCalled();
});
