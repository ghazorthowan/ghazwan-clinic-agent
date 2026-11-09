import { NextResponse } from 'next/server';
import { loggedIn } from '@/lib/auth';
import { messageInput } from '@/lib/schema';
import { pool } from '@/lib/db';
import { replyIntent, requestReply, confirmationReply } from '@/lib/policy';
import { createBooking, transitionBooking, BookingError } from '@/lib/booking';

export async function POST(req: Request) {
  if (!await loggedIn()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = messageInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid simulator input' }, { status: 400 });
  const i = parsed.data;
  let reply = '';
  const intent = replyIntent(i.body);
  if (intent === 'EMERGENCY') {
    reply = i.locale === 'ar'
      ? 'قد تكون هذه الأعراض طارئة. يرجى مراجعة أقرب قسم طوارئ فوراً وعدم انتظار الرد عبر المحادثة.'
      : 'These symptoms may be an emergency. Seek assessment at the nearest emergency department immediately.';
  } else if (intent === 'HUMAN') {
    reply = i.locale === 'ar' ? 'سأحوّل الاستفسار إلى السكرتارية. (نموذج تجريبي)' : 'I will refer this to reception. (Simulation)';
  } else if (intent === 'CONFIRM' || intent === 'CANCEL') {
    const b = await pool.query(
      `SELECT b.id, b.booking_code FROM bookings b JOIN contacts c ON b.contact_id = c.id
       WHERE c.external_contact_ref = $1 AND c.source_channel = 'SIMULATED_WHATSAPP'
       AND b.status IN ('AWAITING_PATIENT','CONFIRMED') ORDER BY b.created_at DESC LIMIT 1`,
      [i.contactRef]
    );
    if (!b.rows[0]) {
      reply = i.locale === 'ar' ? 'لا يوجد طلب فعّال للتأكيد أو الإلغاء.' : 'No active request found.';
    } else {
      try {
        await transitionBooking(b.rows[0].id, intent);
        reply = intent === 'CONFIRM'
          ? confirmationReply(i.locale, b.rows[0].booking_code)
          : i.locale === 'ar' ? 'تم إلغاء طلب المراجعة.' : 'Your request was cancelled.';
      } catch (e) { reply = `Unable to update: ${(e as Error).message}`; }
    }
  } else if (i.clinicDate && /^(book|احجز|حجز|register)$/i.test(i.body.trim())) {
    try {
      const b = await createBooking({ displayName: i.name, sourceChannel: 'SIMULATED_WHATSAPP', externalContactRef: i.contactRef, clinicDate: i.clinicDate, locale: i.locale });
      reply = requestReply(i.locale, b.booking_code, i.clinicDate, b.hours);
    } catch (e) { reply = e instanceof BookingError ? e.message : 'Booking could not be created.'; }
  } else {
    reply = i.locale === 'ar'
      ? 'أكدر أساعدكم بتسجيل طلب مراجعة. اختاروا اليوم واكتبوا «حجز»، أو اطلبوا السكرتارية.'
      : 'Choose a clinic day and type BOOK, or ask for reception.';
  }
  return NextResponse.json({ reply });
}
