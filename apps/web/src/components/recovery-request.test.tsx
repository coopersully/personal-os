// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { type ToastT, toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { ModalRecoveryPriority } from "./modal-recovery-priority";
import { RecoveryQueue, RecoveryRequest } from "./recovery-request";

const notifications = vi.hoisted(() => ({ toasts: [] as ToastT[] }));
vi.mock("sonner", () => ({
  useSonner: () => ({ toasts: notifications.toasts }),
  toast: { dismiss: vi.fn() },
}));
beforeEach(() => {
  notifications.toasts = [];
});
vi.mock("./recovery-surface", () => ({
  RecoverySurface: ({
    open,
    title,
    children,
    actions,
  }: {
    open: boolean;
    title: string;
    children?: ReactNode;
    actions: ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
        {actions}
      </div>
    ) : null,
}));
function Editor() {
  const [failed, setFailed] = useState(true);
  const [draft, setDraft] = useState("Unsaved title");
  return (
    <>
      <input aria-label="Title" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <RecoveryRequest
        open={failed}
        title="Review saved values"
        description="Your draft remains here."
        actions={
          <button type="button" onClick={() => setFailed(false)}>
            Use latest
          </button>
        }
      />
    </>
  );
}
describe("RecoveryQueue", () => {
  it("keeps the editor mounted and preserves its draft through recovery", () => {
    render(
      <RecoveryQueue>
        <Editor />
      </RecoveryQueue>,
    );
    const input = screen.getByLabelText("Title");
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByText("Use latest"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBe(input);
    expect(input).toHaveValue("Keep this draft");
  });
  it("queues simultaneous domain recovery behind higher-priority read recovery", () => {
    const renderQueue = (blocked: boolean, first: boolean) => (
      <ModalRecoveryPriority.Provider value={blocked}>
        <RecoveryQueue>
          <RecoveryRequest
            open={first}
            title="First"
            description="First failure"
            actions={<button type="button">Review first</button>}
          />
          <RecoveryRequest
            open
            title="Second"
            description="Second failure"
            actions={<button type="button">Review second</button>}
          />
        </RecoveryQueue>
      </ModalRecoveryPriority.Provider>
    );
    const { rerender } = render(renderQueue(true, true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(renderQueue(false, true));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "First" })).toBeVisible();
    rerender(renderQueue(false, false));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Second" })).toBeVisible();
  });
  it("can present recovery without the signed-in shell", () => {
    render(<Editor />);
    expect(screen.getByRole("dialog", { name: "Review saved values" })).toBeVisible();
  });
});

it("clears only the matching action toast when a decision surface takes ownership", () => {
  vi.clearAllMocks();
  render(
    <RecoveryQueue>
      <RecoveryRequest
        open
        toastId="save-attempt-2"
        title="Review change"
        description="Review the latest values."
        actions={<button type="button">Review</button>}
      />
    </RecoveryQueue>,
  );
  expect(toast.dismiss).toHaveBeenCalledWith("save-attempt-2");
  expect(toast.dismiss).not.toHaveBeenCalledWith();
});
it("keeps closed requests out of layout and respects higher-priority recovery without a queue", () => {
  const { rerender, container } = render(
    <RecoveryQueue>
      <RecoveryRequest open={false} title="Closed" description="Hidden" actions={null} />
    </RecoveryQueue>,
  );
  expect(container).toBeEmptyDOMElement();
  rerender(
    <ModalRecoveryPriority.Provider value={true}>
      <Editor />
    </ModalRecoveryPriority.Provider>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Unsaved title");
});

it("keeps the current decision first when its pending state or content updates", () => {
  const second = (
    <RecoveryRequest open title="Second operation" description="Waiting" actions={null} />
  );
  const content = (title: string) => (
    <RecoveryQueue>
      <RecoveryRequest open title={title} description="Current" actions={null} />
      {second}
    </RecoveryQueue>
  );
  const { rerender } = render(content("First operation"));
  expect(screen.getByRole("dialog", { name: "First operation" })).toBeVisible();
  rerender(content("First operation — trying again"));
  expect(screen.getByRole("dialog", { name: "First operation — trying again" })).toBeVisible();
  expect(screen.queryByRole("dialog", { name: "Second operation" })).not.toBeInTheDocument();
});

it("removes a matching toast delivered after its recovery surface has already opened", () => {
  vi.clearAllMocks();
  const request = (
    <RecoveryRequest
      open
      toastId="owned-operation"
      title="Review"
      description="Review the change"
      actions={null}
    />
  );
  const { rerender } = render(<RecoveryQueue>{request}</RecoveryQueue>);
  vi.mocked(toast.dismiss).mockClear();
  notifications.toasts = [
    { id: "unrelated-operation", title: "Another action" },
    { id: "owned-operation", title: "Late failed save" },
  ];
  rerender(<RecoveryQueue>{request}</RecoveryQueue>);
  expect(toast.dismiss).toHaveBeenCalledWith("owned-operation");
  expect(toast.dismiss).not.toHaveBeenCalledWith("unrelated-operation");
});
