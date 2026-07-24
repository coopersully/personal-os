# Personal OS AWS infrastructure

This directory defines an AWS deployment baseline in `us-east-1`:

- private RDS PostgreSQL with encrypted storage, automated backups, and an RDS-managed master password;
- two immutable ECR repositories and ECS Fargate services for the API and public MCP endpoint;
- a public ALB with ACM TLS, host routing, WAF rate limiting, and CloudWatch logs;
- a private S3 web bucket delivered through CloudFront; and
- a GitHub Actions OIDC deployment role restricted to the repository and branch configured in Terraform.

The tasks run in public subnets with public egress to avoid the fixed cost of a NAT gateway during the beta. They are *not* publicly reachable: their security group accepts inbound traffic only from the ALB. PostgreSQL remains in private subnets and accepts traffic only from application tasks. Move tasks to private subnets with NAT or VPC endpoints before a higher-scale launch.

## One-time bootstrap

Terraform state is intentionally separate from the application stack.

```bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
# Choose a globally unique bucket name in terraform.tfvars.
terraform init
terraform apply
```

Then copy `infra/backend.hcl.example` to a private `infra/backend.hcl`, replace its bucket/table placeholders with the outputs above, and initialize the main stack:

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
is ready and `plaid_enabled = true`; disabled Plaid injects no Plaid secret.

The RDS instance creates its master password in Secrets Manager without putting it in Terraform state. During bootstrap, use that value only to create a production `DATABASE_URL` parameter (or preferably create a least-privilege database role first, then store that role's URL). Never place a database password in `terraform.tfvars`, GitHub variables, task definitions, or the repository.

Set `domain_name`, `route53_zone_id`, `owner_emails`, `email_from`, and `google_client_id` in the untracked `terraform.tfvars`. Terraform derives:

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

The companion GitHub deployment workflow should:

1. run only after CI succeeds on `main` and authenticate using the `github_deploy_role_arn` output;
2. build API and MCP images, tag each as `sha-<commit>`, and push to ECR;
3. build the web app with `VITE_API_BASE_URL=https://api.<domain>` and sync it to the web bucket;
4. register API/MCP task-definition revisions using the immutable image tags;
5. deploy one migration-capable API task, then update API and MCP services to desired count `1`;
6. wait for target-group health and invalidate CloudFront.

The task execution role—not the application task roles—can read the named runtime parameters. The deployment role cannot read application secrets.

## Cost and availability posture

This is a deliberate invite-only-beta baseline: one API task, one MCP task, a single-AZ `db.t4g.micro` database, CloudFront/S3 web delivery, and a public ALB. WAF is enabled by default. Multi-AZ RDS, private-task NAT, custom KMS keys, multi-replica services, and an on-call alarm suite should be added before claiming high availability.

Run `terraform fmt -recursive` and `terraform validate` before every infrastructure pull request. Terraform plans and applies are production changes and should be reviewed separately from application deployment commits.
