import { qualifyFinanceOpeningPosition } from "./opening-position.js";

const account = {
  accountId: "cash",
  currency: "USD",
  identityKey: "bank:cash",
  sourceCurrent: true,
  statement: { date: "2026-11-03", signedClosingBalanceCents: 12500, includesThroughDate: true },
  coverage: [{ from: "2026-11-01", through: "2026-11-03" }],
  movements: [
    {
      id: "deposit",
      date: "2026-11-01",
      signedBalanceDeltaCents: 5000,
      pending: false,
      evidenceComplete: true,
    },
    {
      id: "transfer",
      date: "2026-11-03",
      signedBalanceDeltaCents: -2500,
      pending: false,
      evidenceComplete: true,
    },
  ],
};
const firstMovement = account.movements[0];
if (!firstMovement) throw new Error("Missing movement fixture");
const qualify = (accounts = [account]) =>
  qualifyFinanceOpeningPosition({ month: "2026-11", accounts });
describe("qualified opening position", () => {
  it("reconstructs opening funds from a closing statement and full ledger, including transfers", () => {
    expect(qualify()).toMatchObject({
      qualified: true,
      accounts: [{ accountId: "cash", openingBalanceCents: 10000 }],
    });
  });
  it("carries an earlier verified closing statement forward across fully covered months", () => {
    expect(
      qualifyFinanceOpeningPosition({
        month: "2026-12",
        accounts: [
          {
            ...account,
            statement: {
              date: "2026-10-31",
              signedClosingBalanceCents: 10000,
              includesThroughDate: true,
            },
            coverage: [{ from: "2026-11-01", through: "2026-11-30" }],
            movements: [
              ...account.movements,
              {
                id: "december",
                date: "2026-12-01",
                signedBalanceDeltaCents: -900,
                pending: false,
                evidenceComplete: true,
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ qualified: true, accounts: [{ openingBalanceCents: 12500 }] });
  });
  it("cannot carry an opening statement across an uncovered month", () => {
    expect(
      qualifyFinanceOpeningPosition({
        month: "2026-12",
        accounts: [
          {
            ...account,
            statement: {
              date: "2026-10-31",
              signedClosingBalanceCents: 10000,
              includesThroughDate: true,
            },
          },
        ],
      }),
    ).toMatchObject({ qualified: false, reasons: ["incomplete_coverage"] });
  });
  it("does not treat missing account scope as a zero opening balance", () => {
    expect(qualify([])).toMatchObject({ qualified: false, reasons: ["accounts_required"] });
  });
  it.each([
    { coverage: [{ from: "2026-11-02", through: "2026-11-03" }] },
    { statement: null },
    { statement: { ...account.statement, includesThroughDate: false } },
    { sourceCurrent: false },
    { currency: "EUR" },
    { movements: [{ ...firstMovement, signedBalanceDeltaCents: null }] },
    { movements: [{ ...firstMovement, evidenceComplete: false }] },
  ])("does not invent an opening balance from incomplete evidence %j", (changes) => {
    const output = qualifyFinanceOpeningPosition({
      month: "2026-11",
      accounts: [{ ...account, ...changes }],
    });
    expect(output.qualified).toBe(false);
    expect(output.accounts[0]?.openingBalanceCents).toBeNull();
  });
  it("excludes pending movements from a posted closing statement", () => {
    expect(
      qualify([
        {
          ...account,
          movements: [...account.movements, { ...firstMovement, id: "pending", pending: true }],
        },
      ]),
    ).toMatchObject({ qualified: true, accounts: [{ openingBalanceCents: 10000 }] });
  });
  it("blocks duplicate real account identities instead of double-counting", () => {
    expect(qualify([account, { ...account, accountId: "duplicate" }]).qualified).toBe(false);
  });
  it("blocks duplicate movements and unknown account identity", () => {
    expect(
      qualify([{ ...account, movements: [...account.movements, firstMovement] }]).qualified,
    ).toBe(false);
    expect(
      qualifyFinanceOpeningPosition({
        month: "2026-11",
        accounts: [{ ...account, identityKey: null }],
      }).qualified,
    ).toBe(false);
  });
  it("supports negative signed liability positions without turning them into spendable cash", () => {
    expect(
      qualify([
        {
          ...account,
          statement: { ...account.statement, signedClosingBalanceCents: -12500 },
          movements: [],
        },
      ]),
    ).toMatchObject({ qualified: true, accounts: [{ openingBalanceCents: -12500 }] });
  });
});
