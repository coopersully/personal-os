# Production Cost Floor Design

## Outcome

Keep ilo's steady-state gross AWS spend at or below the $50 monthly budget without weakening database isolation, exposing application ports, or making connector egress unreliable.

## Evidence and constraints

- The corrected production budget is $50. August gross spend is $41.53 month to date and AWS forecasts $78.21.
- The largest removable fixed cost is the single NAT gateway: about $32.40 monthly before data processing. Giving the two Fargate tasks public IPv4 addresses adds about $7.20 monthly, for roughly $25 net monthly savings.
- CloudWatch alarms are not the primary cost driver. They are operationally useful and remain in place except where their underlying resource is removed.
- The API and MCP tasks already accept inbound traffic only from the load balancer security group. Public IP assignment does not change that policy.
- PostgreSQL remains in database-only private subnets and accepts traffic only from the application security group.
- Google mail and calendar synchronization requires reliable outbound HTTPS.

## Considered approaches

1. **Staged public-task migration, then NAT removal (recommended).** Move the two Fargate services to public subnets with public IPs while retaining their load-balancer-only security group. Leave the NAT gateway in place for the first rollout, prove inbound and outbound behavior, then remove the unused NAT resources. This produces the largest saving with a bounded rollback point.
2. **Keep private tasks and replace NAT with VPC endpoints.** AWS interface endpoints do not provide general Google API egress and introduce their own hourly cost, so a NAT path would still be required.
3. **Delete monitoring and security controls first.** This saves materially less than the NAT migration and would remove evidence needed to distinguish provider failures, deployment drains, and real outages.

## Design

### Release 1: move application egress

- Configure the API and MCP ECS services to use the existing two public subnets and `assign_public_ip = true`.
- Preserve the application security group. It allows service-port ingress only from the load balancer security group; no direct internet ingress is added.
- Preserve database subnets, database routing, and database security-group rules.
- Keep the NAT gateway, EIP, application subnets, and NAT alarms during this release so rollback does not require recreating infrastructure.
- Prove API, MCP, and web health; ECS target health; Google connector scheduled sync freshness; and outbound provider access in production.

### Release 2: remove the unused fixed-cost path

After Release 1 production evidence is green:

- Remove the NAT gateway, its EIP, application subnets, application route table and associations, and NAT-specific alarms.
- Reduce paid Route 53 string-match health checks from three endpoints to one user-facing app check. ALB target-health alarms continue covering API and MCP, and the scheduled production-health workflow retains full endpoint checks.
- Change AWS Config recording from continuous to daily. Security Hub, GuardDuty, audit delivery, WAF, budget alerts, deployment alarms, ECS alarms, database alarms, and connector freshness alarms remain enabled.
- Apply and prove that the Terraform plan contains only the intended removals and recording-frequency change.

## Failure handling and rollback

- Release 1 is the rollback boundary: the NAT path remains available while public-task connectivity is proven. A failed ECS rollout uses the existing circuit breaker and can be reverted to application subnets.
- Release 2 begins only after connector freshness resets on schedule and all public endpoints are healthy on Release 1.
- If outbound connector calls fail after Release 2, recreate the NAT resources from the preceding revision and return the ECS services to application subnets.
- A production deployment cannot report success while planned-drain alert suppression remains active.

## Verification

- `terraform fmt -check -recursive infra`
- `terraform -chdir=infra init -backend=false -input=false`
- `terraform -chdir=infra validate`
- `pnpm verify`
- Review the production Terraform plan before each apply.
- After Release 1, verify healthy ECS tasks have public IPs, security groups expose no application ports to the internet, all three public endpoints return 200, and connector freshness resets on schedule.
- After Release 2, verify the NAT gateway and EIP are absent, the app health check remains healthy, actionable alarms remain configured, and the cost forecast reflects the lower fixed-cost floor.

## Expected result

The NAT migration should reduce steady-state spend by about $25 monthly net. The health-check reduction and daily Config recording should save several additional dollars, bringing the current $78.21 forecast to approximately the high-$40s while retaining the controls that catch real production failures.
