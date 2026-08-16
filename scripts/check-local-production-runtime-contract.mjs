import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const runtimePath = resolve(root, "infra/local-production-runtime.tf");

let runtime;
try {
  runtime = readFileSync(runtimePath, "utf8");
} catch {
  throw new Error("Missing infra/local-production-runtime.tf.");
}

const network = readFileSync(resolve(root, "infra/network.tf"), "utf8");
const outputs = readFileSync(resolve(root, "infra/outputs.tf"), "utf8");

function resourceBlock(source, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) return null;
  const openingBrace = source.indexOf("{", start + declaration.length);
  if (openingBrace === -1) return null;
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return null;
}

const required = [
  [runtime, /resource "aws_security_group" "local_production_tunnel"/, "tunnel security group"],
  [
    runtime,
    /resource "aws_security_group_rule" "database_from_local_production_tunnel"/,
    "database SG-to-SG ingress",
  ],
  [
    runtime,
    /source_security_group_id\s*=\s*aws_security_group\.local_production_tunnel\.id/,
    "database source security group",
  ],
  [runtime, /resource "aws_instance" "local_production_tunnel"/, "tunnel instance"],
  [runtime, /http_tokens\s*=\s*"required"/, "required IMDSv2"],
  [runtime, /key_name\s*=\s*null/, "explicitly absent SSH key"],
  [runtime, /associate_public_ip_address\s*=\s*true/, "SSM transport address"],
  [runtime, /AmazonSSMManagedInstanceCore/, "SSM managed-instance policy"],
  [runtime, /resource "aws_iam_role" "local_production_runtime"/, "scoped operator role"],
  [runtime, /values\(local\.runtime_parameter_arns\)/, "exact runtime parameter resources"],
  [runtime, /"ssm:StartSession"/, "Session Manager start authority"],
  [runtime, /"ec2:StartInstances"/, "tunnel start authority"],
  [runtime, /"ec2:StopInstances"/, "tunnel stop authority"],
  [runtime, /"rds:DescribeDBInstances"/, "RDS validation authority"],
  [runtime, /"ecs:DescribeTaskDefinition"/, "deployed config validation authority"],
  [outputs, /output "local_production_runtime_role_arn"/, "operator role output"],
  [outputs, /output "local_production_tunnel_instance_id"/, "tunnel instance output"],
];

for (const [source, pattern, label] of required) {
  if (!pattern.test(source))
    throw new Error(`Missing local production runtime contract: ${label}.`);
}

const tunnelSecurityGroup = resourceBlock(
  runtime,
  'resource "aws_security_group" "local_production_tunnel"',
);
if (!tunnelSecurityGroup) throw new Error("Could not inspect the tunnel security group.");
if (/\bingress\s*\{/.test(tunnelSecurityGroup)) {
  throw new Error("The local production tunnel security group must not have ingress rules.");
}
if (/resource "aws_security_group" "database"[\s\S]*cidr_blocks/.test(network)) {
  throw new Error("The production database security group must remain source-SG-only.");
}

process.stdout.write("Local production runtime infrastructure contract passed.\n");
