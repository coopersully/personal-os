// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SignIn from "../../app/sign-in";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../../test/native"));
const h = vi.hoisted(() => ({
  login: vi.fn(),
  recover: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "sign-in"),
  dismiss: vi.fn(),
}));
vi.mock("./context", () => ({ useOptionalAuth: () => null, useAuth: () => ({ session: h }) }));
vi.mock("sonner-native", () => ({ toast: h }));
beforeEach(() => {
  vi.clearAllMocks();
  h.login.mockReset().mockResolvedValue(undefined);
  h.recover.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
const credentials = () => {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "  person@example.test  " },
  });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "private-password" } });
};
it("validates locally through Sonner without making a login request", () => {
  render(<SignIn />);
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(h.error).toHaveBeenCalledWith("Enter your email and password.");
  expect(h.login).not.toHaveBeenCalled();
  expect(screen.queryByText("Enter your email and password.")).not.toBeInTheDocument();
});
it("signs in with a trimmed email, locks inputs while waiting and clears the password", async () => {
  let finish!: () => void;
  h.login.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<SignIn />);
  credentials();
  fireEvent.keyDown(screen.getByLabelText("Password"), { key: "Enter" });
  expect(h.login).toHaveBeenCalledExactlyOnceWith({
    email: "person@example.test",
    password: "private-password",
  });
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Forgot password?" })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText("Password"), { key: "Enter" });
  expect(h.login).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(h.dismiss).toHaveBeenCalledWith("sign-in");
});
it.each([
  [401, "Email or password is incorrect."],
  [429, "Too many attempts. Please try again later."],
  [500, "Couldn’t sign in. Check your connection and try again."],
])("reports a %i login failure and leaves credentials available for correction", async (status, message) => {
  h.login.mockRejectedValue(
    new ApiClientError({ status, code: "ERROR", message: "provider detail" }),
  );
  render(<SignIn />);
  credentials();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith(message, { id: "sign-in" }));
  expect(screen.getByLabelText("Password")).toHaveValue("private-password");
  expect(screen.queryByText(message)).not.toBeInTheDocument();
});
it("recovers with email alone and gives an enumeration-safe confirmation", async () => {
  render(<SignIn />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: " person@example.test " } });
  fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "If an account exists, a recovery email is on its way.",
      { id: "sign-in" },
    ),
  );
  expect(h.recover).toHaveBeenCalledExactlyOnceWith("person@example.test");
  expect(h.login).not.toHaveBeenCalled();
});
it("reports recovery transport failures in the same toast", async () => {
  h.recover.mockRejectedValue(new Error("offline"));
  render(<SignIn />);
  credentials();
  fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t send the recovery email. Please try again.", {
      id: "sign-in",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
});
