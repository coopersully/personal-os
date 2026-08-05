variable "aws_region" {
  description = "AWS region for all ilo production resources."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short, DNS-safe project identifier."
  type        = string
  default     = "personal-os"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project_name))
    error_message = "project_name must be a lowercase DNS-safe identifier."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Registered apex domain, such as example.com. Terraform creates app, api, and mcp subdomains beneath it."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Authoritative Cloudflare zone ID for domain_name."
  type        = string
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to assume the deployment role."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must use the owner/repository format."
  }
}

variable "github_environment" {
  description = "Protected GitHub environment allowed to assume the production deployment role."
  type        = string
  default     = "production"
}

variable "github_oidc_subject" {
  description = "Exact GitHub Actions OIDC subject allowed to assume the deployment role. Set this when the repository uses a customized subject claim with immutable owner and repository IDs."
  type        = string
  default     = null

  validation {
    condition = (
      var.github_oidc_subject == null ||
      can(regex("^repo:[^:]+:environment:[^:]+$", var.github_oidc_subject))
    )
    error_message = "github_oidc_subject must be a GitHub environment subject in repo:<identity>:environment:<name> form."
  }
}

variable "owner_emails" {
  description = "Comma-separated initial ilo owners allowed to create invitations."
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Email address for production health, security, backup, and cost alerts."
  type        = string
  default     = ""

  validation {
    condition     = var.alert_email == "" || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.alert_email))
    error_message = "alert_email must be blank or a valid email address."
  }
}

variable "monthly_budget_usd" {
  description = "Account-wide monthly AWS cost budget in USD."
  type        = number
  default     = 100

  validation {
    condition     = var.monthly_budget_usd >= 10
    error_message = "monthly_budget_usd must be at least 10."
  }
}

variable "cost_anomaly_monitor_arn" {
  description = "Existing account Cost Anomaly Detection monitor ARN to notify at ilo's lower threshold."
  type        = string
  default     = null
}

variable "cost_anomaly_threshold_usd" {
  description = "Absolute unexpected-spend impact that triggers an immediate operations-topic alert."
  type        = number
  default     = 10

  validation {
    condition     = var.cost_anomaly_threshold_usd >= 1
    error_message = "cost_anomaly_threshold_usd must be at least 1."
  }
}

variable "email_from" {
  description = "Verified transactional sender, for example ilo <noreply@example.com>."
  type        = string
}

variable "plaid_enabled" {
  description = "Inject the Plaid runtime secret only when the production Plaid integration is enabled."
  type        = bool
  default     = false
}

variable "plaid_environment" {
  description = "Plaid API environment used when plaid_enabled is true."
  type        = string
  default     = "sandbox"

  validation {
    condition     = contains(["sandbox", "development", "production"], var.plaid_environment)
    error_message = "plaid_environment must be sandbox, development, or production."
  }
}

variable "x_enabled" {
  description = "Inject the X OAuth client credentials when the production X bookmarks integration is enabled."
  type        = bool
  default     = false
}

variable "ssm_parameter_prefix" {
  description = "Parameter Store path containing runtime configuration, without a trailing slash."
  type        = string
  default     = "/personal-os/prod"
}

variable "api_desired_count" {
  description = "Initial API task count. Keep at 0 until the first GitHub deployment has pushed an image."
  type        = number
  default     = 0
}

variable "mcp_desired_count" {
  description = "Initial MCP task count. Keep at 0 until the first GitHub deployment has pushed an image."
  type        = number
  default     = 0
}

variable "service_min_capacity" {
  description = "Minimum running task count maintained by ECS service auto scaling."
  type        = number
  default     = 1
}

variable "service_max_capacity" {
  description = "Maximum running task count allowed during load spikes."
  type        = number
  default     = 2

  validation {
    condition     = var.service_max_capacity >= var.service_min_capacity
    error_message = "service_max_capacity must be greater than or equal to service_min_capacity."
  }
}

variable "database_instance_class" {
  description = "RDS instance size. db.t4g.micro is an economical single-user/beta starting point."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_multi_az" {
  description = "Enable only when the beta needs multi-AZ database availability."
  type        = bool
  default     = false
}

variable "enable_waf" {
  description = "Attach a regional WAF rate-limit rule to the public ALB."
  type        = bool
  default     = true
}

variable "edge_rate_limit" {
  description = "Maximum requests per source IP in a five-minute WAF window."
  type        = number
  default     = 1000
}
