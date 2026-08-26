// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MailIcon } from "@/components/icons";
import { ReadinessPanel, type ReadinessPanelCheck } from "./readiness-panel";

const checks: ReadinessPanelCheck[] = [
  {
    complete: true,
    description: "A source is connected.",
    id: "material",
    title: "Material",
  },
  {
    action: <button type="button">Resolve preference</button>,
    complete: false,
    description: "A preference still needs review.",
    id: "preferences",
    title: "Preferences",
  },
];

function renderPanel(props: Partial<React.ComponentProps<typeof ReadinessPanel>> = {}) {
  return render(
    <ReadinessPanel
      checks={checks}
      description="Preferences are the next check to resolve."
      detailsLabel="Mail readiness checks"
      focus={{
        label: "Next step",
        title: "Review Mail preferences",
      }}
      icon={<MailIcon />}
      title="Mail readiness"
      {...props}
    />,
  );
}

describe("ReadinessPanel", () => {
  it("keeps progress and evidence access on one row and opens checks in a dialog", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    expect(screen.getByText("1 to finish")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 complete")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "1 of 2 checks complete" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(screen.getByText("Next step:").closest("p")).toHaveTextContent(
      "Next step: Review Mail preferences",
    );
    expect(container.querySelectorAll('[data-slot="item"]')).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Mail readiness checks" })).not.toBeInTheDocument();

    const viewChecks = screen.getByRole("button", { name: "Review checks" });
    viewChecks.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("1 check needs attention. 1 completed.")).toBeInTheDocument();
    const unresolved = screen.getByRole("list", {
      name: "Mail readiness checks: not ready",
    });
    expect(unresolved).toBeInTheDocument();
    expect(unresolved.querySelector('[data-slot="item"]')).toHaveAttribute(
      "data-variant",
      "outline",
    );
    expect(screen.getByRole("button", { name: "Resolve preference" })).toBeInTheDocument();
    expect(screen.queryByText("Material")).not.toBeInTheDocument();
    expect(screen.queryByText("A source is connected.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show 1 completed check" }));
    const completed = screen.getByRole("list", {
      name: "Mail readiness checks: completed",
    });
    expect(completed).toBeInTheDocument();
    expect(completed.querySelector('[data-slot="item"]')).toHaveAttribute("data-variant", "muted");
    expect(screen.getByText("Material")).toBeInTheDocument();
    expect(screen.getByText("A source is connected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide 1 completed check" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(viewChecks).toHaveFocus();
    await user.click(viewChecks);
    expect(screen.getByRole("button", { name: "Show 1 completed check" })).toBeInTheDocument();
    expect(screen.queryByText("Material")).not.toBeInTheDocument();
  });

  it("does not imply progress while checking or unavailable", () => {
    const { rerender } = renderPanel({ loading: true });
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    rerender(
      <ReadinessPanel
        checks={checks}
        description="Mail readiness could not be loaded."
        detailsLabel="Mail readiness checks"
        icon={<MailIcon />}
        title="Mail readiness"
        unavailable
      />,
    );
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("marks a complete set ready and omits empty disclosures", () => {
    const completeChecks = checks.map((check) => ({ ...check, action: undefined, complete: true }));
    const { rerender } = renderPanel({ checks: completeChecks });
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 complete")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "2 of 2 checks complete" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    rerender(
      <ReadinessPanel
        checks={[]}
        description="This product is not published."
        detailsLabel="Unavailable readiness checks"
        icon={<MailIcon />}
        title="Unavailable readiness"
        unavailable
      />,
    );
    expect(screen.queryByRole("button", { name: /checks/ })).not.toBeInTheDocument();
  });
});
