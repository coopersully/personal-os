locals {
  name       = "${var.project_name}-${var.environment}"
  app_domain = "app.${var.domain_name}"
  api_domain = "api.${var.domain_name}"
  mcp_domain = "mcp.${var.domain_name}"
  github_oidc_subject = coalesce(
    var.github_oidc_subject,
    "repo:${var.github_repository}:environment:${var.github_environment}",
  )

  common_tags = {
    Application = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  runtime_parameter_names = setunion(
    toset([
      "APP_ENCRYPTION_KEY",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "MCP_INTERNAL_SECRET",
      "RESEND_API_KEY",
      "DATABASE_URL",
    ]),
    var.plaid_enabled ? toset(["PLAID_CLIENT_ID", "PLAID_SECRET"]) : toset([]),
    var.x_enabled ? toset(["X_CLIENT_ID", "X_CLIENT_SECRET"]) : toset([]),
    var.texting_enabled ? toset(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID", "TWILIO_VERIFY_SERVICE_SID"]) : toset([]),
  )

  runtime_parameter_arns = {
    for name in local.runtime_parameter_names :
    name => "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_parameter_prefix}/${name}"
  }
}
