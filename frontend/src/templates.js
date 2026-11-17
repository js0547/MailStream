const wrap = (accent, inner) => `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="height:6px;background:${accent};"></td></tr>
      <tr><td style="padding:32px;">
${inner}
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f9fafb;font-size:12px;color:#6b7280;">
        Sent with MailStream, a serverless email system on AWS.
      </td></tr>
    </table>
  </body>
</html>`;

export const STARTER_TEMPLATES = [
  {
    id: "welcome",
    label: "Welcome email",
    subject: "Welcome aboard, {{name}}!",
    html: wrap("#4f46e5", `        <h1 style="margin:0 0 16px;font-size:22px;">Welcome, {{name}}!</h1>
        <p style="line-height:1.6;">Thanks for joining us. Your account is ready and you can start exploring right away.</p>
        <p style="line-height:1.6;">If you have any questions, just reply to this email.</p>
        <p style="line-height:1.6;margin-top:24px;">Cheers,<br>The MailStream team</p>`),
  },
  {
    id: "event",
    label: "Event invitation",
    subject: "You're invited: Tech Talk on Serverless",
    html: wrap("#0d9488", `        <h1 style="margin:0 0 16px;font-size:22px;">Hi {{name}}, you're invited!</h1>
        <p style="line-height:1.6;">Join us for a Tech Talk on building serverless applications with AWS Lambda, S3 and SES.</p>
        <p style="line-height:1.6;"><strong>Date:</strong> Friday, 10:00 AM<br><strong>Venue:</strong> Seminar Hall</p>
        <p style="line-height:1.6;margin-top:24px;">See you there!</p>`),
  },
  {
    id: "result",
    label: "Application status",
    subject: "Update on your application, {{name}}",
    html: wrap("#d97706", `        <h1 style="margin:0 0 16px;font-size:22px;">Dear {{name}},</h1>
        <p style="line-height:1.6;">Thank you for your application. Your current status is: <strong>{{status}}</strong>.</p>
        <p style="line-height:1.6;">We will contact you with the next steps soon.</p>
        <p style="line-height:1.6;margin-top:24px;">Regards,<br>Admissions Office</p>`),
  },
];

export const SAMPLE_CSV = "email,name,status\nfriend@example.com,Alex,Shortlisted\n";
