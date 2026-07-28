# ilo AWS infrastructure

This directory defines an AWS deployment baseline in `us-east-1`:

- private RDS PostgreSQL with encrypted storage, automated backups, and an RDS-managed master password;
- two immutable ECR repositories and ECS Fargate services for the API and public MCP endpoint;
- private ECS application subnets with outbound-only provider access through a NAT gateway;
- a public ALB with ACM TLS, strict host routing, managed WAF protections, and CloudWatch logs;
- a private, encrypted S3 web bucket delivered through CloudFront with browser security headers;
- external HTTPS checks, CloudWatch alarms/dashboard, and an email-backed SNS operations channel;
- GuardDuty, IAM Access Analyzer, Security Hub Foundational Best Practices, AWS Config, and a validated multi-Region CloudTrail;
- weekly database recovery points in AWS Backup in addition to RDS automated backups;
- monthly budget, low-threshold cost anomaly notifications, and active cost-allocation tags;
- authoritative DNS records in an existing Cloudflare zone; and
- a GitHub Actions OIDC deployment role restricted to the repository and branch configured in Terraform.

The tasks run without public IP addresses and accept inbound traffic only from
the ALB. Their security group permits only DNS, PostgreSQL inside the VPC, and
outbound TLS for provider APIs and transactional email. PostgreSQL remains in
dedicated private subnets and accepts traffic only from application tasks.

## One-time bootstrap

Terraform state is intentionally separate from the application stack.

```bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
# Choose a globally unique bucket name in terraform.tfvars.
terraform init
terraform apply
```

Then copy `infra/backend.hcl.example` to a private `infra/backend.hcl`, replace
its bucket placeholder with the output above, and initialize the main stack.
The backend uses Terraform's native S3 lockfile:

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Do not use the account root identity for routine applies. Create a named administrator/deployer profile first. The bootstrap apply is the only deliberately manual foundation step.

## Runtime configuration before the first deployment

The API task reads these SecureString parameters from `var.ssm_parameter_prefix`:

```text
APP_ENCRYPTION_KEY
DATABASE_URL
GOOGLE_CLIENT_SECRET
MCP_INTERNAL_SECRET
RESEND_API_KEY
```

Before the first task starts, create every required parameter under the configured
`ssm_parameter_prefix`. Add `PLAID_SECRET` only when a Plaid production account
is ready and `plaid_enabled = true`; `PLAID_CLIENT_ID` is also read from
Parameter Store in that mode. When `x_enabled = true`, add `X_CLIENT_ID` and
`X_CLIENT_SECRET`. Disabled connectors inject no connector credentials.

The RDS instance creates its master password in Secrets Manager without putting it in Terraform state. During bootstrap, use that value only to create a production `DATABASE_URL` parameter (or preferably create a least-privilege database role first, then store that role's URL). Never place a database password in `terraform.tfvars`, GitHub variables, task definitions, or the repository.

The production database URL should verify RDS TLS with the CA bundle embedded in
the API image:

```text
postgresql://.../personal_os?sslmode=verify-full&sslrootcert=/app/aws-rds-global-bundle.pem
```

Because the API applies Drizzle migrations during startup, its least-privilege
database role needs `CREATE` on the `personal_os` database plus `USAGE, CREATE`
on the `public` schema.

Set `domain_name`, `cloudflare_zone_id`, `owner_emails`, `alert_email`,
`monthly_budget_usd`, `email_from`, and `google_client_id` in the untracked
`terraform.tfvars`. Reuse the account's service Cost Anomaly Detection monitor
through `cost_anomaly_monitor_arn` to add ilo's immediate lower-threshold
subscription. Export a scoped `CLOUDFLARE_API_TOKEN` with DNS Read and DNS
Write access before planning or applying. Terraform derives:

```text
https://app.<domain>
https://api.<domain>
https://mcp.<domain>/mcp
```

Register the derived Google callback URL before enabling Google connections:

```text
https://api.<domain>/v1/connectors/google/callback
```

## First release and continuous deployment

The initial Terraform apply deliberately creates ECS services at desired count `0`, with a non-existent `bootstrap` image tag. That prevents an empty foundation apply from starting a task with no real release image.

After applying Terraform, copy its outputs into the `production` GitHub
environment variables:

| GitHub variable | Terraform output/value |
| --- | --- |
| `AWS_REGION` | `aws_region` input |
| `AWS_ROLE_ARN` | `github_deploy_role_arn` |
| `API_ECR_REPOSITORY` | `api_ecr_repository_url` |
| `MCP_ECR_REPOSITORY` | `mcp_ecr_repository_url` |
| `ECS_CLUSTER` | `ecs_cluster_name` |
| `API_SERVICE` | `api_service_name` |
| `MCP_SERVICE` | `mcp_service_name` |
| `WEB_BUCKET` | `web_bucket_name` |
| `WEB_DISTRIBUTION_ID` | `web_distribution_id` |
| `APP_URL` | `app_url` |
| `API_URL` | `api_url` |
| `MCP_URL` | `mcp_url` |

`.github/workflows/deploy.yml` runs only after CI succeeds on `main` (or from a
manual dispatch on `main`). Its job must use the protected GitHub environment
named by `github_environment`; the OIDC trust policy accepts only that
environment. Repositories that customize GitHub's OIDC subject to include
immutable owner and repository IDs must set `github_oidc_subject` to the exact
`repo:<owner>@<owner-id>/<repository>@<repository-id>:environment:<name>`
subject recorded by CloudTrail. The workflow publishes immutable
`sha-<commit>` images, registers task-definition revisions, deploys the
migration-capable API serially, waits for API health before deploying MCP,
publishes the web build, invalidates CloudFront, and verifies all three public
surfaces. ECS deployment circuit breakers roll back unhealthy task revisions.

The task execution role—not the application task roles—can read the named runtime parameters. The deployment role cannot read application secrets.

## Unattended operations

The `personal-os-prod-operations` SNS topic receives alarm, database, backup,
ECS deployment, AWS Health, GuardDuty, Security Hub, and IAM Access Analyzer
events. The configured email endpoint must confirm the one-time Amazon SNS
subscription before runtime alerts can arrive. Budget and Cost Anomaly
Detection alerts use the same operations topic; budget notifications are also
sent directly so the budget does not depend only on SNS confirmation.
AWS Config records continuously to the audit bucket but is intentionally not
attached directly to this topic because its per-resource change stream is far
too noisy for an operator alert channel.

CloudWatch alarms cover public HTTPS health, ECS CPU/memory, unhealthy targets,
5xx responses, latency, RDS CPU/storage/memory/connections, NAT failures, and
CloudFront 5xx rate. The `personal-os-prod-operations` dashboard collects the
primary service and database signals. Alarms send both failure and recovery
notifications.

GitHub records a `production/ilo` commit status for each protected `main`
release. Failed CI or deployment opens one deduplicated production incident;
the next successful deployment comments on and closes it. The hourly
`Production health` workflow independently checks all three public surfaces
and manages a separate deduplicated health incident.

ECS target tracking keeps one task warm and may scale each service to two tasks
for CPU or memory pressure. ECR keeps 15 rollback images and removes untagged
images after one day. Web and Terraform-state noncurrent versions expire after
bounded recovery windows. CloudTrail and Config history is retained for one
year, with obsolete object versions removed sooner.

AWS Compute Optimizer and Cost Optimization Hub are account-level opt-ins rather
than Terraform resources. They are enabled for this account and should remain
active so AWS continuously produces rightsizing and waste-reduction
recommendations.

## Cost and availability posture

This is a secured invite-only-beta baseline: one private API task, one private
MCP task, a single-AZ `db.t4g.micro` database, CloudFront/S3 web delivery, and a
public ALB protected by managed WAF rules. The alarm suite and bounded
auto-scaling are suitable for unattended beta operation. Multi-AZ RDS and
multi-replica minimums remain deliberate paid upgrades before claiming high
availability.

Run `terraform fmt -recursive` and `terraform validate` before every infrastructure pull request. Terraform plans and applies are production changes and should be reviewed separately from application deployment commits.
