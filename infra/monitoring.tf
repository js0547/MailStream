# CloudWatch alarms -> SNS topic -> email. Confirm the subscription email
# that AWS sends after the first deploy.

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = {
    sender = aws_lambda_function.sender.function_name
    api    = aws_lambda_function.api.function_name
  }

  alarm_name          = "${each.value}-errors"
  alarm_description   = "The ${each.key} Lambda raised an error. Check its CloudWatch logs."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Delivery failures (bounces, unverified sandbox recipients) are logged by the
# sender as "FAILED <email>". Turn those lines into a metric and alarm on it.
resource "aws_cloudwatch_log_metric_filter" "send_failures" {
  name           = "${local.name}-send-failures"
  log_group_name = aws_cloudwatch_log_group.sender.name
  pattern        = "FAILED"

  metric_transformation {
    name          = "SendFailures"
    namespace     = "MailStream"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "send_failures" {
  alarm_name          = "${local.name}-send-failures"
  alarm_description   = "One or more emails failed to send. Open the campaign in the dashboard for details."
  namespace           = "MailStream"
  metric_name         = "SendFailures"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
