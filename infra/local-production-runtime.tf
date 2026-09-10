variable "local_production_runtime_principal_arn" {
  description = "IAM principal allowed to assume the scoped local production runtime role. Defaults to this AWS account; set an exact named non-root principal in production tfvars."
  type        = string
  default     = null

  validation {
    condition = (
      var.local_production_runtime_principal_arn == null ||
      can(regex("^arn:aws:iam::[0-9]{12}:(root|user/.+|role/.+)$", var.local_production_runtime_principal_arn))
    )
    error_message = "local_production_runtime_principal_arn must be a permanent IAM root, user, or role ARN."
  }
}

locals {
  local_production_runtime_principal_arn = coalesce(
    var.local_production_runtime_principal_arn,
    "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root",
  )
}

data "aws_ssm_parameter" "amazon_linux_2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "local_production_tunnel" {
  name               = "${local.name}-local-db-tunnel"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role_policy_attachment" "local_production_tunnel_ssm" {
  role       = aws_iam_role.local_production_tunnel.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "local_production_tunnel" {
  name = "${local.name}-local-db-tunnel"
  role = aws_iam_role.local_production_tunnel.name
}

resource "aws_security_group" "local_production_tunnel" {
  name_prefix = "${local.name}-local-db-tunnel-"
  description = "No-ingress SSM tunnel for explicitly acknowledged local production runtime sessions"
  vpc_id      = aws_vpc.main.id

  lifecycle {
    create_before_destroy = true
  }

  egress {
    description = "PostgreSQL to the private production database subnets"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = aws_subnet.database[*].cidr_block
  }

  egress {
    description = "AWS Systems Manager control and data channels"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "VPC DNS over UDP"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  egress {
    description = "VPC DNS over TCP"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
}

resource "aws_instance" "local_production_tunnel" {
  ami                         = data.aws_ssm_parameter.amazon_linux_2023_arm64.value
  instance_type               = "t4g.nano"
  subnet_id                   = aws_subnet.public[0].id
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.local_production_tunnel.name
  vpc_security_group_ids      = [aws_security_group.local_production_tunnel.id]
  key_name                    = null
  disable_api_termination     = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    encrypted   = true
    volume_size = 8
    volume_type = "gp3"
  }

  tags = merge(local.common_tags, {
    Name                   = "${local.name}-local-db-tunnel"
    LocalProductionRuntime = "true"
  })

  depends_on = [aws_iam_role_policy_attachment.local_production_tunnel_ssm]
}

data "aws_iam_policy_document" "local_production_runtime_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = [local.local_production_runtime_principal_arn]
    }
  }
}

resource "aws_iam_role" "local_production_runtime" {
  name                 = "${local.name}-local-production-runtime"
  assume_role_policy   = data.aws_iam_policy_document.local_production_runtime_assume_role.json
  max_session_duration = 14400
}

data "aws_iam_policy_document" "local_production_runtime" {
  statement {
    sid = "InspectExactProductionRuntime"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "rds:DescribeDBInstances",
      "ssm:DescribeInstanceInformation",
      "ssm:DescribeSessions",
    ]
    resources = ["*"]
  }

  statement {
    sid = "StartAndStopOnlyLocalProductionTunnel"
    actions = [
      "ec2:StartInstances",
      "ec2:StopInstances",
    ]
    resources = [aws_instance.local_production_tunnel.arn]
  }

  statement {
    sid     = "StartOnlyTunnelPortForwardingSessions"
    actions = ["ssm:StartSession"]
    resources = [
      aws_instance.local_production_tunnel.arn,
      "arn:aws:ssm:${var.aws_region}::document/AWS-StartPortForwardingSessionToRemoteHost",
    ]
  }

  statement {
    sid = "ManageOwnedTunnelSessions"
    actions = [
      "ssm:ResumeSession",
      "ssm:TerminateSession",
    ]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:session/ilo-local-*"]
  }

  statement {
    sid       = "ReadExactProductionRuntimeParameters"
    actions   = ["ssm:GetParameters"]
    resources = values(local.runtime_parameter_arns)
  }

  statement {
    sid       = "DecryptProductionRuntimeParametersThroughSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "local_production_runtime" {
  name   = "${local.name}-local-production-runtime"
  role   = aws_iam_role.local_production_runtime.id
  policy = data.aws_iam_policy_document.local_production_runtime.json
}
