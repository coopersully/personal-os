// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextingSettings } from "./page.js";

const mocks = vi.hoisted(() => ({
  checkTextingVerification: vi.fn(),
  disconnectTexting: vi.fn(),
  getTextingConnection: vi.fn(),
  startTextingVerification: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TextingSettings />
    </QueryClientProvider>,
  );
}

describe("Texting settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTextingConnection.mockResolvedValue(null);
    mocks.startTextingVerification.mockResolvedValue({ id: "challenge-1" });
    mocks.checkTextingVerification.mockResolvedValue(undefined);
    mocks.disconnectTexting.mockResolvedValue(undefined);
  });

  it("walks through consent, verification, and connection", async () => {
    const user = userEvent.setup();
    const activeConnection = {
      id: "connection-1",
      maskedPhoneNumber: "+1 ***-***-0123",
      providerReady: true,
      senderPhoneNumber: "+1 ***-***-0456",
      state: "active",
    } as const;
    mocks.getTextingConnection.mockResolvedValueOnce(null).mockResolvedValue(activeConnection);
    mocks.checkTextingVerification.mockResolvedValueOnce(activeConnection);
    renderSettings();

    await user.type(await screen.findByLabelText("Mobile number"), "5555550123");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Send verification code" }));
    expect(await screen.findByLabelText("Verification code")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Verification code"), "1234");
    await user.click(screen.getByRole("button", { name: "Verify and connect" }));
    expect(mocks.checkTextingVerification).toHaveBeenCalledWith("challenge-1", { code: "1234" });
    expect(await screen.findByText(/Ready/)).toBeInTheDocument();
  });

  it("does not start verification without consent", async () => {
    renderSettings();
    const button = await screen.findByRole("button", { name: "Send verification code" });
    const form = button.closest("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);
    expect(mocks.startTextingVerification).not.toHaveBeenCalled();
  });

  it("shows active and opted-out connections with their recovery controls", async () => {
    const user = userEvent.setup();
    mocks.getTextingConnection.mockResolvedValueOnce({
      id: "connection-1",
      maskedPhoneNumber: "+1 ***-***-0123",
      providerReady: true,
      senderPhoneNumber: "+1 ***-***-0456",
      state: "active",
    });
    const activeView = renderSettings();
    expect(await screen.findByText(/Ready/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disconnect number" }));
    expect(mocks.disconnectTexting).toHaveBeenCalledOnce();
    activeView.unmount();

    mocks.getTextingConnection.mockResolvedValueOnce({
      id: "connection-2",
      maskedPhoneNumber: "+1 ***-***-0124",
      providerReady: true,
      senderPhoneNumber: null,
      state: "opted_out",
    });
    renderSettings();
    expect(await screen.findByText(/Blocked by Twilio opt-out/)).toBeInTheDocument();
    expect(screen.getByText(/ilo's shared number/)).toBeInTheDocument();
  });

  it("explains when texting is unavailable", async () => {
    mocks.getTextingConnection.mockResolvedValueOnce({ id: null, providerReady: false });
    renderSettings();
    expect(
      await screen.findByText("Texting is not configured on this ilo deployment."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send verification code" })).toBeDisabled();
  });

  it.each([
    "sync_error",
    "suspended",
  ] as const)("renders the %s connection state", async (state) => {
    mocks.getTextingConnection.mockResolvedValueOnce({
      id: "connection-3",
      maskedPhoneNumber: "+1 ***-***-0125",
      providerReady: true,
      senderPhoneNumber: "+1 ***-***-0456",
      state,
    });
    renderSettings();
    expect(await screen.findByText(new RegExp(state))).toBeInTheDocument();
  });

  it("renders a verification-check failure", async () => {
    const user = userEvent.setup();
    mocks.checkTextingVerification.mockRejectedValueOnce(new Error("Provider rejected code"));
    renderSettings();
    await user.type(await screen.findByLabelText("Mobile number"), "5555550123");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Send verification code" }));
    await user.type(await screen.findByLabelText("Verification code"), "1234");
    await user.click(screen.getByRole("button", { name: "Verify and connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider rejected code");
  });

  it("returns to setup when the connection is disconnected", async () => {
    mocks.getTextingConnection.mockResolvedValueOnce({
      id: "connection-4",
      maskedPhoneNumber: "+1 ***-***-0126",
      providerReady: true,
      senderPhoneNumber: "+1 ***-***-0456",
      state: "disconnected",
    });
    renderSettings();
    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
  });
});
