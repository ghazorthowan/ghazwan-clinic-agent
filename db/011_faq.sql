BEGIN;

CREATE TABLE IF NOT EXISTS clinic_faqs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question    text NOT NULL,         -- canonical question (Arabic or English)
  answer      text NOT NULL,         -- physician-approved answer text
  language    text NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'en')),
  tags        text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Full-text search index (Arabic + English using pg_catalog.simple which is language-neutral)
CREATE INDEX IF NOT EXISTS idx_faqs_fts
  ON clinic_faqs
  USING gin(to_tsvector('simple', question || ' ' || answer))
  WHERE is_active = true;

-- Seed physician-approved administrative FAQs (fictional clinic — CLAUDE.md rule 1)
INSERT INTO clinic_faqs (question, answer, language, tags) VALUES
(
  'ما هي مواعيد عمل العيادة؟',
  'تعمل عيادة د. غزوان العظام في المواعيد التالية: السبت من الساعة 12 ظهراً حتى 5 مساءً، والأحد إلى الأربعاء من الساعة 5 مساءً حتى 8 مساءً. العيادة مغلقة أيام الخميس والجمعة.',
  'ar',
  ARRAY['hours', 'schedule']
),
(
  'What are the clinic opening hours?',
  'Ghazwan Orthopedic Clinic is open Saturday 12:00–17:00, Sunday to Wednesday 17:00–20:00 (Baghdad time). Closed Thursday and Friday.',
  'en',
  ARRAY['hours', 'schedule']
),
(
  'كيف أحجز موعداً؟',
  'يمكنك حجز موعد عبر إرسال رسالة واتساب إلى هذا الرقم. سيقوم المساعد الآلي بالتحقق من التواريخ المتاحة وإتمام الحجز بعد تأكيدك الصريح.',
  'ar',
  ARRAY['booking', 'appointment']
),
(
  'How do I book an appointment?',
  'Send a WhatsApp message to this number. The automated assistant will check available dates and complete the booking after your explicit confirmation.',
  'en',
  ARRAY['booking', 'appointment']
),
(
  'كيف يمكنني إلغاء موعدي؟',
  'أرسل رسالة واتساب إلى هذا الرقم وأخبر المساعد الآلي أنك تريد إلغاء موعدك. يرجى ذكر رمز الحجز إن أمكن.',
  'ar',
  ARRAY['cancellation', 'booking']
),
(
  'How do I cancel my appointment?',
  'Send a WhatsApp message to this number and tell the automated assistant you wish to cancel. Please mention your booking code if available.',
  'en',
  ARRAY['cancellation', 'booking']
),
(
  'هل العيادة تقبل مراجعين جدد؟',
  'نعم، العيادة تقبل مراجعين جدد. الحجز متاح للجميع حسب توفر المواعيد.',
  'ar',
  ARRAY['new_patients']
),
(
  'هل يوجد رسوم حجز؟',
  'لا توجد رسوم لحجز الموعد. الدفع يتم في العيادة عند زيارتك.',
  'ar',
  ARRAY['fees', 'payment']
),
(
  'Are there any booking fees?',
  'There are no booking fees. Payment is made at the clinic during your visit.',
  'en',
  ARRAY['fees', 'payment']
),
(
  'أين تقع العيادة؟',
  'للاستفسار عن عنوان العيادة أو الاتجاهات، يرجى التواصل مع أحد موظفي العيادة مباشرة.',
  'ar',
  ARRAY['location', 'directions']
),
(
  'What speciality does the clinic offer?',
  'Ghazwan Clinic is an orthopedic clinic. For specific medical questions, please consult the clinic staff directly.',
  'en',
  ARRAY['speciality', 'services']
)
ON CONFLICT DO NOTHING;

COMMIT;
