// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it } from "vitest";
import { MailAppBarTitle } from "./workspace-header";

it("changes mailbox scope without dropping account or search filters and clears the old reader", async () => {
  function Header() {
    const location = useLocation();
    return (
      <>
        <MailAppBarTitle />
        <output aria-label="Route">{location.search}</output>
      </>
    );
  }
  render(
    <MemoryRouter
      initialEntries={["/mail?account=personal&account=work&q=receipt&thread=old&mailbox=custom"]}
    >
      <Header />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Mail view: Mailbox" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Unread" }));
  expect(screen.getByRole("button", { name: "Mail view: Unread" })).toBeVisible();
  let route = new URLSearchParams(screen.getByLabelText("Route").textContent ?? "");
  expect(route.getAll("account")).toEqual(["personal", "work"]);
  expect(route.get("q")).toBe("receipt");
  expect(route.get("unread")).toBe("1");
  expect(route.has("thread")).toBe(false);
  expect(route.has("mailbox")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Mail view: Unread" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Sent" }));
  route = new URLSearchParams(screen.getByLabelText("Route").textContent ?? "");
  expect(route.get("view")).toBe("sent");
  expect(route.has("unread")).toBe(false);
});
