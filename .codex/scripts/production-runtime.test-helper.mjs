import { appendFileSync } from "node:fs";

appendFileSync(
  process.env.ILO_PRODUCTION_TEST_OUTPUT,
  `${JSON.stringify({
    acknowledgement: process.env.ILO_PRODUCTION_RUNTIME ?? null,
    args: process.argv.slice(2),
  })}\n`,
);
