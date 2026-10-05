// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageAttachments } from "./message-attachments";

const file = { id: "file", filename: "notes.txt", contentType: "text/plain", size: 5 };
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());
it("previews text as text and releases the object URL on close", async () => {
  const load = vi.fn(async () => ({
    ...file,
    filename: "notes.txt",
    data: btoa("<script>hello</script>"),
  }));
  render(<MessageAttachments attachments={[file]} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("<script>hello</script>");
  expect(document.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test"));
});
it("shows failure and retries without claiming a successful download", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("Account needs reconnecting"))
    .mockResolvedValueOnce({ ...file, data: btoa("hello") });
  render(<MessageAttachments attachments={[file]} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Account needs reconnecting");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("hello");
});
it("offers download but no active-content preview for HTML", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const load = vi.fn(async () => ({
    filename: "page.html",
    contentType: "text/html",
    data: btoa("<script>bad()</script>"),
    size: 22,
  }));
  render(
    <MessageAttachments
      attachments={[{ ...file, filename: "page.html", contentType: "text/html" }]}
      load={load}
    />,
  );
  expect(screen.queryByRole("button", { name: /Preview/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Download page.html" }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  click.mockRestore();
});
