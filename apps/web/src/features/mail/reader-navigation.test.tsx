// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { MailMessage, MailThread } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Reader } from "./mail.js";

const thread: MailThread = {
  accountId: "11111111-1111-4111-8111-111111111111",
  bodyText: "Message 3",
  from: { address: "sender@example.com", name: "Sender" },
  id: "22222222-2222-4222-8222-222222222222",
  mailboxIds: [],
  messageCount: 3,
  provider: "google",
  receivedAt: "2026-10-09T12:00:00.000Z",
  remoteThreadId: "thread",
  snippet: "Message 3",
  starred: false,
  subject: "Conversation history",
  to: [],
  unread: false,
  updatedAt: "2026-10-09T12:00:00.000Z",
};
const messages: MailMessage[] = [0, 1, 2].map((index) => ({
  attachments: [],
  bodyText: `Message ${index + 1}`,
  cc: [],
  from: thread.from,
  id: `33333333-3333-4333-8333-33333333333${index}`,
  messageId: null,
  receivedAt: `2026-10-09T${10 + index}:00:00.000Z`,
  references: [],
  replyTo: [],
  threadId: thread.id,
  to: [],
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountReader(headerHeight = 64, reducedMotion = false) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reducedMotion })));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const viewport = this.closest<HTMLElement>(".mail-reader");
    const index = viewport
      ? [...viewport.querySelectorAll(".mail-reader__message")].indexOf(this)
      : -1;
    const top = index < 0 ? 100 : 100 + headerHeight + index * 300 - (viewport?.scrollTop ?? 0);
    const height = this.classList.contains("mail-reader__history-nav") ? headerHeight : 200;
    return { top, bottom: top + height, left: 0, right: 390, x: 0, y: top, width: 390, height, toJSON: () => ({}) };
  });
  const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    if (typeof options === "object") this.scrollTop = options.top ?? 0;
    fireEvent.scroll(this);
  });
  const result = render(
    <section
      aria-label="Message reader"
      className="mail-reader"
      style={{ scrollPaddingTop: 0 }}
      ref={(node) => { if (node) node.scrollTo = scrollTo; }}
    >
      <Reader messages={messages} thread={thread} timeZone="UTC" />
    </section>,
  );
  return { viewport: result.getByRole("region", { name: "Message reader", exact: true }), scrollTo };
}

it.each([false, true])("navigates to each nearest earlier message and removes the control at the start (reduced motion %s)", (reducedMotion) => {
  const { viewport, scrollTo } = mountReader(64, reducedMotion);
  expect(viewport.scrollTop).toBe(600);
  fireEvent.click(screen.getByRole("button", { name: "2 more messages above. Go to previous message" }));
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: reducedMotion ? "instant" : "smooth" });
  fireEvent.click(screen.getByRole("button", { name: "1 more message above. Go to previous message" }));
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: reducedMotion ? "instant" : "smooth" });
  expect(screen.queryByRole("button", { name: /Go to previous message/ })).not.toBeInTheDocument();
  expect(viewport.querySelector(".mail-reader__message")?.getBoundingClientRect().top).toBe(164);
});

it("uses the rendered header height with unpadded affordances and follows manual scrolling", () => {
  const { viewport, scrollTo } = mountReader(96);
  expect(viewport.scrollTop).toBe(600);
  expect(viewport.querySelector(".mail-reader__message:last-of-type")?.getBoundingClientRect().top).toBe(196);
  viewport.scrollTop = 300;
  fireEvent.scroll(viewport);
  fireEvent.click(screen.getByRole("button", { name: "1 more message above. Go to previous message" }));
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
  expect(screen.queryByRole("button", { name: /Go to previous message/ })).not.toBeInTheDocument();
});
