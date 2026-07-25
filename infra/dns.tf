resource "aws_acm_certificate" "public" {
  domain_name               = local.app_domain
  subject_alternative_names = [local.api_domain, local.mcp_domain]
  validation_method         = "DNS"

  lifecycle { create_before_destroy = true }
}

resource "cloudflare_dns_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.public.domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  }

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(each.value.name, ".")
  type    = each.value.type
  ttl     = 60
  content = trimsuffix(each.value.record, ".")
  proxied = false
  comment = "Personal OS ACM certificate validation"
}

resource "aws_acm_certificate_validation" "public" {
  certificate_arn         = aws_acm_certificate.public.arn
  validation_record_fqdns = [for record in cloudflare_dns_record.certificate_validation : record.name]
}

resource "cloudflare_dns_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = local.app_domain
  type    = "CNAME"
  ttl     = 60
  content = aws_cloudfront_distribution.web.domain_name
  proxied = false
  comment = "Personal OS web application"
}

resource "cloudflare_dns_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = local.api_domain
  type    = "CNAME"
  ttl     = 60
  content = aws_lb.public.dns_name
  proxied = false
  comment = "Personal OS API"
}

resource "cloudflare_dns_record" "mcp" {
  zone_id = var.cloudflare_zone_id
  name    = local.mcp_domain
  type    = "CNAME"
  ttl     = 60
  content = aws_lb.public.dns_name
  proxied = false
  comment = "Personal OS public MCP endpoint"
}

resource "cloudflare_dns_record" "resend_dkim" {
  zone_id = var.cloudflare_zone_id
  name    = "resend._domainkey.${var.domain_name}"
  type    = "TXT"
  ttl     = 60
  content = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCjiNARvV1GhQbii3Q9Di0qy3281QdYjVLgXhkN8vWUrmDFaELZXUsv1Aq1pdDdw+oaiq7vUsZSt+RP0hBWRn0VVdZRh1ITmCJU7fMwdcopwxW16+vezy31KGSyFsbDAdTepkVh8xyg/dskYkt4jLZJpeLAB4xSANE8tz98+mTzGwIDAQAB"
  proxied = false
  comment = "Resend DKIM verification"
}

resource "cloudflare_dns_record" "resend_spf_mx" {
  zone_id  = var.cloudflare_zone_id
  name     = "send.${var.domain_name}"
  type     = "MX"
  ttl      = 60
  content  = "feedback-smtp.us-east-1.amazonses.com"
  priority = 10
  proxied  = false
  comment  = "Resend SPF return path"
}

resource "cloudflare_dns_record" "resend_spf_txt" {
  zone_id = var.cloudflare_zone_id
  name    = "send.${var.domain_name}"
  type    = "TXT"
  ttl     = 60
  content = "v=spf1 include:amazonses.com ~all"
  proxied = false
  comment = "Resend SPF policy"
}

resource "cloudflare_dns_record" "dmarc" {
  zone_id = var.cloudflare_zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 60
  content = "v=DMARC1; p=none;"
  proxied = false
  comment = "Personal OS DMARC policy"
}
