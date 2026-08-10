import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const compute = readFileSync(resolve(root, "infra/compute.tf"), "utf8");
const network = readFileSync(resolve(root, "infra/network.tf"), "utf8");

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

requireMatch(
  network,
  /resource "aws_nat_gateway" "application"/,
  "the temporary Release 1 NAT rollback boundary",
);

console.log("Production cost-floor Release 1 contract passed.");
