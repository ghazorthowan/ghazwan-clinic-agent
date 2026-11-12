import { google } from 'googleapis';
import { Pool } from 'pg';
import { pool } from './db';
import { audit } from './audit';

const HEADERS = ['Booking_ID','Created_At','Patient_Name','Contact_Phone','Respond_Contact_ID','Source_Channel','Source_Conversation_ID','Visit_Date','Clinic_Hours','Booking_Status','Patient_Confirmed_At','Reminder_Status','Message_Consent','Assigned_Secretary','Arrival_Time','Arrival_Sequence','Attendance_Status','Last_Updated_At','Last_Action_ID','Admin_Note'];

// Advisory lock key for the sync job — prevents overlapping runs.
const SYNC_LOCK_KEY = 777_001;

export interface BookingRow {
  booking_code: string;
  created_at: Date;
  clinic_date: string;
  status: string;
  confirmed_at: Date | null;
  arrived_at: Date | null;
  arrival_sequence: number | null;
  attendance_status: string;
  updated_at: Date;
  contact_id: string;
  display_name: string;
  phone: string | null;
  source_channel: string;
}

function sheetsConfig() {
  const id = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!id || !email || !key) return null;
  const auth = new google.auth.JWT({ email, key: key.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return { id, sheets: google.sheets({ version: 'v4', auth }), tab: process.env.GOOGLE_SHEET_TAB || 'Bookings' };
}

/**
 * Core outbox drain logic. Acquires an advisory lock (non-blocking), snapshots
 * pending row IDs, fetches booking data, calls doSync, then marks exactly those
 * rows synced. Rows written after the snapshot stay pending for the next run.
 *
 * Returns { synced: N } on success, { synced: 0, skipped: reason } when the
 * lock is held or there is nothing to do.
 */
export async function drainOutbox(
  doSync: (rows: BookingRow[]) => Promise<void>,
  db: Pool = pool,
): Promise<{ synced: number; skipped?: string }> {
  const client = await db.connect();
  try {
    // Non-blocking advisory lock — returns false immediately if another worker holds it.
    const lock = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS ok',
      [SYNC_LOCK_KEY],
    );
    if (!lock.rows[0].ok) return { synced: 0, skipped: 'sync already running' };

    try {
      // Capture the IDs of unsync'd rows now — new rows inserted during the run stay pending.
      const pending = await client.query<{ id: string }>(
        'SELECT id FROM sync_outbox WHERE synced_at IS NULL ORDER BY id',
      );
      const pendingIds = pending.rows.map(r => r.id);

      if (pendingIds.length === 0) return { synced: 0, skipped: 'nothing pending' };

      // Full booking snapshot (what gets pushed to Sheets).
      const result = await client.query<BookingRow>(
        `SELECT b.booking_code, b.created_at, b.clinic_date::text AS clinic_date,
                b.status, b.confirmed_at, b.arrived_at, b.arrival_sequence,
                b.attendance_status, b.updated_at,
                c.id AS contact_id, c.display_name, c.phone, c.source_channel
         FROM bookings b
         JOIN contacts c ON b.contact_id = c.id
         ORDER BY b.clinic_date, b.created_at`,
      );

      try {
        await doSync(result.rows);
        // Mark only the rows that existed when the snapshot was taken.
        await client.query(
          'UPDATE sync_outbox SET synced_at = now(), error = NULL WHERE id = ANY($1)',
          [pendingIds],
        );
        return { synced: result.rowCount ?? 0 };
      } catch (syncErr) {
        // Record the failure so operators can see which rows failed.
        await client.query(
          'UPDATE sync_outbox SET error = $1 WHERE id = ANY($2) AND synced_at IS NULL',
          [String(syncErr), pendingIds],
        );
        throw syncErr;
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Full Sheets sync. No-ops gracefully when credentials are absent. */
export async function syncSheets(db: Pool = pool): Promise<{ synced: number; skipped?: string }> {
  const config = sheetsConfig();
  if (!config) return { synced: 0, skipped: 'Google Sheets credentials not configured' };

  const { sheets, id, tab } = config;
  const hours = (await import('./policy')).clinicHours;

  try {
    return await drainOutbox(async (rows) => {
    const values = [
      HEADERS,
      ...rows.map(r => [
        r.booking_code,
        new Date(r.created_at).toISOString(),
        r.display_name,
        r.phone ?? '',
        r.contact_id,
        r.source_channel,
        '',
        r.clinic_date,
        hours(r.clinic_date) ?? '',
        r.status,
        r.confirmed_at ? new Date(r.confirmed_at).toISOString() : '',
        '', '', '',
        r.arrived_at ? new Date(r.arrived_at).toISOString() : '',
        r.arrival_sequence ?? '',
        r.attendance_status,
        new Date(r.updated_at).toISOString(),
        '', '',
      ]),
    ];
    const endRow = Math.max(values.length, 2);
    await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `'${tab}'!A1:T` });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${tab}'!A1:T${endRow}`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
    }, db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sheets-sync] FAILED:', message);
    // Fire-and-forget audit entry — never let alerting break the caller.
    void audit({
      actorType: 'SYSTEM',
      actorId: null,
      action: 'SHEETS_SYNC_FAILED',
      entityType: 'sync',
      entityId: 'sheets',
      detail: { error: message, sheetId: id },
    });
    throw err;
  }
}
