import { expectTypeOf } from "vitest";
import { createSmsAdmission } from "../texting-sms-admission.js";
import type { AdmitSmsAnswer } from "./sms-answer-port.js";

it("accepts the published Texting admission factory without a transaction or outcome adapter", () => {
  expectTypeOf(createSmsAdmission({ enabled: () => true })).toMatchTypeOf<AdmitSmsAnswer>();
});
