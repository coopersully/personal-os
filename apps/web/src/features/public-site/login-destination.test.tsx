// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach } from "vitest";
import { authenticationDestination } from "./auth-navigation";
import { LoginDestination } from "./login-destination";

afterEach(cleanup);

function Destination() {
  const location = useLocation();
  return (
    <>
      <LoginDestination />
      <output>{authenticationDestination(location.search)}</output>
      <p>{location.search}</p>
    </>
  );
}

it("shows the local destination and removes only next when dismissed", () => {
  render(
    <MemoryRouter
      initialEntries={["/login?next=%2Ffinances%2Fspending%3Fview%3Dbubbles&source=preview"]}
    >
      <Destination />
    </MemoryRouter>,
  );
  expect(screen.getByText("Finances / Spending")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("/finances/spending?view=bubbles");
  fireEvent.click(screen.getByRole("button", { name: "Clear destination after login" }));
  expect(screen.queryByText("Finances / Spending")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("/today");
  expect(screen.getByText("?source=preview")).toBeVisible();
});

it.each([
  "/login",
  "/login?next=https://example.com",
  "/login?next=%2Flogin",
])("omits the destination for absent or unsafe targets: %s", (path) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <LoginDestination />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
