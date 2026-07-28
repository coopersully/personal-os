output "api_ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "mcp_ecr_repository_url" {
  value = aws_ecr_repository.mcp.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "api_service_name" {
  value = aws_ecs_service.api.name
}

output "mcp_service_name" {
  value = aws_ecs_service.mcp.name
}

output "web_bucket_name" {
  value = aws_s3_bucket.web.id
}

output "web_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "operations_topic_arn" {
  value = aws_sns_topic.operations.arn
}

output "operations_dashboard_name" {
  value = aws_cloudwatch_dashboard.operations.dashboard_name
}

output "audit_bucket_name" {
  value = aws_s3_bucket.audit.id
}

output "rds_endpoint" {
  value = aws_db_instance.postgres.address
}

output "rds_master_secret_arn" {
  value     = aws_db_instance.postgres.master_user_secret[0].secret_arn
  sensitive = true
}

output "app_url" {
  value = "https://${local.app_domain}"
}

output "api_url" {
  value = "https://${local.api_domain}"
}

output "mcp_url" {
  value = "https://${local.mcp_domain}/mcp"
}
