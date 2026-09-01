// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinanceBudgetBucketManager } from "./page.js";

const mocks = vi.hoisted(() => ({
  createFinanceBudgetBucket: vi.fn(),
  listFinanceBudgetBuckets: vi.fn(),
  updateFinanceBudgetBucket: vi.fn(),
}));

vi.mock("../../api.js", () => ({ api: mocks, errorMessage: (error: Error) => error.message }));

function renderManager() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <FinanceBudgetBucketManager
        categories={[{ id: "cat-1", name: "Therapy" } as never]}
        month="2026-08"
      />
    </QueryClientProvider>,
  );
}

describe("Finance budget bucket manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createFinanceBudgetBucket.mockResolvedValue({});
    mocks.updateFinanceBudgetBucket.mockResolvedValue({});
  });

  it("creates buckets and manages their description and categories", async () => {
    const user = userEvent.setup();
    mocks.listFinanceBudgetBuckets.mockResolvedValue({
      taxonomy: {
        buckets: [{ categories: [], description: null, id: "bucket-1", name: "Care", version: 2 }],
      },
    });
    renderManager();
    await user.type(await screen.findByLabelText("New bucket name"), "Home");
    await user.type(screen.getByLabelText("Bucket description"), "Fixed monthly care");
    await user.click(screen.getByRole("button", { name: "Add bucket" }));
    expect(mocks.createFinanceBudgetBucket).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("New bucket name")).toHaveValue(""));
    await user.type(screen.getByLabelText("New bucket name"), "Unmapped");
    await user.click(screen.getByRole("button", { name: "Add bucket" }));
    expect(mocks.createFinanceBudgetBucket).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: null, name: "Unmapped" }),
    );
    await user.click(screen.getByRole("button", { name: "Care" }));
    const description = screen.getByLabelText("Selected bucket description");
    fireEvent.change(description, { target: { value: "Updated context" } });
    fireEvent.blur(description);
    await waitFor(() =>
      expect(mocks.updateFinanceBudgetBucket).toHaveBeenLastCalledWith(
        "bucket-1",
        expect.objectContaining({ description: "Updated context" }),
      ),
    );
    const therapy = screen.getByRole("checkbox", { name: "Therapy" });
    await waitFor(() => expect(therapy).toBeEnabled());
    await user.click(therapy);
    await waitFor(() =>
      expect(mocks.updateFinanceBudgetBucket).toHaveBeenLastCalledWith(
        "bucket-1",
        expect.objectContaining({ categoryIds: ["cat-1"] }),
      ),
    );
  });

  it("shows empty and failed bucket states", async () => {
    mocks.listFinanceBudgetBuckets.mockResolvedValueOnce({ taxonomy: { buckets: [] } });
    renderManager();
    expect(await screen.findByText(/No buckets yet/)).toBeInTheDocument();

    mocks.listFinanceBudgetBuckets.mockRejectedValueOnce(new Error("Buckets unavailable"));
    renderManager();
    expect(await screen.findByText("Buckets unavailable")).toBeInTheDocument();
  });

  it("loads the selected bucket description when switching buckets", async () => {
    const user = userEvent.setup();
    mocks.listFinanceBudgetBuckets.mockResolvedValue({
      taxonomy: {
        buckets: [
          { categories: [], description: "Care context", id: "bucket-1", name: "Care", version: 2 },
          { categories: [], description: "Home context", id: "bucket-2", name: "Home", version: 3 },
        ],
      },
    });
    renderManager();

    const care = await screen.findByRole("button", { name: "Care" });
    await user.click(care);
    expect(care).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Selected bucket description")).toHaveValue("Care context");
    const home = screen.getByRole("button", { name: "Home" });
    await user.click(home);
    expect(care).toHaveAttribute("aria-pressed", "false");
    expect(home).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Selected bucket description")).toHaveValue("Home context");
  });

  it("locks description editing while a bucket update is pending", async () => {
    const user = userEvent.setup();
    mocks.listFinanceBudgetBuckets.mockResolvedValue({
      taxonomy: {
        buckets: [{ categories: [], description: null, id: "bucket-1", name: "Care", version: 2 }],
      },
    });
    mocks.updateFinanceBudgetBucket.mockImplementation(() => new Promise(() => undefined));
    renderManager();

    await user.click(await screen.findByRole("button", { name: "Care" }));
    const description = screen.getByLabelText("Selected bucket description");
    fireEvent.change(description, { target: { value: "Updated context" } });
    fireEvent.blur(description);

    await waitFor(() => expect(description).toBeDisabled());
    await user.click(description);
    await user.tab();
    expect(mocks.updateFinanceBudgetBucket).toHaveBeenCalledOnce();
  });
});
