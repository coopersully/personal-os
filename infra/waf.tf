resource "aws_wafv2_regex_pattern_set" "connector_webhooks" {
  count = var.enable_waf && (var.google_gmail_push_enabled || var.google_calendar_push_enabled) ? 1 : 0

  name  = "${local.name}-connector-webhooks"
  scope = "REGIONAL"

  regular_expression {
    regex_string = "^/v1/connectors/google/gmail/notifications$"
  }

  regular_expression {
    regex_string = "^/v1/connectors/google/calendar/notifications$"
  }
}

resource "aws_wafv2_web_acl" "public" {
  count = var.enable_waf ? 1 : 0

  name  = "${local.name}-public"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = var.google_gmail_push_enabled || var.google_calendar_push_enabled ? [true] : []

    content {
      name     = "connector-webhook-rate-limit"
      priority = 1

      action {
        block {}
      }

      statement {
        rate_based_statement {
          limit              = var.connector_webhook_rate_limit
          aggregate_key_type = "IP"

          scope_down_statement {
            regex_pattern_set_reference_statement {
              arn = aws_wafv2_regex_pattern_set.connector_webhooks[0].arn

              field_to_match {
                uri_path {}
              }

              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${local.name}-connector-webhook-rate-limit"
        sampled_requests_enabled   = false
      }
    }
  }

  rule {
    name     = "rate-limit"
    priority = 2

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.edge_rate_limit
        aggregate_key_type = "IP"

        dynamic "scope_down_statement" {
          for_each = var.google_gmail_push_enabled || var.google_calendar_push_enabled ? [true] : []

          content {
            not_statement {
              statement {
                regex_pattern_set_reference_statement {
                  arn = aws_wafv2_regex_pattern_set.connector_webhooks[0].arn

                  field_to_match {
                    uri_path {}
                  }

                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-managed-known-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-managed-ip-reputation"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"

        scope_down_statement {
          not_statement {
            statement {
              or_statement {
                statement {
                  byte_match_statement {
                    search_string         = "/health/ready"
                    positional_constraint = "EXACTLY"

                    field_to_match {
                      uri_path {}
                    }

                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }

                statement {
                  byte_match_statement {
                    search_string         = "/health/live"
                    positional_constraint = "EXACTLY"

                    field_to_match {
                      uri_path {}
                    }

                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-web-acl"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "public" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_lb.public.arn
  web_acl_arn  = aws_wafv2_web_acl.public[0].arn
}
