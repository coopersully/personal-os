import { type RenderOptions, render } from "@testing-library/react";
import { Fragment, type ReactNode } from "react";
import { Toaster } from "sonner";

/** Exercise out-of-flow feedback in component tests, including rerenders of the editor. */
export function renderWithFeedback(ui: ReactNode, options?: RenderOptions) {
  const Wrapper = options?.wrapper ?? Fragment;
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <Wrapper>
        <Toaster />
        {children}
      </Wrapper>
    ),
  });
}
