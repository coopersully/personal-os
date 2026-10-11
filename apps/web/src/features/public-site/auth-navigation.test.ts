import { authenticationDestination, isAuthenticationPath } from "./auth-navigation.js";

it("recognizes only dedicated authentication routes", () => {
  for (const path of ["/login", "/signup", "/forgot-password"])
    expect(isAuthenticationPath(path)).toBe(true);
  expect(isAuthenticationPath("/settings")).toBe(false);
});

it("preserves a local destination with its query and fragment", () => {
  expect(authenticationDestination("?next=%2Fsettings%3Fsection%3Dsecurity%23sessions")).toBe(
    "/settings?section=security#sessions",
  );
});

it.each([
  "",
  "https://example.com",
  "//example.com",
  "/\\example.com",
  "/login",
  "/signup/",
  "/forgot-password?next=/mail",
  "/",
  "/foo/../login",
  "/foo/..//example.com",
  "/\nexample.com",
])("rejects external destinations and auth loops: %s", (next) => {
  expect(authenticationDestination(`?${new URLSearchParams({ next })}`)).toBe("/today");
});
