import {randomUUID} from 'node:crypto';
import {pool,transaction} from './db';
import {clinicHours,isPastClinicDate,normalizePhone} from './policy';
import type {z} from 'zod';
import {bookingInput} from './schema';
export class BookingError extends Error { constructor(public code:string,message:string){super(message);} }
type Input=z.infer<typeof bookingInput>;
export async function createBooking(input:Input) {
 const hours=clinicHours(input.clinicDate);
 if(!hours)throw new BookingError('CLOSED_DAY','Clinic is not open on this weekday');
 if(isPastClinicDate(input.clinicDate))throw new BookingError('PAST_DAY','Cannot register a past clinic day');
 if(input.phone && !normalizePhone(input.phone))throw new BookingError('PHONE_FORMAT','Phone must be E.164, for example +964...');
 return transaction(async c=>{
  const closure=await c.query('SELECT 1 FROM clinic_closures WHERE closure_date=$1 AND deleted_at IS NULL',[input.clinicDate]);
  if(closure.rowCount)throw new BookingError('CLOSED_DAY','Clinic closed on selected date');
  const contact=await c.query<{id:string}>(`INSERT INTO contacts(display_name,phone,source_channel,external_contact_ref)
 VALUES($1,$2,$3,$4) ON CONFLICT (source_channel,external_contact_ref) DO UPDATE SET display_name=EXCLUDED.display_name,phone=COALESCE(EXCLUDED.phone,contacts.phone) RETURNING id`,[input.displayName,normalizePhone(input.phone),input.sourceChannel,input.externalContactRef]);
  const id=contact.rows[0].id;
  // Transaction-level advisory lock serializes duplicate booking attempts for same contact/date.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${id}/${input.clinicDate}`]);
  const existing=await c.query(`SELECT id,booking_code,status FROM bookings WHERE contact_id=$1 AND clinic_date=$2 AND status IN ('AWAITING_PATIENT','CONFIRMED','NEEDS_STAFF') LIMIT 1`,[id,input.clinicDate]);
  if(existing.rows[0])return { ...existing.rows[0], existing:true, hours};
  const bid=randomUUID(); const code=`GH-${input.clinicDate.replaceAll('-','')}-${bid.slice(0,8).toUpperCase()}`;
  const booking=await c.query(`INSERT INTO bookings(id,booking_code,contact_id,clinic_date) VALUES($1,$2,$3,$4) RETURNING id,booking_code,status`,[bid,code,id,input.clinicDate]);
  await c.query(`INSERT INTO booking_events(booking_id,event_key,event_type,actor) VALUES($1,$2,'CREATED','SYSTEM')`,[bid,`create:${bid}`]);
  await c.query('INSERT INTO sync_outbox(booking_id,revision) VALUES($1,1)',[bid]);
  return {...booking.rows[0], existing:false,hours};
 });
}
export async function transitionBooking(
  bookingId: string,
  type: 'CONFIRM'|'CANCEL'|'ARRIVE',
  idempotencyKey?: string
) {
 // If the caller supplies a key we use it verbatim; a duplicate insert will violate the
 // unique constraint on booking_events.event_key (PG error 23505), which we catch to
 // return the current booking state rather than failing — safe replay for retried webhooks.
 const eventKey = idempotencyKey ?? `${type.toLowerCase()}:${bookingId}:${randomUUID()}`;
 try {
  return await transaction(async c=>{
   const result=await c.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[bookingId]);
   if(!result.rows[0])throw new BookingError('NOT_FOUND','Booking not found');
   const b=result.rows[0];
   if(type==='CONFIRM'&&b.status==='CONFIRMED')return { ...b,unchanged:true};
   if(type==='CONFIRM'&&b.status!=='AWAITING_PATIENT')throw new BookingError('INVALID_STATE','Only pending bookings can be confirmed');
   if(type==='CANCEL'&&b.status==='CANCELLED')return { ...b,unchanged:true};
   if(type==='CANCEL'&&!['AWAITING_PATIENT','CONFIRMED','NEEDS_STAFF'].includes(b.status))throw new BookingError('INVALID_STATE','Booking cannot be cancelled');
   if(type==='ARRIVE'&&(b.status!=='CONFIRMED' || b.attendance_status!=='EXPECTED'))throw new BookingError('INVALID_STATE','Only a confirmed expected booking can be checked in');
   let updated;
   if(type==='ARRIVE') {
     // Lock the clinic date to serialize sequence allocation for arrival order.
     await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`arrival:${new Date(b.clinic_date).toISOString().slice(0,10)}`]);
     updated=await c.query(`UPDATE bookings SET attendance_status='ARRIVED',arrived_at=now(),arrival_sequence=(SELECT COALESCE(MAX(arrival_sequence),0)+1 FROM bookings WHERE clinic_date=$2),updated_at=now() WHERE id=$1 RETURNING *`,[bookingId,b.clinic_date]);
   } else {
     updated=await c.query(`UPDATE bookings SET status=$2,confirmed_at=CASE WHEN $2='CONFIRMED' THEN now() ELSE confirmed_at END,updated_at=now() WHERE id=$1 RETURNING *`,[bookingId,type==='CONFIRM'?'CONFIRMED':'CANCELLED']);
   }
   await c.query('INSERT INTO booking_events(booking_id,event_key,event_type,actor) VALUES($1,$2,$3,$4)',[bookingId,eventKey,type,'STAFF_OR_SIMULATOR']);
   const revision=await c.query('SELECT COALESCE(MAX(revision),0)+1 AS r FROM sync_outbox WHERE booking_id=$1',[bookingId]);
   await c.query('INSERT INTO sync_outbox(booking_id,revision) VALUES($1,$2)',[bookingId,revision.rows[0].r]);
   return updated.rows[0];
  });
 } catch(e: unknown) {
  // Duplicate idempotency key — transition already applied; return current booking state.
  if (idempotencyKey && (e as {code?:string}).code === '23505') {
   const r = await pool.query('SELECT * FROM bookings WHERE id=$1',[bookingId]);
   return { ...r.rows[0], idempotent: true };
  }
  throw e;
 }
}
export async function listBookings() {
 const result=await pool.query(`SELECT b.id,b.booking_code,b.clinic_date::text AS clinic_date,b.status,b.attendance_status,b.arrival_sequence,b.created_at,b.updated_at,c.display_name,c.phone,c.source_channel FROM bookings b JOIN contacts c ON c.id=b.contact_id ORDER BY b.clinic_date DESC,b.created_at DESC LIMIT 200`);
 return result.rows;
}
