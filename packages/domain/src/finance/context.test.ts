import { captureFinanceContextInputSchema } from "./context.js";

const create = {
  type: "create",
  operationId: "11111111-1111-4111-8111-111111111111",
  text: " Trip reimbursement ",
  validFrom: null,
  validThrough: null,
  participants: [" Sam "],
  paymentChannel: null,
  expectedCents: null,
  categoryId: null,
  transactionIds: [],
};
describe("zero-link Finance context capture", () => {
  it("normalizes labels and absolute instants without inventing money", () => {
    expect(captureFinanceContextInputSchema.parse(create)).toMatchObject({
      text: "Trip reimbursement",
      participants: ["Sam"],
      expectedCents: null,
    });
    expect(
      captureFinanceContextInputSchema.parse({
        ...create,
        validFrom: "2026-09-20T10:00:00-04:00",
        expectedCents: -100,
      }),
    ).toMatchObject({ validFrom: "2026-09-20T14:00:00.000Z", expectedCents: -100 });
  });
  it.each([
    { id: create.operationId },
    { source: { id: create.operationId, revision: "1" } },
    { categoryId: create.operationId },
    { transactionIds: [create.operationId] },
    { validFrom: "2026-09-20" },
    { validFrom: "2026-09-20T10:00:00" },
    { validFrom: "2026-09-21T00:00:00Z", validThrough: "2026-09-20T00:00:00Z" },
    { expectedCents: Number.MAX_SAFE_INTEGER + 1 },
    { text: " " },
    { participants: [""] },
    { participants: Array(51).fill("Sam") },
    { paymentChannel: " " },
    { sourceKind: "sms" },
  ])("rejects caller authority, external references and invalid values %j", (patch) => {
    expect(captureFinanceContextInputSchema.safeParse({ ...create, ...patch }).success).toBe(false);
  });
  it("requires exact revision for replace/cancel and forbids cancel content", () => {
    const id = create.operationId;
    expect(
      captureFinanceContextInputSchema.safeParse({ ...create, type: "revise", id }).success,
    ).toBe(false);
    expect(
      captureFinanceContextInputSchema.parse({
        ...create,
        type: "revise",
        id,
        expectedRevision: "9223372036854775807",
      }),
    ).toMatchObject({ type: "revise" });
    for (const expectedRevision of ["0", "01", "-1", "1.1", "9223372036854775808"]) {
      expect(
        captureFinanceContextInputSchema.safeParse({
          ...create,
          type: "revise",
          id,
          expectedRevision,
        }).success,
      ).toBe(false);
    }
    const cancel = { type: "cancel", operationId: id, id, expectedRevision: "1" };
    expect(captureFinanceContextInputSchema.parse(cancel)).toEqual(cancel);
    expect(captureFinanceContextInputSchema.safeParse({ ...cancel, text: "no" }).success).toBe(
      false,
    );
  });
});
