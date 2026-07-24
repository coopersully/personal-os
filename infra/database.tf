resource "aws_db_instance" "postgres" {
  identifier = "${local.name}-postgres"

  allocated_storage           = 20
  max_allocated_storage       = 100
  storage_type                = "gp3"
  storage_encrypted           = true
  engine                      = "postgres"
  engine_version              = "17.5"
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
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-final"

  # Use the RDS-managed master secret only to bootstrap a separate
  # least-privilege application role, then store that role's URL in Parameter
  # Store as DATABASE_URL. The application tasks never read this master secret.
  apply_immediately = false
}
