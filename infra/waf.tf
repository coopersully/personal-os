resource "aws_wafv2_web_acl" "public" {
  count = var.enable_waf ? 1 : 0

  name  = "${local.name}-public"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.edge_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-limit"
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
