resource "aws_db_instance" "postgres" {
  identifier = "${local.name}-postgres"

  allocated_storage           = 20
  max_allocated_storage       = 100
  storage_type                = "gp3"
  storage_encrypted           = true
  engine                      = "postgres"
  engine_version              = "17.9"
  instance_class              = var.database_instance_class
  db_name                     = "personal_os"
  username                    = "personal_os"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = var.database_multi_az

  backup_retention_period    = 7
  backup_window              = "07:00-07:30"
  maintenance_window         = "sun:08:00-sun:08:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-final"
  enabled_cloudwatch_logs_exports = [
    "postgresql",
    "upgrade",
  ]

  # Use the RDS-managed master secret only to bootstrap a separate
  # least-privilege application role, then store that role's URL in Parameter
  # Store as DATABASE_URL. The application tasks never read this master secret.
  apply_immediately = false

  depends_on = [
    aws_cloudwatch_log_group.postgresql,
    aws_cloudwatch_log_group.postgresql_upgrade,
  ]
}

resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${local.name}-postgres/postgresql"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "postgresql_upgrade" {
  name              = "/aws/rds/instance/${local.name}-postgres/upgrade"
  retention_in_days = 30
}
