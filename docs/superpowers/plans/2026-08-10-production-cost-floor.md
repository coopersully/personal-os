# Production Cost Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce ilo's steady-state gross AWS forecast from $78.21 to at most $50 per month while preserving connector egress, database isolation, and actionable production monitoring.

**Architecture:** Use two production releases. Release 1 moves the API and MCP Fargate tasks to existing public subnets with public IPv4 egress while the NAT rollback path remains. After production proof, Release 2 removes the unused NAT path, retains one outside-in app probe, and changes AWS Config to daily recording.

**Tech Stack:** Terraform, AWS ECS/Fargate, VPC, CloudWatch, Route 53 health checks, AWS Config, Node.js contract checks, GitHub Actions.

## Global Constraints

- The gross AWS budget is exactly $50 per month.
- API and MCP inbound ports remain reachable only from the load-balancer security group.
- PostgreSQL remains in database-only private subnets.
- Google mail and calendar scheduled synchronization retains outbound HTTPS access.
- WAF, Security Hub, GuardDuty, audit delivery, budget alerts, actionable deployment alarms, ECS alarms, database alarms, and connector freshness alarms remain enabled.
- Each release must pass `pnpm verify` and production verification before the next release begins.

---

### Task 1: Release 1 — move Fargate egress off NAT

**Files:**
- Create: `scripts/check-production-cost-floor-contract.mjs`
- Modify: `package.json`
- Modify: `infra/compute.tf`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: `aws_subnet.public[*].id`, `aws_security_group.application.id`, and the existing ECS circuit breakers.
- Produces: API and MCP ECS network configurations using public subnets with `assign_public_ip = true`; the NAT resources remain unchanged as the rollback boundary.

- [ ] **Step 1: Write the failing contract check**

Create `scripts/check-production-cost-floor-contract.mjs` to read `infra/compute.tf`, `infra/network.tf`, `infra/operations.tf`, and `infra/governance.tf`. Require both ECS service network blocks to contain `assign_public_ip = true`, `security_groups = [aws_security_group.application.id]`, and `subnets = aws_subnet.public[*].id`. During Release 1, also require `aws_nat_gateway.application` to remain declared.

- [ ] **Step 2: Register and run the failing check**

Add `node scripts/check-production-cost-floor-contract.mjs` to the root lint contract chain in `package.json`.

Run: `node scripts/check-production-cost-floor-contract.mjs`

Expected: FAIL because both ECS services still set `assign_public_ip = false` and use `aws_subnet.application`.

- [ ] **Step 3: Implement the Release 1 network change**

In both `aws_ecs_service.api` and `aws_ecs_service.mcp`, set:

```hcl
network_configuration {
  assign_public_ip = true
  security_groups  = [aws_security_group.application.id]
  subnets          = aws_subnet.public[*].id
}
```

Change each service dependency from `aws_route_table_association.application` to `aws_route_table_association.public`. Do not remove the NAT gateway, EIP, application subnets, routes, or NAT alarms in this release.

- [ ] **Step 4: Document the temporary rollback boundary**

Update `infra/README.md` to state that API/MCP tasks use public IPv4 egress with load-balancer-only inbound rules, the database remains private, and the NAT path is temporarily retained until production connector proof completes.

- [ ] **Step 5: Verify and commit Release 1**

Run:

```bash
node scripts/check-production-cost-floor-contract.mjs
terraform fmt -check -recursive infra
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
pnpm verify
```

Expected: all checks pass.

Commit:

```bash
git add package.json scripts/check-production-cost-floor-contract.mjs infra/compute.tf infra/README.md
git commit -m "infra: move service egress off nat"
```

- [ ] **Step 6: Publish and prove Release 1**

Open and merge a ready PR. Review the production Terraform plan before apply. After deployment, verify:

```bash
api_tasks="$(aws ecs list-tasks --cluster personal-os-prod --service-name personal-os-prod-api --desired-status RUNNING --query 'taskArns' --output text)"
mcp_tasks="$(aws ecs list-tasks --cluster personal-os-prod --service-name personal-os-prod-mcp --desired-status RUNNING --query 'taskArns' --output text)"
eni_ids="$(aws ecs describe-tasks --cluster personal-os-prod --tasks $api_tasks $mcp_tasks --query 'tasks[].attachments[].details[?name==`networkInterfaceId`].value' --output text)"
aws ec2 describe-network-interfaces --network-interface-ids $eni_ids --query 'NetworkInterfaces[].{PublicIp:Association.PublicIp,Groups:Groups[].GroupName,Subnet:SubnetId}'
curl -fsS https://app.ilo.coopersully.me/
curl -fsS https://api.ilo.coopersully.me/health/ready
curl -fsS https://mcp.ilo.coopersully.me/health/live
ECS_CLUSTER=personal-os-prod node .github/scripts/check-connector-observability.mjs
```

Expected: each task has a public IP, only the application security group, all endpoints are healthy, and connector freshness resets on schedule.

---

### Task 2: Release 2 — delete the unused fixed-cost path

**Files:**
- Modify: `scripts/check-production-cost-floor-contract.mjs`
- Modify: `infra/network.tf`
- Modify: `infra/operations.tf`
- Modify: `infra/governance.tf`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: the proven Release 1 public-task network configuration.
- Produces: no NAT gateway/EIP/application subnets or NAT alarms; one Route 53 app health check; AWS Config daily recording.

- [ ] **Step 1: Strengthen the contract check and observe failure**

Change the cost-floor check to reject `aws_eip.nat`, `aws_nat_gateway.application`, `aws_subnet.application`, `aws_route_table.application`, `aws_route_table_association.application`, `aws_cloudwatch_metric_alarm.nat_port_errors`, and `aws_cloudwatch_metric_alarm.nat_packet_drops`. Require `local.public_health_checks` to contain only `app`, and require `recording_frequency = "DAILY"`.

Run: `node scripts/check-production-cost-floor-contract.mjs`

Expected: FAIL while the rollback resources and continuous recording remain.

- [ ] **Step 2: Remove NAT and its unused application network**

Delete the NAT EIP, NAT gateway, application subnets, application route table, and application route-table associations from `infra/network.tf`. Database subnets and the public route table remain unchanged.

- [ ] **Step 3: Remove NAT alarms and reduce paid outside-in probes**

Delete the two NAT metric alarms from `infra/operations.tf`. Remove the `api` and `mcp` entries from `local.public_health_checks`, retaining the `app` HTTPS string-match check. Keep ALB target-health, actionable API availability, deployment heartbeat, and scheduled production-health checks.

- [ ] **Step 4: Reduce Config recording frequency**

Set this exact value in `aws_config_configuration_recorder.main`:

```hcl
recording_mode {
  recording_frequency = "DAILY"
}
```

- [ ] **Step 5: Update operations documentation**

Update `infra/README.md` to remove the temporary NAT rollback note and document the final public-task/private-database topology, one paid outside-in app probe, full scheduled endpoint checks, and daily AWS Config recording.

- [ ] **Step 6: Verify and commit Release 2**

Run:

```bash
node scripts/check-production-cost-floor-contract.mjs
terraform fmt -check -recursive infra
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
pnpm verify
```

Expected: all checks pass.

Commit:

```bash
git add scripts/check-production-cost-floor-contract.mjs infra/network.tf infra/operations.tf infra/governance.tf infra/README.md
git commit -m "infra: remove unused production cost floor"
```

- [ ] **Step 7: Publish and prove Release 2**

Open and merge a ready PR only after confirming the Terraform plan removes exactly the NAT/EIP/application-subnet resources, two NAT alarms, and two Route 53 health checks, plus the Config frequency update.

After apply, verify:

```bash
aws ec2 describe-nat-gateways --filter Name=tag:Application,Values=personal-os Name=state,Values=available,pending
aws route53 get-health-check-count
aws configservice describe-configuration-recorders
aws budgets describe-budget --account-id 686584420666 --budget-name personal-os-prod-monthly
```

Expected: no ilo NAT gateway remains, the app probe is healthy, Config records daily, all endpoints and connector freshness pass, and the amortized steady-state forecast is at most $50.
