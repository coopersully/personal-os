import { timeToMinute } from "./time.js";

describe("timeToMinute", () => {
  it("parses native time inputs and safely handles incomplete values", () => {
    expect(timeToMinute("09:30")).toBe(570);
    expect(timeToMinute("09")).toBe(540);
    expect(timeToMinute("")).toBe(0);
  });
});
