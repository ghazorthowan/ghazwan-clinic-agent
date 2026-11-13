# Ghazwan Clinic Receptionist — Staff Runbook

> **Audience:** Receptionist and admin staff. For deployment and infrastructure procedures, see `LAUNCH_CHECKLIST.md`.

---

## Daily operations

### Morning checks (before clinic opens)

1. Open the staff dashboard and confirm the inbox shows **0 unread unassigned** conversations.
2. Check `/api/health` → should return `{ "ok": true, "db": "up" }`.
3. Verify the outbox queue is empty: dashboard shows no pending messages older than 5 minutes.
4. Confirm WhatsApp Business number(s) show **Connected** in the Meta Business Suite.

### Incoming messages flow

| State | Meaning | Staff action |
|---|---|---|
| AI | AI is handling the conversation | Monitor; no action needed |
| HUMAN | Assigned to a staff member | The assigned staff member replies in the inbox |
| OPEN | Unassigned / needs triage | Pick up and assign via the inbox |

**To assign a conversation to yourself:** open it in the inbox → click "Assign to me".

**To escalate to a doctor:** add a note and set status to HUMAN, then notify the doctor via your normal internal channel.

### End-of-day checks

1. Confirm all HUMAN conversations have been replied to or have a follow-up note.
2. Review any conversations in OPEN state older than 1 hour — assign or close them.
3. Check the audit log for any `DATA_ERASED` or `CONSENT_RECORDED` events (admin dashboard).

---

## Emergency procedures

### Patient reports an emergency via WhatsApp

The system automatically detects emergency keywords (Arabic, Iraqi dialect, English) and:
1. Escalates the conversation to HUMAN status immediately.
2. Sends a fixed bilingual reply directing the patient to call 115 (Iraq emergency) or go to the nearest emergency room.

**Staff action:** The conversation will appear in the HUMAN inbox. Contact the patient or their family immediately by phone. Do **not** attempt to manage medical emergencies through WhatsApp.

Emergency keywords include: طوارئ، إسعاف، ألم شديد، كسر، سقطت + English equivalents.

### AI is not responding (outbox backed up)

1. Check `/api/health` — if `db: "down"`, escalate to your IT contact.
2. Check Docker: `docker ps` — ensure `clinic_postgres` is running.
3. If the outbox has messages stuck > 10 minutes, manually restart the Next.js server.
4. Set affected conversations to HUMAN status so staff can reply manually.

### Database is down

1. Do **not** attempt to restart PostgreSQL without IT approval.
2. Switch all active conversations to HUMAN status manually.
3. Notify patients via WhatsApp that "the system is temporarily undergoing maintenance" (use the canned response in the inbox).
4. Contact IT immediately.

---

## Incident response

### Suspected data breach

1. **Stop:** do not delete logs or change passwords without IT guidance.
2. Contact the clinic owner and IT contact immediately.
3. Document the time you first noticed the issue and what you observed.
4. Do **not** discuss the incident on WhatsApp or social media.

### Patient requests data deletion ("احذف بياناتي" / "delete my data")

The system handles this automatically when the patient sends the deletion phrase. It will:
- Erase the patient's name and phone number from active records.
- Confirm erasure to the patient in both Arabic and English.
- Log a `DATA_ERASED` audit event.

**Staff action:** No action required. If a patient calls or visits requesting deletion, ask them to send "احذف بياناتي" via WhatsApp, or handle it manually via the admin panel under Contact Management → Erase Data.

### Accidental booking in wrong slot

1. Cancel the incorrect booking via the inbox conversation (use the Cancel Appointment action).
2. Rebook the correct slot — patient must confirm the new time explicitly.
3. Add a note to the audit log describing the correction.

---

## Useful commands (for IT / admin)

```bash
# Check health
curl http://localhost:3000/api/health

# View recent audit log (last 50 entries)
# Run in psql against clinic_booking database:
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50;

# Check pending outbox
SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY created_at;

# Check consent status for a phone number
SELECT phone, consent_given_at, data_deleted_at FROM contacts WHERE phone = '+964...';
```

---

## Contacts

| Role | Contact |
|---|---|
| Clinic owner | Dr. Ghazwan |
| IT / system admin | (fill in before go-live) |
| Meta WhatsApp support | business.facebook.com/support |
| Iraq emergency | 115 |
