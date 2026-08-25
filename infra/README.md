# ilo AWS infrastructure

This directory defines an AWS deployment baseline in `us-east-1`:

- private RDS PostgreSQL with encrypted storage, automated backups, and an RDS-managed master password;
- two immutable ECR repositories and ECS Fargate services for the API and public MCP endpoint;
- ECS application tasks in public subnets with tightly scoped security groups and direct provider egress;
- a public ALB with ACM TLS, strict host routing, managed WAF protections, and CloudWatch logs;
- a private, encrypted S3 web bucket delivered through CloudFront with browser security headers;
- external app and deployment-aware API HTTPS checks, CloudWatch alarms/dashboard, and an email-backed SNS operations channel;
- GuardDuty, IAM Access Analyzer, Security Hub Foundational Best Practices, AWS Config, and a validated multi-Region CloudTrail;
- weekly database recovery points in AWS Backup in addition to RDS automated backups;
- monthly budget, low-threshold cost anomaly notifications, and active cost-allocation tags;
- authoritative DNS records in an existing Cloudflare zone; and
- a GitHub Actions OIDC deployment role restricted to the repository and branch configured in Terraform.

The tasks receive public IP addresses for direct provider egress but accept inbound traffic only
from the ALB security group. Their security group permits only DNS, PostgreSQL inside the VPC,
HTTPS provider traffic on TCP 443 and iCloud Mail IMAP over TLS on TCP 993. PostgreSQL remains in
dedicated private subnets and accepts traffic only from application tasks. Ilo has no user-Mail
SMTP egress because it never sends email.

The optional local production runtime reaches the same private PostgreSQL instance through a
dedicated, no-ingress EC2 host managed by Systems Manager. The host has no SSH key, accepts no network
connections, and may send only PostgreSQL to the database plus DNS and HTTPS for the SSM control
channel. RDS also accepts TCP 5432 from that host's security group. A separate scoped role can start
or stop only this host, open only the AWS port-forwarding session document, inspect the deployed ilo
runtime, and read only ilo's exact runtime parameters. Set
`local_production_runtime_principal_arn` to a named non-root operator principal in private production
tfvars; do not leave the account-wide default in a production apply.

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

The application deployment workflow does not run a broad Terraform apply. Infrastructure changes
must cross a separately reviewed production plan so unrelated drift, replacements, and destructive
actions remain visible before mutation. A successful `terraform validate`, application deploy, or
public health request is not proof that the corresponding operational resources are live.

Production deploy therefore performs read-only preflights for infrastructure contracts the release
depends on. Connector releases require the exact live connector log metric filters and CloudWatch
alarms before any image is published, and the hourly production-health workflow repeats that check.
If the preflight fails, review the full production plan, apply only the intended infrastructure
changes, and rerun the deployment. Never bypass the preflight or apply an unreviewed broad plan to
repair one missing resource.

## Runtime configuration before the first deployment

The API task reads these parameters from `var.ssm_parameter_prefix` through ECS secret references:

```text
APP_ENCRYPTION_KEY
DATABASE_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MCP_INTERNAL_SECRET
RESEND_API_KEY
```

Before the first task starts, create every required parameter under the configured
`ssm_parameter_prefix`. Add `PLAID_SECRET` only when a Plaid production account
is ready and `plaid_enabled = true`; `PLAID_CLIENT_ID` is also read from
Parameter Store in that mode. Plaid-enabled production stacks must use
`plaid_environment = "production"` with production credentials and endpoints;
they must never use sandbox credentials or endpoints. When `x_enabled = true`,
add `X_CLIENT_ID` and `X_CLIENT_SECRET`. Disabled connectors inject no connector
credentials.

### Live Plaid verification before enabling the rollout

Configuration validation proves only that the task can start; it does not prove production Plaid
authentication, reachability, status retrieval, or durable maintenance. Before enabling
`plaid_enabled`, an authorized operator must use a production Finance token to perform one
authenticated `GET /v1/finances/status` and one bounded `POST /v1/finances/maintenance` request.
Record the maintenance request ID, its final durable run state, resulting freshness, any reconnect
state, and confirmation that replay created no duplicate projections. Keep the request scoped to a
known test connection or read-only-safe account; do not record credentials or provider payloads.
Credential and encryption values must be `SecureString`; public client identifiers may remain
`String`. The ECS `secrets` projection keeps both kinds out of the plain task environment and makes
the execution role—not the deployment workflow—responsible for runtime retrieval.

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
`monthly_budget_usd`, and `email_from` in the untracked
`terraform.tfvars`. Reuse the account's service Cost Anomaly Detection monitor
through `cost_anomaly_monitor_arn` to add ilo's immediate lower-threshold
subscription. Export a scoped `CLOUDFLARE_API_TOKEN` with DNS Read and DNS
Write access before planning or applying.

The Google client ID and secret both remain in SSM Parameter Store and are injected as ECS secret
references. The API fails production startup if either parameter resolves to an empty value. Inspect
the task definition's `secrets` names and `valueFrom` ARNs to verify wiring; never print parameter
values or copy the client ID into `terraform.tfvars`. Terraform derives:

```text
https://app.<domain>
https://api.<domain>
https://mcp.<domain>/mcp
```

Register the derived Google callback URL before enabling Google connections:

```text
https://api.<domain>/v1/connectors/google/callback
```

Low-latency connector modes are independent Terraform gates and default off:

- `google_gmail_push_enabled` requires a qualified Pub/Sub topic, subscription, and dedicated push
  service-account identity. Terraform derives the exact HTTPS OIDC audience.
- `google_calendar_push_enabled` derives the exact Calendar notification URL.
- `icloud_mail_idle_enabled` injects only its enable flag and bounded concurrency.

Disabled gates emit none of their optional environment values. These inputs are non-secret
identifiers; OAuth client credentials remain SSM-backed ECS secrets. Applying the AWS declaration
does not create or prove the external GCP topic, publisher grant, subscription, OIDC authority,
Google verification, or delivery. Keep a gate disabled until the evidence checklist in
[`docs/deployment.md`](../docs/deployment.md) is complete.

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
migration-capable API through the current ECS rolling service update, waits for API health before deploying MCP,
publishes the web build, invalidates CloudFront, and verifies all three public
surfaces. ECS deployment circuit breakers roll back unhealthy task revisions.
Manual dispatch accepts an optional full `release_sha` when an exact prior commit must be redeployed
after a task-definition or configuration change. When both immutable API and MCP images already
exist, the workflow reuses and rescans that pair; it refuses a partial pair instead of rebuilding or
overwriting one side.

Before it inspects live API deployment state or performs any drain mutation, the workflow validates
the latest API task definition. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must each be present
exactly once as SSM-backed ECS secret references, and `GOOGLE_CLIENT_ID` must not remain in the plain
environment list. A stale task definition stops the release before healthy tasks are touched. Apply
the reviewed Terraform configuration, inspect only the reference names/ARNs, and retry the same
immutable `release_sha`; never work around this gate by copying credential values into the workflow.

The rolling API update is not proof of a stop-and-drain boundary: old and new tasks may overlap.
Before a later serial-drain workflow is enabled, follow the prerequisite deployment and exact
active-task proof in [`docs/deployment.md`](../docs/deployment.md). Applying Terraform registers the
`stopTimeout`/shutdown-environment task definition, but `ignore_changes` deliberately prevents that
apply from moving the live service; an immutable application task definition must subsequently be
registered and deployed, then verified on every active task.

The task execution role—not the application task roles—can read the named runtime parameters. The deployment role cannot read application secrets.

## Unattended operations

The `personal-os-prod-operations` SNS topic receives alarm, database, backup,
ECS deployment, AWS Health, GuardDuty, Security Hub, and IAM Access Analyzer
events. The configured email endpoint must confirm the one-time Amazon SNS
subscription before runtime alerts can arrive. Budget and Cost Anomaly
Detection alerts use the same operations topic; budget notifications are also
sent directly so the budget does not depend only on SNS confirmation.
AWS Config records daily to the audit bucket but is intentionally not
attached directly to this topic because its per-resource change stream is far
too noisy for an operator alert channel.

API and MCP Fargate tasks use the public subnets for direct IPv4 egress while retaining the
application security group, whose service-port ingress is limited to the load-balancer security
group. The database remains isolated in database-only private subnets. This avoids the fixed NAT
gateway and Elastic IP cost while preserving the same inbound boundary.

CloudWatch alarms cover app and deployment-aware API public HTTPS health, ECS CPU/memory, unhealthy targets,
5xx responses, latency, RDS CPU/storage/memory/connections, and
CloudFront 5xx rate. The `personal-os-prod-operations` dashboard collects the
primary service and database signals. Human-facing alarms publish failure transitions only;
recovery remains available in CloudWatch history without generating another email. Raw API health
and target alarms remain diagnostic during the intentional serial drain. A 30-second
`ilo/Deployments` heartbeat suppresses the actionable API availability composite while that drain
is active; missing heartbeat data restores paging if the API remains unavailable.

Connector alarms additionally cover safe aggregate sync/configuration failures, live subscription
failure/expiry, renewal lag, rejected notifications, durable-trigger age, and sync freshness.
Expected duplicate notifications and intentionally stopped subscriptions are excluded. The live
deploy/health preflight validates the exact filters, transformations, thresholds, missing-data
policy, and operations-topic routes before treating this declaration as active evidence.
Freshness is the current maximum age reported by each one-minute scheduler observation across
automatically managed accounts; accounts awaiting user or operator authority repair do not keep the
operations pager open.

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
active so AWS produces rightsizing and waste-reduction
recommendations.

## Cost and availability posture

This is a secured invite-only-beta baseline: one API task, one MCP task, a
single-AZ `db.t4g.micro` database, CloudFront/S3 web delivery, and a
public ALB protected by managed WAF rules. The alarm suite and bounded
auto-scaling are suitable for unattended beta operation. Multi-AZ RDS and
multi-replica minimums remain deliberate paid upgrades before claiming high
availability.

Run `terraform fmt -recursive` and `terraform validate` before every infrastructure pull request.
For a changed external dependency, also reconcile the
[external boundary record](../docs/engineering/external-boundary-reliability.md) against the plan
and post-deploy smoke evidence. Terraform proves declared runtime policy; it does not prove that a
credential is authorized or that the dependency accepted the operation. Terraform plans and
applies are production changes and should be reviewed separately from application deployment
commits.
