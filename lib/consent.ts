/**
 * Patient consent management.
 *
 * CLAUDE.md rule 1: Patients must receive privacy disclosure before any data
 * is processed or stored for clinical purposes.
 * CLAUDE.md rule 4: Explicit verbal confirmation required — read receipts
 * and passive behaviour do not count as consent.
 */

import { pool } from './db';

// ---------------------------------------------------------------------------
// Bilingual privacy notice + consent request
// (Wording reviewed for Iraqi Arabic — replace with clinician-approved text
//  before production under CLAUDE.md rule 8.)
// ---------------------------------------------------------------------------

export const PRIVACY_NOTICE = `مرحباً بك في عيادة د. غزوان للعظام 🏥

للاستمرار، نحتاج موافقتك على سياسة الخصوصية:

📋 ما نجمعه: اسمك، رقم هاتفك، وتاريخ موعدك.
🎯 الغرض: إدارة حجوزات العيادة فقط.
🔒 الحفظ: بياناتك محفوظة بأمان ولا تُشارك مع جهات خارجية.
🗑️ الحذف: يمكنك طلب حذف بياناتك في أي وقت بإرسال "احذف بياناتي".
📅 مدة الاحتفاظ: تُحذف البيانات تلقائياً بعد 24 شهراً من آخر تعامل.

للموافقة وإتمام الحجز، يرجى الرد بـ: نعم أو أوافق

---

Welcome to Dr. Ghazwan Orthopedic Clinic 🏥

To continue, please consent to our privacy policy:

📋 What we collect: Your name, phone number, and appointment date.
🎯 Purpose: Clinic appointment management only.
🔒 Storage: Your data is stored securely and never shared with third parties.
🗑️ Deletion: You can request deletion at any time by sending "delete my data".
📅 Retention: Data is automatically deleted 24 months after your last interaction.

To consent and continue, please reply: yes or I agree`;

// ---------------------------------------------------------------------------
// Consent acknowledgment detection
// ---------------------------------------------------------------------------

const CONSENT_PATTERNS: RegExp[] = [
  /^نعم$/i,
  /^أوافق/i,
  /^موافق/i,
  /^اوافق/i,
  /^موافقة/i,
  /^yes$/i,
  /^i agree/i,
  /^agree$/i,
  /^ok$/i,
  /^okay$/i,
];

export function isConsentAcknowledgment(message: string): boolean {
  const trimmed = message.trim();
  return CONSENT_PATTERNS.some(p => p.test(trimmed));
}

// ---------------------------------------------------------------------------
// Right-to-forget detection
// ---------------------------------------------------------------------------

const DELETION_PATTERNS: RegExp[] = [
  /احذف بياناتي/i,
  /حذف بياناتي/i,
  /delete my data/i,
  /erase my data/i,
  /remove my data/i,
  /forget me/i,
];

export function isDeletionRequest(message: string): boolean {
  return DELETION_PATTERNS.some(p => p.test(message));
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

/** Returns true when the contact has an active (non-erased) consent record. */
export async function hasConsent(contactId: string): Promise<boolean> {
  const r = await pool.query<{ consent_given_at: Date | null }>(
    `SELECT consent_given_at FROM contacts
     WHERE id = $1 AND data_deleted_at IS NULL`,
    [contactId],
  );
  return r.rows[0]?.consent_given_at != null;
}

/** Record explicit consent from a patient. */
export async function recordConsent(
  contactId: string,
  channel: string,
): Promise<void> {
  await pool.query(
    `UPDATE contacts
     SET consent_given_at = now(), consent_ip = $2
     WHERE id = $1 AND data_deleted_at IS NULL`,
    [contactId, channel],
  );
}

/**
 * Soft-erase a contact's personal data (right to forget / GDPR-style).
 *
 * Blanks PII fields and sets data_deleted_at. Preserves the row for
 * referential integrity (bookings, messages still reference it).
 *
 * CLAUDE.md rule 8: requires explicit patient request — called only after
 * the patient sends a deletion request message.
 */
export async function eraseContactData(contactId: string): Promise<void> {
  await pool.query(
    `UPDATE contacts
     SET display_name = '[deleted]',
         phone        = NULL,
         consent_given_at  = NULL,
         consent_ip        = NULL,
         data_deleted_at   = now()
     WHERE id = $1 AND data_deleted_at IS NULL`,
    [contactId],
  );
}

export const ERASURE_CONFIRMATION =
  'تم حذف بياناتك الشخصية من سجلاتنا. شكراً لاستخدامك خدماتنا.\n\n' +
  'Your personal data has been erased from our records. Thank you for using our services.';
