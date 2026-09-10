import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const waf = readFileSync(resolve(root, "infra/waf.tf"), "utf8");

function requireMatch(pattern, description) {
  if (!pattern.test(waf)) {
    throw new Error(`WAF health-probe contract is missing ${description}.`);
  }
}

requireMatch(
  /name\s*=\s*"rate-limit"[\s\S]*?action\s*\{\s*block\s*\{\s*\}\s*\}/,
  "the shared edge rate limit",
);
requireMatch(
  /name\s*=\s*"aws-managed-ip-reputation"[\s\S]*?managed_rule_group_statement\s*\{[\s\S]*?name\s*=\s*"AWSManagedRulesAmazonIpReputationList"[\s\S]*?scope_down_statement\s*\{[\s\S]*?not_statement\s*\{[\s\S]*?or_statement\s*\{[\s\S]*?search_string\s*=\s*"\/health\/ready"[\s\S]*?positional_constraint\s*=\s*"EXACTLY"[\s\S]*?uri_path\s*\{\s*\}[\s\S]*?search_string\s*=\s*"\/health\/live"[\s\S]*?positional_constraint\s*=\s*"EXACTLY"[\s\S]*?uri_path\s*\{\s*\}/,
  "exact readiness and liveness exclusions from only IP reputation filtering",
);

console.log("WAF health-probe contract passed.");
