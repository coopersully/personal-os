terraform {
  required_version = ">= 1.10.0"

  # Initialize with infra/backend.hcl.example copied to a private
  # backend.hcl file. The state bucket is provisioned by infra/bootstrap.
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}
