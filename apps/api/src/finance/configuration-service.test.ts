import { readFinanceConfiguration } from "./configuration-service.js";

it("reads configuration without advancing setup and keeps successful sibling reads", async () => {
  const profile = { version: 3, jurisdiction: "US-NY" };
  const reads = {
    execution: vi.fn().mockResolvedValue(null),
    profile: vi.fn().mockResolvedValue(profile),
    preferences: vi.fn().mockResolvedValue({ revision: 0, preferences: {} }),
    income: vi.fn().mockResolvedValue(null),
    budget: vi.fn().mockRejectedValue(new Error("private database detail")),
    accounts: vi.fn().mockResolvedValue({ items: [] }),
    guidance: vi.fn().mockResolvedValue(null),
  };
  const result = await readFinanceConfiguration(reads);
  expect(result.profile).toEqual({ state: "loaded", value: profile });
  expect(result.budget).toEqual({ state: "unavailable" });
  expect(result.capabilities.budget.state).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain("private database detail");
  expect(reads.profile).toHaveBeenCalledTimes(1);
});

it("identifies failed sections without disclosing exception contents", async () => {
  const failure = vi.fn();
  const reject = async () => {
    throw new Error("private token");
  };
  const result = await readFinanceConfiguration(
    {
      profile: reject,
      preferences: reject,
      income: reject,
      budget: reject,
      accounts: reject,
      guidance: reject,
      execution: reject,
    },
    failure,
  );
  expect(failure.mock.calls.map((call) => call[0]).sort()).toEqual([
    "accounts",
    "budget",
    "execution",
    "guidance",
    "income",
    "preferences",
    "profile",
  ]);
  expect(JSON.stringify(result)).not.toContain("private");
});

it.each([
  [{ cause: { code: "57014", message: "private query" } }, "timeout"],
  [{ code: "25P04", detail: "private transaction" }, "timeout"],
  [{ code: "private code", message: "private account" }, "unexpected"],
  ["private token", "unexpected"],
])("measures failed reads and emits only a safe category (%j)", async (error, category) => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  const failure = vi.fn();
  const read = vi.fn().mockResolvedValue(null);
  try {
    const result = await readFinanceConfiguration(
      {
        profile: read,
        preferences: read,
        income: read,
        accounts: read,
        guidance: read,
        execution: read,
        budget: async () => {
          await Promise.resolve();
          clock.mockReturnValue(142.5);
          throw error;
        },
      },
      failure,
    );
    expect(result.budget).toEqual({ state: "unavailable" });
    expect(failure).toHaveBeenCalledExactlyOnceWith("budget", { category, durationMs: 42.5 });
    expect(JSON.stringify(failure.mock.calls)).not.toContain("private");
  } finally {
    clock.mockRestore();
  }
});

it("classifies cyclic causes without losing successful configuration sections", async () => {
  const cause: { cause?: unknown } = {};
  cause.cause = cause;
  const read = vi.fn().mockResolvedValue(null);
  const failure = vi.fn();
  const result = await readFinanceConfiguration(
    {
      profile: read,
      preferences: read,
      income: read,
      budget: read,
      accounts: read,
      guidance: read,
      execution: async () => {
        throw cause;
      },
    },
    failure,
  );
  expect(result.profile).toEqual({ state: "loaded", value: null });
  expect(failure).toHaveBeenCalledWith("execution", {
    category: "unexpected",
    durationMs: expect.any(Number),
  });
});
