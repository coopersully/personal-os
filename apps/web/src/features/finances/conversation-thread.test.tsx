// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceConversationMessage } from "@personal-os/domain";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FinanceConversationThread } from "./conversation-thread";

const message: FinanceConversationMessage = {
  id: "source",
  sequence: "9007199254740993",
  authorKind: "user",
  text: "My source note",
  caseId: null,
  recordRefs: [],
  runId: null,
  sourceMessageIds: [],
  createdAt: "2026-10-18T12:00:00Z",
};
afterEach(() => vi.unstubAllGlobals());
it("renders both authors and navigates every supported record kind", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  render(
    <MemoryRouter>
      <FinanceConversationThread
        messages={[
          {
            ...message,
            recordRefs: [
              { kind: "transaction", id: "t &1" },
              { kind: "account", id: "a &1" },
              { kind: "contextual_question", id: "q &1" },
              { kind: "review_case", id: "r &1" },
            ],
          },
          {
            ...message,
            id: "agent",
            sequence: "9007199254740994",
            authorKind: "agent",
            text: "Agent reply",
          },
        ]}
        onRendered={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("article", { name: "Your message" })).toHaveTextContent("My source note");
  expect(screen.getByRole("article", { name: "Agent message" })).toHaveTextContent("Agent reply");
  for (const [name, href] of [
    ["transaction", "/finances/transactions?transactionId=t%20%261"],
    ["account", "/finances/accounts?accountId=a%20%261"],
    ["contextual question", "/finances/chat?question=q%20%261"],
    ["review case", "/finances/review/legacy?item=r%20%261"],
  ])
    expect(screen.getByRole("link", { name: `View ${name}` })).toHaveAttribute("href", href);
});
it("waits for a target, focuses it once, and allows refocusing after the target clears", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const onRendered = vi.fn();
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  const view = render(
    <MemoryRouter>
      <FinanceConversationThread
        messages={[message]}
        targetMessageId="later"
        onRendered={onRendered}
      />
    </MemoryRouter>,
  );
  expect(focus).not.toHaveBeenCalled();
  const later = { ...message, id: "later", sequence: "9007199254740994" };
  const draw = (targetMessageId: string | null) => (
    <MemoryRouter>
      <FinanceConversationThread
        messages={[message, later]}
        targetMessageId={targetMessageId}
        onRendered={onRendered}
      />
    </MemoryRouter>
  );
  view.rerender(draw("later"));
  expect(focus).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("listitem", { name: "Source message" })).toHaveFocus();
  view.rerender(draw("later"));
  expect(focus).toHaveBeenCalledTimes(1);
  view.rerender(draw(null));
  view.rerender(draw("later"));
  expect(focus).toHaveBeenCalledTimes(2);
  expect(onRendered).not.toHaveBeenCalled();
});
it("reports only intersecting sequenced rows while the document is visible and disconnects", () => {
  let callback: IntersectionObserverCallback = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const visibility = vi.spyOn(document, "visibilityState", "get");
  const rendered = vi.fn();
  const view = render(
    <MemoryRouter>
      <FinanceConversationThread messages={[message]} onRendered={rendered} />
    </MemoryRouter>,
  );
  const row = screen.getByRole("listitem");
  const notify = (target: Element, isIntersecting: boolean) =>
    act(() =>
      callback(
        [{ target, isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
  visibility.mockReturnValue("hidden");
  notify(row, true);
  expect(rendered).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  notify(row, false);
  notify(document.createElement("li"), true);
  expect(rendered).not.toHaveBeenCalled();
  notify(row, true);
  expect(rendered).toHaveBeenCalledWith(message.sequence);
  expect(observe).toHaveBeenCalledWith(row);
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
