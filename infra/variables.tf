variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "eu-north-1"
}

variable "project_name" {
  description = "Prefix for every resource name"
  type        = string
  default     = "mailstream"
}

variable "sender_email" {
  description = "Address emails are sent from. SES emails it a verification link."
  type        = string
}

variable "test_recipients" {
  description = "Recipient addresses to verify in SES (needed while the account is in the SES sandbox)"
  type        = list(string)
  default     = []
}

variable "alert_email" {
  description = "Address that receives CloudWatch alarm notifications through SNS"
  type        = string
}

variable "max_recipients_per_campaign" {
  description = "Upper limit on rows processed from one CSV"
  type        = number
  default     = 500
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps Lambda logs"
  type        = number
  default     = 14
}
