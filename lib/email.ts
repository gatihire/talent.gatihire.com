import postmark from 'postmark'
import { logger } from './logger'

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN!)

export async function sendEmail(to: string, subject: string, htmlBody: string) {
  try {
    await client.sendEmail({
      From: 'noreply@yourdomain.com',
      To: to,
      Subject: subject,
      HtmlBody: htmlBody,
    })
    logger.info({ to, subject }, 'email sent')
  } catch (err) {
    logger.error({ err, to }, 'email failed')
    // no throw – degraded OK
  }
}