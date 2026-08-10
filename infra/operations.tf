locals {
  operations_topic_name = "${local.name}-operations"
  alarm_actions         = [aws_sns_topic.operations.arn]

  public_health_checks = {
    app = {
      fqdn          = local.app_domain
      path          = "/"
      search_string = "<title>ilo"
    }
    api = {
      fqdn          = local.api_domain
      path          = "/health/ready"
      search_string = "\"ready\""
    }
    mcp = {
      fqdn          = local.mcp_domain
      path          = "/health/live"
      search_string = "\"ok\""
    }
  }

  ecs_services = {
    api = {
      name         = "${local.name}-api"
      resource_id  = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
      target_group = aws_lb_target_group.api
    }
    mcp = {
      name         = "${local.name}-mcp"
      resource_id  = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.mcp.name}"
      target_group = aws_lb_target_group.mcp
    }
  }
}

resource "aws_sns_topic" "operations" {
  name = local.operations_topic_name
}

data "aws_iam_policy_document" "operations_topic" {
  statement {
    sid    = "OwnerAdministration"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [data.aws_caller_identity.current.account_id]
    }

    actions = [
      "sns:AddPermission",
      "sns:DeleteTopic",
      "sns:GetTopicAttributes",
      "sns:ListSubscriptionsByTopic",
      "sns:Publish",
      "sns:RemovePermission",
      "sns:SetTopicAttributes",
      "sns:Subscribe",
    ]
    resources = [aws_sns_topic.operations.arn]
  }

  statement {
    sid    = "AWSServiceAlerts"
    effect = "Allow"

    principals {
      type = "Service"
      identifiers = [
        "budgets.amazonaws.com",
        "cloudwatch.amazonaws.com",
        "config.amazonaws.com",
        "costalerts.amazonaws.com",
        "events.amazonaws.com",
      ]
    }

    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.operations.arn]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "operations" {
  arn    = aws_sns_topic.operations.arn
  policy = data.aws_iam_policy_document.operations_topic.json
}

resource "aws_sns_topic_subscription" "operations_email" {
  count = var.alert_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.operations.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit             = false
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = false
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_amortized              = false
    use_blended                = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = var.alert_email == "" ? [] : [var.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.operations.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = var.alert_email == "" ? [] : [var.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.operations.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = var.alert_email == "" ? [] : [var.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.operations.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "FORECASTED"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = var.alert_email == "" ? [] : [var.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.operations.arn]
  }

  depends_on = [aws_sns_topic_policy.operations]
}

resource "aws_ce_anomaly_subscription" "operations" {
  count = var.alert_email != "" && var.cost_anomaly_monitor_arn != null ? 1 : 0

  name             = "${local.name}-cost-anomalies"
  frequency        = "IMMEDIATE"
  monitor_arn_list = [var.cost_anomaly_monitor_arn]

  subscriber {
    address = aws_sns_topic.operations.arn
    type    = "SNS"
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.cost_anomaly_threshold_usd)]
    }
  }
}

resource "aws_ce_cost_allocation_tag" "application" {
  tag_key = "Application"
  status  = "Active"
}

resource "aws_route53_health_check" "public" {
  for_each = local.public_health_checks

  fqdn              = each.value.fqdn
  port              = 443
  type              = "HTTPS_STR_MATCH"
  resource_path     = each.value.path
  search_string     = each.value.search_string
  failure_threshold = 3
  request_interval  = 30
  enable_sni        = true

  tags = {
    Name = "${local.name}-${each.key}"
  }
}

resource "aws_cloudwatch_metric_alarm" "public_health" {
  for_each = aws_route53_health_check.public

  alarm_name          = "${local.name}-${each.key}-public-health"
  alarm_description   = "External HTTPS health check for ilo ${each.key} is failing."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  statistic           = "Minimum"
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "breaching"

  dimensions = {
    HealthCheckId = each.value.id
  }

  alarm_actions = each.key == "api" ? [] : local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "api_deployment_in_progress" {
  alarm_name          = "${local.name}-api-deployment-in-progress"
  alarm_description   = "The serial API deployment heartbeat is active; raw API availability alarms remain diagnostic until it clears."
  namespace           = "ilo/Deployments"
  metric_name         = "ApiDeploymentInProgress"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_composite_alarm" "api_availability_actionable" {
  alarm_name        = "${local.name}-api-availability-actionable"
  alarm_description = "The public API is unavailable without an active serial deployment heartbeat."
  alarm_rule = format(
    "ALARM(\"%s\") AND NOT ALARM(\"%s\")",
    aws_cloudwatch_metric_alarm.public_health["api"].alarm_name,
    aws_cloudwatch_metric_alarm.api_deployment_in_progress.alarm_name,
  )

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  for_each = local.ecs_services

  alarm_name          = "${local.name}-${each.key}-cpu-high"
  alarm_description   = "ECS ${each.key} CPU utilization is sustained above 80%."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = each.value.name
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  for_each = local.ecs_services

  alarm_name          = "${local.name}-${each.key}-memory-high"
  alarm_description   = "ECS ${each.key} memory utilization is sustained above 80%."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = each.value.name
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "target_unhealthy" {
  for_each = local.ecs_services

  alarm_name          = "${local.name}-${each.key}-targets-unhealthy"
  alarm_description   = "The ${each.key} target group contains an unhealthy task."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.public.arn_suffix
    TargetGroup  = each.value.target_group.arn_suffix
  }

  alarm_actions = each.key == "api" ? [] : local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "target_5xx" {
  for_each = local.ecs_services

  alarm_name          = "${local.name}-${each.key}-target-5xx"
  alarm_description   = "The ${each.key} service returned at least five 5xx responses in five minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.public.arn_suffix
    TargetGroup  = each.value.target_group.arn_suffix
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "target_latency" {
  for_each = local.ecs_services

  alarm_name          = "${local.name}-${each.key}-latency-high"
  alarm_description   = "The ${each.key} p95 response time is above three seconds."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 3
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.public.arn_suffix
    TargetGroup  = each.value.target_group.arn_suffix
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name}-alb-5xx"
  alarm_description   = "Dashboard-only signal for load-balancer-generated 5xx responses; deployment-safe external health alarms page operators."
  actions_enabled     = false
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.public.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${local.name}-rds-cpu-high"
  alarm_description   = "RDS CPU utilization is sustained above 90%."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 90
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${local.name}-rds-storage-low"
  alarm_description   = "RDS has less than 5 GiB of free storage before auto-scaling."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  comparison_operator = "LessThanThreshold"
  threshold           = 5368709120
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_memory_low" {
  alarm_name          = "${local.name}-rds-memory-low"
  alarm_description   = "RDS has less than 128 MiB of freeable memory."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  statistic           = "Minimum"
  comparison_operator = "LessThanThreshold"
  threshold           = 134217728
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${local.name}-rds-connections-high"
  alarm_description   = "RDS is approaching the connection limit for the beta instance."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 60
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "nat_port_errors" {
  alarm_name          = "${local.name}-nat-port-errors"
  alarm_description   = "The NAT gateway cannot allocate an outbound source port."
  namespace           = "AWS/NATGateway"
  metric_name         = "ErrorPortAllocation"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    NatGatewayId = aws_nat_gateway.application.id
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "nat_packet_drops" {
  alarm_name          = "${local.name}-nat-packet-drops"
  alarm_description   = "The NAT gateway dropped outbound packets."
  namespace           = "AWS/NATGateway"
  metric_name         = "PacketsDropCount"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"

  dimensions = {
    NatGatewayId = aws_nat_gateway.application.id
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "cloudfront_5xx" {
  alarm_name          = "${local.name}-cloudfront-5xx"
  alarm_description   = "CloudFront's five-minute 5xx error rate is above 5%."
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 5
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = aws_cloudfront_distribution.web.id
    Region         = "Global"
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_log_metric_filter" "api_5xx" {
  name           = "${local.name}-api-5xx"
  pattern        = "{ $.status >= 500 }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "Api5xxCount"
    namespace = "ilo/Logs"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_log_5xx" {
  alarm_name          = "${local.name}-api-log-5xx"
  alarm_description   = "The API logged at least five server errors in five minutes."
  namespace           = "ilo/Logs"
  metric_name         = "Api5xxCount"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.api_5xx]
}

resource "aws_cloudwatch_log_metric_filter" "connector_sync_failure" {
  name           = "${local.name}-connector-sync-failure"
  pattern        = "{ $.event = \"connector_sync_failed\" }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "ConnectorSyncFailureCount"
    namespace = "ilo/Connectors"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "connector_configuration_failure" {
  name           = "${local.name}-connector-configuration-failure"
  pattern        = "{ $.event = \"connector_sync_failed\" && $.category = \"configuration\" }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "ConnectorConfigurationFailureCount"
    namespace = "ilo/Connectors"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "connector_subscription_failure" {
  name           = "${local.name}-connector-subscription-failure"
  pattern        = "{ $.event = \"connector_subscription_failed\" }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "ConnectorSubscriptionFailureCount"
    namespace = "ilo/Connectors"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "connector_subscription_expired" {
  name           = "${local.name}-connector-subscription-expired"
  pattern        = "{ $.event = \"connector_subscription_expired\" }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "ConnectorSubscriptionExpiredCount"
    namespace = "ilo/Connectors"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "connector_renewal_lag" {
  name           = "${local.name}-connector-renewal-lag"
  pattern        = "{ $.event = \"connector_subscription_renewed\" && $.renewalLagMs = * }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "ConnectorRenewalLagMs"
    namespace = "ilo/Connectors"
    value     = "$.renewalLagMs"
  }
}

resource "aws_cloudwatch_log_metric_filter" "connector_notification_rejected" {
  name           = "${local.name}-connector-notification-rejected"
  pattern        = "{ $.event = \"connector_notification_received\" && $.notificationDisposition = \"rejected\" }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "ConnectorNotificationRejectedCount"
    namespace = "ilo/Connectors"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "connector_trigger_age" {
  name           = "${local.name}-connector-trigger-age"
  pattern        = "{ $.event = \"connector_trigger_dispatched\" && $.ageMs = * }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "ConnectorTriggerAgeMs"
    namespace = "ilo/Connectors"
    value     = "$.ageMs"
  }
}

resource "aws_cloudwatch_log_metric_filter" "connector_sync_freshness_age" {
  name           = "${local.name}-connector-sync-freshness-age"
  pattern        = "{ $.event = \"connector_sync_freshness_observed\" && $.freshnessAgeMs = * }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "ConnectorSyncFreshnessAgeMs"
    namespace = "ilo/Connectors"
    value     = "$.freshnessAgeMs"
  }
}

resource "aws_cloudwatch_metric_alarm" "connector_configuration_failure" {
  alarm_name          = "${local.name}-connector-configuration-failure"
  alarm_description   = "A connector failed because production provider configuration needs operator repair."
  namespace           = "ilo/Connectors"
  metric_name         = "ConnectorConfigurationFailureCount"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.connector_configuration_failure]
}

resource "aws_cloudwatch_metric_alarm" "connector_sync_failure_volume" {
  alarm_name          = "${local.name}-connector-sync-failure-volume"
  alarm_description   = "At least five connector synchronizations failed within fifteen minutes."
  namespace           = "ilo/Connectors"
  metric_name         = "ConnectorSyncFailureCount"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  period              = 900
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.connector_sync_failure]
}

resource "aws_cloudwatch_metric_alarm" "connector_subscription_failure" {
  alarm_name          = "${local.name}-connector-subscription-failure"
  alarm_description   = "A live connector subscription failed to register or renew."
  namespace           = "ilo/Connectors"
  metric_name         = "ConnectorSubscriptionFailureCount"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  depends_on          = [aws_cloudwatch_log_metric_filter.connector_subscription_failure]
}

resource "aws_cloudwatch_metric_alarm" "connector_subscription_expired" {
  alarm_name          = "${local.name}-connector-subscription-expired"
  alarm_description   = "A non-stopped connector subscription reached expiry before renewal."
  namespace           = "ilo/Connectors"
  metric_name         = "ConnectorSubscriptionExpiredCount"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  depends_on          = [aws_cloudwatch_log_metric_filter.connector_subscription_expired]
}

resource "aws_cloudwatch_metric_alarm" "connector_renewal_lag" {
  alarm_name          = "${local.name}-connector-renewal-lag"
  alarm_description   = "A connector watch renewed more than five minutes after its renewal deadline."
  namespace           = "ilo/Connectors"
  metric_name         = "ConnectorRenewalLagMs"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 300000
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  depends_on          = [aws_cloudwatch_log_metric_filter.connector_renewal_lag]
}

resource "aws_cloudwatch_metric_alarm" "connector_notification_rejected" {
  alarm_name          = "${local.name}-connector-notification-rejected"
  alarm_description   = "At least twenty authenticated connector notifications were rejected in five minutes."
  namespace           = "ilo/Connectors"
  metric_name         = "ConnectorNotificationRejectedCount"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 20
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  depends_on          = [aws_cloudwatch_log_metric_filter.connector_notification_rejected]
}

resource "aws_cloudwatch_metric_alarm" "connector_trigger_age" {
  alarm_name          = "${local.name}-connector-trigger-age"
  alarm_description   = "A durable connector trigger waited at least five minutes before dispatch."
  namespace           = "ilo/Connectors"
  metric_name         = "ConnectorTriggerAgeMs"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 300000
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  depends_on          = [aws_cloudwatch_log_metric_filter.connector_trigger_age]
}

resource "aws_cloudwatch_metric_alarm" "connector_sync_freshness" {
  alarm_name          = "${local.name}-connector-sync-freshness"
  alarm_description   = "Current eligible connector freshness was at least ten minutes old in three of five one-minute observations, or observations stopped."
  namespace           = "ilo/Connectors"
  metric_name         = "ConnectorSyncFreshnessAgeMs"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 600000
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  depends_on          = [aws_cloudwatch_log_metric_filter.connector_sync_freshness_age]
}

resource "aws_appautoscaling_target" "ecs" {
  for_each = local.ecs_services

  max_capacity       = var.service_max_capacity
  min_capacity       = var.service_min_capacity
  resource_id        = each.value.resource_id
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  for_each = aws_appautoscaling_target.ecs

  name               = "${local.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = each.value.resource_id
  scalable_dimension = each.value.scalable_dimension
  service_namespace  = each.value.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 65
    scale_out_cooldown = 60
    scale_in_cooldown  = 300

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "ecs_memory" {
  for_each = aws_appautoscaling_target.ecs

  name               = "${local.name}-${each.key}-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = each.value.resource_id
  scalable_dimension = each.value.scalable_dimension
  service_namespace  = each.value.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70
    scale_out_cooldown = 60
    scale_in_cooldown  = 300

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${local.name}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "ECS CPU and memory"
          view    = "timeSeries"
          region  = var.aws_region
          stacked = false
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", local.ecs_services.api.name],
            [".", "MemoryUtilization", ".", ".", ".", "."],
            [".", "CPUUtilization", ".", ".", ".", local.ecs_services.mcp.name],
            [".", "MemoryUtilization", ".", ".", ".", "."],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Public errors and latency"
          view   = "timeSeries"
          region = var.aws_region
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", aws_lb.public.arn_suffix, "TargetGroup", aws_lb_target_group.api.arn_suffix, { stat = "Sum" }],
            [".", ".", ".", ".", ".", aws_lb_target_group.mcp.arn_suffix, { stat = "Sum" }],
            [".", "TargetResponseTime", ".", ".", ".", aws_lb_target_group.api.arn_suffix, { stat = "p95" }],
            [".", ".", ".", ".", ".", aws_lb_target_group.mcp.arn_suffix, { stat = "p95" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "RDS capacity"
          view   = "timeSeries"
          region = var.aws_region
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.postgres.identifier],
            [".", "DatabaseConnections", ".", "."],
            [".", "FreeStorageSpace", ".", "."],
            [".", "FreeableMemory", ".", "."],
          ]
        }
      },
      {
        type   = "alarm"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "ilo production alarms"
          alarms = concat(
            [for alarm in aws_cloudwatch_metric_alarm.public_health : alarm.arn],
            [for alarm in aws_cloudwatch_metric_alarm.ecs_cpu_high : alarm.arn],
            [for alarm in aws_cloudwatch_metric_alarm.ecs_memory_high : alarm.arn],
            [for alarm in aws_cloudwatch_metric_alarm.target_unhealthy : alarm.arn],
            [
              aws_cloudwatch_metric_alarm.alb_5xx.arn,
              aws_cloudwatch_metric_alarm.rds_cpu_high.arn,
              aws_cloudwatch_metric_alarm.rds_storage_low.arn,
              aws_cloudwatch_metric_alarm.rds_memory_low.arn,
              aws_cloudwatch_metric_alarm.cloudfront_5xx.arn,
              aws_cloudwatch_metric_alarm.connector_configuration_failure.arn,
              aws_cloudwatch_metric_alarm.connector_notification_rejected.arn,
              aws_cloudwatch_metric_alarm.connector_renewal_lag.arn,
              aws_cloudwatch_metric_alarm.connector_subscription_expired.arn,
              aws_cloudwatch_metric_alarm.connector_subscription_failure.arn,
              aws_cloudwatch_metric_alarm.connector_sync_freshness.arn,
              aws_cloudwatch_metric_alarm.connector_sync_failure_volume.arn,
              aws_cloudwatch_metric_alarm.connector_trigger_age.arn,
            ],
          )
        }
      },
    ]
  })
}
