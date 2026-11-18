import { parseCalendarDateQuery } from "./search-date";

it.each([
  "constructor",
  "__proto__",
  "toString",
])("does not treat inherited property %s as a relative day", (query) => {
  expect(
    parseCalendarDateQuery(query, "America/New_York", new Date("2026-10-06T12:00:00Z")),
  ).toBeUndefined();
});
it("parses uppercase English weekdays independently of the browser locale", () => {
  const original = String.prototype.toLocaleLowerCase;
  const localeLower = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (
    this: string,
  ) {
    return original.call(this, "tr");
  });
  try {
    expect(parseCalendarDateQuery("FRIDAY", "UTC", new Date("2026-10-06T12:00:00Z"))?.date).toEqual(
      { year: 2026, month: 10, day: 9 },
    );
    expect(localeLower).not.toHaveBeenCalled();
  } finally {
    localeLower.mockRestore();
  }
});
