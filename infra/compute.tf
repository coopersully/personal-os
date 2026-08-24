resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}-api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "mcp" {
  name              = "/ecs/${local.name}-mcp"
  retention_in_days = 30
}

resource "aws_lb" "public" {
  name                       = "${local.name}-public"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.load_balancer.id]
  subnets                    = aws_subnet.public[*].id
  idle_timeout               = 60
  drop_invalid_header_fields = true
  enable_deletion_protection = true
}

resource "aws_lb_target_group" "api" {
  name                 = "${local.name}-api"
  port                 = 8787
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health/ready"
    timeout             = 5
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "mcp" {
  name                 = "${local.name}-mcp"
  port                 = 8788
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health/live"
    timeout             = 5
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.public.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"not_found\"}"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header { values = [local.api_domain] }
  }
}

resource "aws_lb_listener_rule" "mcp" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.mcp.arn
  }

  condition {
    host_header { values = [local.mcp_domain] }
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  enable_fault_injection   = false
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn
  tags                     = {}

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  lifecycle {
    precondition {
      condition     = !var.plaid_enabled || var.plaid_environment == "production"
      error_message = "Production Plaid credentials require plaid_environment=production."
    }
  }

  container_definitions = jsonencode([{
    name           = "api"
    image          = "${aws_ecr_repository.api.repository_url}:bootstrap"
    essential      = true
    stopTimeout    = 120
    portMappings   = [{ containerPort = 8787, hostPort = 8787, protocol = "tcp" }]
    mountPoints    = []
    systemControls = []
    volumesFrom    = []
    environment = concat(
      [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "8787" },
        { name = "APP_BASE_URL", value = "https://${local.app_domain}" },
        { name = "API_BASE_URL", value = "https://${local.api_domain}" },
        { name = "API_SHUTDOWN_TIMEOUT_MS", value = "105000" },
        { name = "ALLOWED_ORIGINS", value = "https://${local.app_domain}" },
        { name = "EMAIL_FROM", value = var.email_from },
        { name = "GOOGLE_REDIRECT_URI", value = "https://${local.api_domain}/v1/connectors/google/callback" },
        { name = "MCP_RESOURCE_URL", value = "https://${local.mcp_domain}/mcp" },
        { name = "OWNER_EMAILS", value = var.owner_emails },
        { name = "PLAID_ENV", value = var.plaid_environment },
        { name = "REGISTRATION_MODE", value = "invite" },
        { name = "TRUST_PROXY", value = "true" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "X_REDIRECT_URI", value = "https://${local.api_domain}/v1/x-bookmarks/callback" },
      ],
      var.google_gmail_push_enabled ? [
        { name = "GOOGLE_GMAIL_PUSH_ENABLED", value = "true" },
        { name = "GOOGLE_GMAIL_PUBSUB_TOPIC", value = var.google_gmail_pubsub_topic },
        { name = "GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION", value = var.google_gmail_pubsub_subscription },
        { name = "GOOGLE_GMAIL_PUSH_AUDIENCE", value = "https://${local.api_domain}/v1/connectors/google/gmail/notifications" },
        { name = "GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT", value = var.google_gmail_push_service_account },
      ] : [],
      var.google_calendar_push_enabled ? [
        { name = "GOOGLE_CALENDAR_PUSH_ENABLED", value = "true" },
        { name = "GOOGLE_CALENDAR_WEBHOOK_URL", value = "https://${local.api_domain}/v1/connectors/google/calendar/notifications" },
      ] : [],
      var.icloud_mail_idle_enabled ? [
        { name = "ICLOUD_MAIL_IDLE_ENABLED", value = "true" },
        { name = "ICLOUD_MAIL_IDLE_CONCURRENCY", value = tostring(var.icloud_mail_idle_concurrency) },
      ] : [],
    )
    secrets = concat(
      [
        { name = "APP_ENCRYPTION_KEY", valueFrom = local.runtime_parameter_arns.APP_ENCRYPTION_KEY },
        { name = "DATABASE_URL", valueFrom = local.runtime_parameter_arns.DATABASE_URL },
        { name = "GOOGLE_CLIENT_ID", valueFrom = local.runtime_parameter_arns.GOOGLE_CLIENT_ID },
        { name = "GOOGLE_CLIENT_SECRET", valueFrom = local.runtime_parameter_arns.GOOGLE_CLIENT_SECRET },
        { name = "MCP_INTERNAL_SECRET", valueFrom = local.runtime_parameter_arns.MCP_INTERNAL_SECRET },
        { name = "RESEND_API_KEY", valueFrom = local.runtime_parameter_arns.RESEND_API_KEY },
      ],
      var.plaid_enabled ? [
        { name = "PLAID_CLIENT_ID", valueFrom = local.runtime_parameter_arns.PLAID_CLIENT_ID },
        { name = "PLAID_SECRET", valueFrom = local.runtime_parameter_arns.PLAID_SECRET },
      ] : [],
      var.x_enabled ? [
        { name = "X_CLIENT_ID", valueFrom = local.runtime_parameter_arns.X_CLIENT_ID },
        { name = "X_CLIENT_SECRET", valueFrom = local.runtime_parameter_arns.X_CLIENT_SECRET },
      ] : [],
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8787/health/ready').then(r=>{if(!r.ok)process.exit(1)})\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    linuxParameters = {
      capabilities       = { add = [], drop = ["ALL"] }
      initProcessEnabled = true
    }
    readonlyRootFilesystem = true
  }])
}

resource "aws_ecs_task_definition" "mcp" {
  family                   = "${local.name}-mcp"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  enable_fault_injection   = false
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.mcp_task.arn
  tags                     = {}

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name           = "mcp"
    image          = "${aws_ecr_repository.mcp.repository_url}:bootstrap"
    essential      = true
    portMappings   = [{ containerPort = 8788, hostPort = 8788, protocol = "tcp" }]
    mountPoints    = []
    systemControls = []
    volumesFrom    = []
    environment = [
      { name = "APP_BASE_URL", value = "https://${local.app_domain}" },
      { name = "HOST", value = "0.0.0.0" },
      { name = "PORT", value = "8788" },
      { name = "PERSONAL_OS_API_URL", value = "https://${local.api_domain}" },
      { name = "MCP_ALLOWED_ORIGINS", value = "https://${local.app_domain}" },
      { name = "MCP_RATE_LIMIT_MAX_REQUESTS", value = "120" },
      { name = "MCP_RATE_LIMIT_WINDOW_SECONDS", value = "60" },
      { name = "MCP_TRUST_PROXY", value = "true" },
      { name = "MCP_INCLUDE_COMPATIBILITY_TOOLS", value = "false" },
      { name = "MCP_PUBLIC_URL", value = "https://${local.mcp_domain}" },
      { name = "OAUTH_AUTHORIZATION_SERVER_URL", value = "https://${local.api_domain}" },
    ]
    secrets = [
      { name = "MCP_INTERNAL_SECRET", valueFrom = local.runtime_parameter_arns.MCP_INTERNAL_SECRET },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.mcp.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8788/health/live').then(r=>{if(!r.ok)process.exit(1)})\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    linuxParameters = {
      capabilities       = { add = [], drop = ["ALL"] }
      initProcessEnabled = true
    }
    readonlyRootFilesystem = true
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 90

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = true
    security_groups  = [aws_security_group.application.id]
    subnets          = aws_subnet.public[*].id
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8787
  }

  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }

  depends_on = [aws_route_table_association.public]
}

resource "aws_ecs_service" "mcp" {
  name            = "${local.name}-mcp"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.mcp.arn
  desired_count   = var.mcp_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = true
    security_groups  = [aws_security_group.application.id]
    subnets          = aws_subnet.public[*].id
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.mcp.arn
    container_name   = "mcp"
    container_port   = 8788
  }

  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }

  depends_on = [aws_route_table_association.public]
}
