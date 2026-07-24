variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for encrypted Terraform state."
  type        = string
}

variable "lock_table_name" {
  description = "DynamoDB table name used to serialize Terraform changes."
  type        = string
  default     = "personal-os-terraform-lock"
}
