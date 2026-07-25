variable "aws_region" {
  description = "AWS region for all Personal OS production resources."
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

variable "owner_emails" {
  description = "Comma-separated initial Personal OS owners allowed to create invitations."
  type        = string
  sensitive   = true
}

variable "email_from" {
  description = "Verified transactional sender, for example Personal OS <noreply@example.com>."
  type        = string
}

variable "google_client_id" {
  description = "Production Google OAuth client ID. The secret remains in Parameter Store."
  type        = string
  default     = ""
}

variable "registration_mode" {
  description = "Keep invite during the hosted beta; open is an intentional future choice."
  type        = string
  default     = "invite"

  validation {
    condition     = contains(["invite", "open"], var.registration_mode)
    error_message = "registration_mode must be invite or open."
  }
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
