/**
 * Canonical E.164 phone normalization (e.g. "+919932338847").
 *
 * Single source of truth for phones that BOARD-APP writes to `candidates`.
 * Admin / WhatsApp / Bolna use the same canonical form, so a phone parsed from
 * any resume or job-site source always matches the admin inbound lookup and
 * always dials correctly.
 *
 * Rules (India-only market):
 *  - strip all non-digits
 *  - drop leading national "0"
 *  - 10 digits          -> +91XXXXXXXXXX
 *  - 12 digits, 91..    -> +91XXXXXXXXXX
 *  - anything else      -> null (reject so we never store garbage)
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  let cleaned = raw.replace(/\D/g, "")
  if (!cleaned) return null
  while (cleaned.startsWith("0")) cleaned = cleaned.slice(1)
  if (cleaned.length === 10) return `+91${cleaned}`
  if (cleaned.length === 12 && cleaned.startsWith("91")) return `+${cleaned}`
  return null
}