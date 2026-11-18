import { nextFinanceProofGeneration } from "./execution-proof.js";

it("uses exact positive bigint generations and fails closed rather than wrapping PostgreSQL bigint", () => {
  expect(nextFinanceProofGeneration(null)).toBe(1n);
  expect(nextFinanceProofGeneration(9007199254740993n)).toBe(9007199254740994n);
  expect(nextFinanceProofGeneration(9223372036854775806n)).toBe(9223372036854775807n);
  expect(() => nextFinanceProofGeneration(9223372036854775807n)).toThrow();
  expect(() => nextFinanceProofGeneration(-1n)).toThrow();
});
