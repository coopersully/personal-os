import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const compute = readFileSync(resolve(root, "infra/compute.tf"), "utf8");
const network = readFileSync(resolve(root, "infra/network.tf"), "utf8");
const operations = readFileSync(resolve(root, "infra/operations.tf"), "utf8");
const governance = readFileSync(resolve(root, "infra/governance.tf"), "utf8");

function requireMatch(source, pattern, description) {
  if (!pattern.test(source)) {
    throw new Error(`Production cost-floor contract is missing ${description}.`);
  }
}

for (const service of ["api", "mcp"]) {
  const block = compute.match(
    new RegExp(`resource "aws_ecs_service" "${service}" \\{([\\s\\S]*?)(?=\\nresource |$)`),
  )?.[1];
  if (!block) {
    throw new Error(`Production cost-floor contract cannot find the ${service} ECS service.`);
  }
  requireMatch(block, /assign_public_ip\s*=\s*true/, `${service} public IPv4 egress`);
  requireMatch(
    block,
    /security_groups\s*=\s*\[aws_security_group\.application\.id\]/,
    `${service} application security group`,
  );
  requireMatch(
    block,
    /subnets\s*=\s*aws_subnet\.public\[\*\]\.id/,
    `${service} public subnet placement`,
  );
  requireMatch(
    block,
    /depends_on\s*=\s*\[aws_route_table_association\.public\]/,
    `${service} public route dependency`,
  );
}

for (const [pattern, description] of [
  [/resource "aws_eip" "nat"/, "NAT Elastic IP"],
  [/resource "aws_nat_gateway" "application"/, "NAT gateway"],
  [/resource "aws_subnet" "application"/, "unused application subnets"],
  [/resource "aws_route_table" "application"/, "unused application route table"],
  [/resource "aws_route_table_association" "application"/, "unused application routes"],
]) {
  if (pattern.test(network)) {
    throw new Error(`Production cost-floor contract still contains ${description}.`);
  }
}

if (/resource "aws_cloudwatch_metric_alarm" "nat_/.test(operations)) {
  throw new Error("Production cost-floor contract still contains NAT alarms.");
}

const publicHealthChecks = operations.match(/public_health_checks\s*=\s*\{([\s\S]*?)\n\s*\}/)?.[1];
requireMatch(publicHealthChecks ?? "", /app\s*=\s*\{/, "the app public health check");
if (/\b(api|mcp)\s*=\s*\{/.test(publicHealthChecks ?? "")) {
  throw new Error("Production cost-floor contract still contains redundant API/MCP health checks.");
}

requireMatch(governance, /recording_frequency\s*=\s*"DAILY"/, "daily AWS Config recording");

console.log("Production cost-floor contract passed.");
