# SES email identities. Creating one makes SES send a verification link to
# that address. In the SES sandbox both the sender and every recipient must be
# verified before mail can be delivered.

resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.sender_email
}

resource "aws_sesv2_email_identity" "recipients" {
  for_each       = toset([for r in var.test_recipients : lower(r) if lower(r) != lower(var.sender_email)])
  email_identity = each.value
}
