import {
  type FinanceConfiguration,
  type FinanceConfigurationSection,
  financeConfigurationCapabilities,
} from "@personal-os/domain";

export type ConfigurationSectionName = Exclude<keyof FinanceConfiguration, "capabilities">;
type Reads = {
  [K in Exclude<keyof FinanceConfiguration, "capabilities">]: () => Promise<
    Extract<FinanceConfiguration[K], { state: "loaded" }>["value"]
  >;
};
type SectionFailure = { durationMs: number; category: "timeout" | "unexpected" };

function failureCategory(error: unknown): SectionFailure["category"] {
  const seen = new Set<unknown>();
  let cause = error;
  while (typeof cause === "object" && cause !== null && !seen.has(cause)) {
    seen.add(cause);
    // PostgreSQL query cancellation and transaction timeout, including driver wrappers.
    if ("code" in cause && (cause.code === "57014" || cause.code === "25P04")) return "timeout";
    cause = "cause" in cause ? cause.cause : null;
  }
  return "unexpected";
}

async function section<T>(
  read: () => Promise<T>,
  onFailure: (failure: SectionFailure) => void,
): Promise<FinanceConfigurationSection<T>> {
  const startedAt = performance.now();
  try {
    return { state: "loaded", value: await read() };
  } catch (error) {
    onFailure({ durationMs: performance.now() - startedAt, category: failureCategory(error) });
    return { state: "unavailable" };
  }
}
/** Only reads are accepted, so loading configuration cannot execute the setup state machine. */
export async function readFinanceConfiguration(
  reads: Reads,
  onFailure: (section: ConfigurationSectionName, failure: SectionFailure) => void = () => {},
): Promise<FinanceConfiguration> {
  const [profile, preferences, income, budget, accounts, guidance, execution] = await Promise.all([
    section(reads.profile, (failure) => onFailure("profile", failure)),
    section(reads.preferences, (failure) => onFailure("preferences", failure)),
    section(reads.income, (failure) => onFailure("income", failure)),
    section(reads.budget, (failure) => onFailure("budget", failure)),
    section(reads.accounts, (failure) => onFailure("accounts", failure)),
    section(reads.guidance, (failure) => onFailure("guidance", failure)),
    section(reads.execution, (failure) => onFailure("execution", failure)),
  ]);
  return {
    execution,
    profile,
    preferences,
    income,
    budget,
    accounts,
    guidance,
    capabilities: financeConfigurationCapabilities(budget),
  };
}
