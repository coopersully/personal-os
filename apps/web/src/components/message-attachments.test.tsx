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
it("renders metadata without download access and handles unnamed files", () => {
  const { rerender } = render(<MessageAttachments attachments={[]} />);
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  rerender(
    <MessageAttachments
      attachments={[
        { ...file, filename: null, size: null },
        { ...file, id: "large", filename: "large.txt", size: 2 * 1024 * 1024 },
        { ...file, id: "small", filename: "small.txt", size: 2048 },
      ]}
    />,
  );
  expect(screen.getByText("3 attachments")).toBeVisible();
  expect(screen.getByText("text/plain")).toBeVisible();
  expect(screen.getByText("text/plain · 2.0 MB")).toBeVisible();
  expect(screen.getByText("text/plain · 2 KB")).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("previews an image and downloads from the preview", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const picture = { ...file, filename: "photo.png", contentType: "image/png" };
  const load = vi.fn(async () => ({ ...picture, data: btoa("pixels") }));
  const { unmount } = render(<MessageAttachments attachments={[picture]} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));
  expect(await screen.findByRole("img", { name: "photo.png" })).toHaveAttribute("src", "blob:test");
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(load).toHaveBeenCalledTimes(2);
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  click.mockRestore();
});
it.each([
  false,
  true,
])("ignores an attachment response after unmount (reject=%s)", async (reject) => {
  let resolve!: (value: {
    filename: string;
    contentType: string;
    data: string;
    size: number;
  }) => void;
  let fail!: (error: Error) => void;
  const load = vi.fn(
    () =>
      new Promise<{ filename: string; contentType: string; data: string; size: number }>((r, j) => {
        resolve = r;
        fail = j;
      }),
  );
  const { unmount } = render(<MessageAttachments attachments={[file]} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));
  expect(screen.getByText("Loading attachment…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Download notes.txt" })).toBeDisabled();
  unmount();
  if (reject) fail(new Error("Offline"));
  else resolve({ ...file, data: btoa("hello") });
  await Promise.resolve();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("falls back to downloading when the provider returns an unsafe preview type", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const load = vi
    .fn()
    .mockRejectedValueOnce("offline")
    .mockResolvedValueOnce({ ...file, contentType: "text/html", data: btoa("<b>hello</b>") });
  render(<MessageAttachments attachments={[file]} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn’t load the attachment. Try again.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  click.mockRestore();
});
it.each([
  'text/plain; charset="windows-1252"',
  "text/plain; charset=iso-8859-1",
])("decodes a declared text encoding (%s)", async (contentType) => {
  const load = vi.fn(async () => ({ ...file, contentType, data: btoa("caf\xe9") }));
  render(<MessageAttachments attachments={[{ ...file, contentType }]} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("café");
});
it("downloads text with an unsupported encoding instead of rendering corrupt text", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const load = vi.fn(async () => ({
    ...file,
    contentType: "text/plain; charset=unknown-format",
    data: btoa("hello"),
  }));
  render(<MessageAttachments attachments={[file]} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  click.mockRestore();
});

it("aborts an in-flight attachment when its tile is removed", async () => {
  let requestSignal: AbortSignal | undefined;
  const stopped = vi.fn();
  const load = vi.fn((_id: string, signal?: AbortSignal) => {
    requestSignal = signal;
    return new Promise<never>((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () => {
          stopped();
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
  const { unmount } = render(<MessageAttachments attachments={[file]} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));
  expect(requestSignal?.aborted).toBe(false);
  unmount();
  await waitFor(() => expect(stopped).toHaveBeenCalledOnce());
  expect(requestSignal?.aborted).toBe(true);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
