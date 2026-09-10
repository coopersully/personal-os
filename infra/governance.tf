locals {
  audit_trail_name = "${local.name}-audit"

  guardduty_features = {
    EBS_MALWARE_PROTECTION = "ENABLED"
    RDS_LOGIN_EVENTS       = "ENABLED"
    S3_DATA_EVENTS         = "ENABLED"
  }

  operational_event_patterns = {
    backup_failure = {
      source      = ["aws.backup"]
      detail-type = ["Backup Job State Change"]
      detail = {
        state = ["ABORTED", "EXPIRED", "FAILED"]
      }
    }
    ecs_deployment_failure = {
      source      = ["aws.ecs"]
      detail-type = ["ECS Deployment State Change"]
      resources   = [aws_ecs_service.api.id, aws_ecs_service.mcp.id]
      detail = {
        eventType = ["ERROR"]
        eventName = ["SERVICE_DEPLOYMENT_FAILED"]
      }
    }
    health_event = {
      source      = ["aws.health"]
      detail-type = ["AWS Health Event"]
      detail = {
        eventStatusCode = ["open", "upcoming"]
      }
    }
    access_analyzer = {
      source      = ["aws.access-analyzer"]
      detail-type = ["Access Analyzer Finding"]
      detail = {
        status = ["ACTIVE"]
      }
    }
    guardduty_high = {
      source      = ["aws.guardduty"]
      detail-type = ["GuardDuty Finding"]
      detail = {
        severity = [{ numeric = [">=", 7] }]
      }
    }
    security_hub_high = {
      source      = ["aws.securityhub"]
      detail-type = ["Security Hub Findings - Imported"]
      detail = {
        findings = {
          RecordState = ["ACTIVE"]
          Severity = {
            Label = ["CRITICAL", "HIGH"]
          }
          Workflow = {
            Status = ["NEW", "NOTIFIED"]
          }
        }
      }
    }
  }
}

resource "aws_s3_bucket" "audit" {
  bucket_prefix = "${local.name}-audit-"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    id     = "audit-retention"
    status = "Enabled"

    filter {}

    expiration {
      days = 365
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.audit]
}

data "aws_iam_policy_document" "audit_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.audit.arn,
      "${aws_s3_bucket.audit.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "CloudTrailAclCheck"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit.arn]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${var.aws_region}:${data.aws_caller_identity.current.account_id}:trail/${local.audit_trail_name}"]
    }
  }

  statement {
    sid    = "CloudTrailWrite"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${var.aws_region}:${data.aws_caller_identity.current.account_id}:trail/${local.audit_trail_name}"]
    }
  }
}

resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = data.aws_iam_policy_document.audit_bucket.json
}

resource "aws_cloudtrail" "audit" {
  name                          = local.audit_trail_name
  s3_bucket_name                = aws_s3_bucket.audit.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  enable_logging                = true

  depends_on = [aws_s3_bucket_policy.audit]
}

data "aws_iam_policy_document" "config_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "config" {
  name               = "${local.name}-config"
  assume_role_policy = data.aws_iam_policy_document.config_assume_role.json
}

resource "aws_iam_role_policy_attachment" "config" {
  role       = aws_iam_role.config.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole"
}

data "aws_iam_policy_document" "config_delivery" {
  statement {
    actions = [
      "s3:GetBucketAcl",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.audit.arn]
  }

  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/config/AWSLogs/${data.aws_caller_identity.current.account_id}/Config/*"]
  }
}

resource "aws_iam_role_policy" "config_delivery" {
  name   = "${local.name}-config-delivery"
  role   = aws_iam_role.config.id
  policy = data.aws_iam_policy_document.config_delivery.json
}

resource "aws_config_configuration_recorder" "main" {
  name     = local.name
  role_arn = aws_iam_role.config.arn

  recording_group {
    all_supported                 = true
    include_global_resource_types = true
  }

  recording_mode {
    recording_frequency = "DAILY"
  }
}

resource "aws_config_delivery_channel" "main" {
  name           = local.name
  s3_bucket_name = aws_s3_bucket.audit.id
  s3_key_prefix  = "config"

  snapshot_delivery_properties {
    delivery_frequency = "TwentyFour_Hours"
  }

  depends_on = [
    aws_iam_role_policy.config_delivery,
  ]
}

resource "aws_config_configuration_recorder_status" "main" {
  name       = aws_config_configuration_recorder.main.name
  is_enabled = true

  depends_on = [aws_config_delivery_channel.main]
}

resource "aws_guardduty_detector" "main" {
  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"
}

resource "aws_guardduty_detector_feature" "main" {
  for_each = local.guardduty_features

  detector_id = aws_guardduty_detector.main.id
  name        = each.key
  status      = each.value
}

resource "aws_guardduty_detector_feature" "runtime" {
  detector_id = aws_guardduty_detector.main.id
  name        = "RUNTIME_MONITORING"
  status      = "ENABLED"

  additional_configuration {
    name   = "EC2_AGENT_MANAGEMENT"
    status = "DISABLED"
  }

  additional_configuration {
    name   = "EKS_ADDON_MANAGEMENT"
    status = "DISABLED"
  }

  additional_configuration {
    name   = "ECS_FARGATE_AGENT_MANAGEMENT"
    status = "ENABLED"
  }
}

resource "aws_accessanalyzer_analyzer" "external" {
  analyzer_name = "${local.name}-external-access"
  type          = "ACCOUNT"
}

resource "aws_securityhub_account" "main" {
  auto_enable_controls      = true
  control_finding_generator = "SECURITY_CONTROL"
  enable_default_standards  = false

  depends_on = [aws_config_configuration_recorder_status.main]
}

resource "aws_securityhub_standards_subscription" "foundational" {
  standards_arn = "arn:aws:securityhub:${var.aws_region}::standards/aws-foundational-security-best-practices/v/1.0.0"

  timeouts {
    create = "15m"
  }

  depends_on = [aws_securityhub_account.main]
}

data "aws_iam_policy_document" "backup_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${local.name}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume_role.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_vault" "database" {
  name = "${local.name}-database"
}

resource "aws_backup_plan" "database" {
  name = "${local.name}-database"

  rule {
    rule_name                    = "weekly-35-day-retention"
    target_vault_name            = aws_backup_vault.database.name
    schedule                     = "cron(0 6 ? * SUN *)"
    schedule_expression_timezone = "UTC"
    start_window                 = 120
    completion_window            = 360

    lifecycle {
      delete_after = 35
    }

    recovery_point_tags = local.common_tags
  }
}

resource "aws_backup_selection" "database" {
  name         = "${local.name}-database"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.database.id
  resources    = [aws_db_instance.postgres.arn]

  depends_on = [aws_iam_role_policy_attachment.backup]
}

resource "aws_db_event_subscription" "database" {
  name      = "${local.name}-database"
  sns_topic = aws_sns_topic.operations.arn

  source_type = "db-instance"
  source_ids  = [aws_db_instance.postgres.identifier]
  event_categories = [
    "availability",
    "configuration change",
    "failure",
    "failover",
    "low storage",
    "maintenance",
    "notification",
    "recovery",
  ]

  depends_on = [aws_sns_topic_policy.operations]
}

resource "aws_cloudwatch_event_rule" "operations" {
  for_each = local.operational_event_patterns

  name          = "${local.name}-${replace(each.key, "_", "-")}"
  description   = "Route ${replace(each.key, "_", " ")} events to the ilo operations topic."
  event_pattern = jsonencode(each.value)
}

resource "aws_cloudwatch_event_target" "operations" {
  for_each = aws_cloudwatch_event_rule.operations

  rule = each.value.name
  arn  = aws_sns_topic.operations.arn

  depends_on = [aws_sns_topic_policy.operations]
}
