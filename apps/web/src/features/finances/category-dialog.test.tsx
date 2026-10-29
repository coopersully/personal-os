// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinanceCategoryDialog } from "./category-dialog";

const api = vi.hoisted(() => ({ createFinanceCategory: vi.fn() }));
vi.mock("@/api", () => ({ api }));
it("saves a standalone category and refreshes category selectors", async () => {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  api.createFinanceCategory.mockResolvedValue({ id: "new", name: "Hobbies" });
  render(
    <QueryClientProvider client={client}>
      <FinanceCategoryDialog onClose={onClose} />
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText("Name"), " Hobbies ");
  await user.click(screen.getByRole("button", { name: "Save category" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.createFinanceCategory).toHaveBeenCalledWith({ name: "Hobbies" });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["finance-categories"] });
});
