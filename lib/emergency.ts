/**
 * Rule-based emergency keyword guard.
 *
 * Runs BEFORE the AI on every inbound message.
 * When an emergency keyword is detected the conversation is immediately
 * escalated to a human with a fixed, clinician-approved response —
 * the AI is never invoked for these messages.
 *
 * CLAUDE.md rule 6: validated allow-listed commands only.
 * Wording approved for use; never includes clinical advice.
 */

// ---------------------------------------------------------------------------
// Keyword lists (Arabic + English; cover common Iraqi dialect variants)
// ---------------------------------------------------------------------------

const EMERGENCY_PATTERNS: RegExp[] = [
  // Arabic urgent/emergency terms
  /طوارئ/,          // emergency
  /إسعاف/,          // ambulance
  /إسعافات أولية/,  // first aid
  /خطر/,            // danger
  /حادث/,           // accident
  /ألم شديد/,       // severe pain
  /ألم حاد/,        // acute pain
  /كسر/,            // fracture (may need urgent care)
  /سقطت/,           // I fell
  /سقط/,            // he/she fell
  /لا أستطيع الحركة/, // cannot move
  /ما أقدر أتحرك/, // Iraqi dialect: cannot move
  /مو قادر أتحرك/,

  // English urgent/emergency terms
  /\bemergency\b/i,
  /\burgent\b/i,
  /\bambulance\b/i,
  /\bsevere pain\b/i,
  /\bacute pain\b/i,
  /\bfracture\b/i,
  /\bI fell\b/i,
  /\bcannot move\b/i,
  /\bcan't move\b/i,
];

export interface EmergencyCheckResult {
  isEmergency: boolean;
  /** Fixed clinician-approved reply to send when isEmergency is true */
  fixedReply: string;
}

const EMERGENCY_REPLY =
  'يبدو أن حالتك تستدعي اهتماماً فورياً. ' +
  'يرجى التوجه إلى أقرب طوارئ أو الاتصال بالإسعاف. ' +
  'سيتواصل معك أحد موظفي العيادة في أقرب وقت ممكن.\n\n' +
  'This appears to need immediate attention. ' +
  'Please go to the nearest emergency room or call an ambulance. ' +
  'A clinic staff member will contact you as soon as possible.';

/**
 * Check a patient message for emergency keywords.
 * Returns `{ isEmergency: true, fixedReply }` when matched.
 * Pure function — no side effects (escalation is handled by the caller).
 */
export function checkEmergency(message: string): EmergencyCheckResult {
  const isEmergency = EMERGENCY_PATTERNS.some(p => p.test(message));
  return { isEmergency, fixedReply: EMERGENCY_REPLY };
}
