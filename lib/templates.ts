/**
 * Approved WhatsApp utility template catalog.
 *
 * CLAUDE.md rule 2: Templates must be submitted to and approved by Meta
 * before use. The names and language codes here are placeholders; replace
 * them with the values from your Meta Business Manager once approved.
 *
 * Utility templates (category: UTILITY) can be sent outside the 24-hour
 * messaging window. Marketing templates require separate opt-in handling
 * which is out of scope until M5.
 */

export interface TemplateComponent {
  type: 'body' | 'header' | 'footer' | 'button';
  parameters?: Array<{ type: 'text'; text: string }>;
  sub_type?: string;
  index?: number;
}

export interface TemplateMessage {
  templateName: string;
  languageCode: string;
  components: TemplateComponent[];
}

/** Re-engagement: sent when a patient contacts us and the 24h window has expired. */
export function reEngagementTemplate(patientName: string): TemplateMessage {
  return {
    templateName: process.env.WA_TEMPLATE_REENGAGEMENT ?? 'clinic_reengagement',
    languageCode: 'ar',
    components: [
      {
        type: 'body',
        parameters: [{ type: 'text', text: patientName }],
      },
    ],
  };
}

/** Appointment confirmation: sent after a booking is created via AI. */
export function bookingConfirmationTemplate(
  patientName: string,
  clinicDate: string,
  bookingCode: string,
): TemplateMessage {
  return {
    templateName: process.env.WA_TEMPLATE_BOOKING_CONFIRM ?? 'clinic_booking_confirmation',
    languageCode: 'ar',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: patientName },
          { type: 'text', text: clinicDate },
          { type: 'text', text: bookingCode },
        ],
      },
    ],
  };
}

/** Appointment reminder: sent ~24h before clinic day. */
export function appointmentReminderTemplate(
  patientName: string,
  clinicDate: string,
): TemplateMessage {
  return {
    templateName: process.env.WA_TEMPLATE_REMINDER ?? 'clinic_appointment_reminder',
    languageCode: 'ar',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: patientName },
          { type: 'text', text: clinicDate },
        ],
      },
    ],
  };
}
