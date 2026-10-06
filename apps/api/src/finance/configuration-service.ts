import {
  type FinanceConfiguration,
  type FinanceConfigurationSection,
  financeConfigurationCapabilities,
} from "@personal-os/domain";

type Reads = {
  [K in Exclude<keyof FinanceConfiguration, "capabilities">]: () => Promise<
    Extract<FinanceConfiguration[K], { state: "loaded" }>["value"]
  >;
};
async function section<T>(read: () => Promise<T>): Promise<FinanceConfigurationSection<T>> {
  try {
    return { state: "loaded", value: await read() };
  } catch {
    return { state: "unavailable" };
  }
}
/** Only reads are accepted, so loading configuration cannot execute the setup state machine. */
export async function readFinanceConfiguration(reads: Reads): Promise<FinanceConfiguration> {
  const [profile, preferences, income, budget, accounts, guidance, execution] = await Promise.all([
    section(reads.profile),
    section(reads.preferences),
    section(reads.income),
    section(reads.budget),
    section(reads.accounts),
    section(reads.guidance),
    section(reads.execution),
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
