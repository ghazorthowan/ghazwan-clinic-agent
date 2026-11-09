# Ghazwan Clinic AI Receptionist — Developer Starter

**Status: local development / synthetic data only. NOT for real patients.**

A Next.js + PostgreSQL starter with a receptionist dashboard, date-only registration, arrival-order check-in, Arabic/English deterministic WhatsApp simulator, and optional Google Sheets snapshot synchronization. Built for iterative work with Claude Code.

## Quick start

Prerequisites: Node.js **22+**, npm, Docker Desktop / Docker Engine, a terminal.

```bash
cp .env.example .env.local
# Edit STAFF_PASSWORD and STAFF_SESSION_SECRET in .env.local.
# For migration scripts, export the same environment variables:

docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm test
npm run dev
```

Visit **http://localhost:3000**. Sign in using `STAFF_PASSWORD`, register a fictional booking for an open future clinic day, confirm it, mark arrival, and visit **/chat** to test the WhatsApp simulator.

**Important:** `npm run db:migrate`, `npm run db:seed`, and `npm run sheets:sync` do not automatically load `.env.local`. Use `set -a; source .env.local; set +a` in a Unix shell before running those commands, or use a suitable environment loader. Next.js itself loads `.env.local`. The `.env` copy above supports some workflows but the scripts need exported shell variables. For local use the simplest command is:

```bash
set -a; source .env.local; set +a
npm run db:migrate
npm run db:seed
npm run dev
```

Never commit `.env*` files. Change the example database password before exposing a database outside localhost.

## Booking behavior

- Saturday: 12:00–17:00; Sunday–Wednesday: 17:00–20:00 (Asia/Baghdad); Thursday and Friday closed.
- Temporary closures are stored in `clinic_closures` (table; API for closures is not included in this starter).
- Registration is by **clinic day**, not appointment time.
- New booking starts at `AWAITING_PATIENT`; explicit confirmation changes to `CONFIRMED`.
- Check-in records `ARRIVED` and allocates an actual arrival sequence independent of online registration order.
- Repeat request for same contact and date returns the existing active booking.
- `SIMULATED_WHATSAPP` never sends external messages; it is a deterministic demonstration, not an LLM.

## Google Sheets: optional

1. Create a clinic-owned spreadsheet and a tab called **Bookings**.
2. Create a Google Cloud project; enable **Google Sheets API**; create a **service account** and a JSON key only if required by your security policy. Prefer short-lived credentials/workload identity in production.
3. Share the Sheet with the service account email as Editor.
4. Set `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in your secure server environment. Use literal `\\n` for private key line breaks.
5. Sign in and press **Sync Google Sheets**, or run `npm run sheets:sync` with exported environment variables.

**Synchronization is a full A:T snapshot**, not a change-by-change update; it clears and rewrites the named tab. Do not put hand-entered data or formulas in that tab. PostgreSQL is the authoritative database. This starter's snapshot sync is intentionally basic: concurrent sync calls can race, and staff edits to Sheets will be overwritten. Add serialization, scheduling and monitoring before production use.

## Testing

```bash
npm test
npm run typecheck
npm run build
```

Tests cover clinic opening days, closure weekdays, invalid dates, phone normalization, explicit confirmation versus read receipts, emergency keyword precedence and wording about first-come arrival. Real database integration tests, authorization tests, Meta webhook signature tests and E2E UI tests are **not yet implemented**.

## Existing APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/login` | POST | Prototype staff password session |
| `/api/auth/logout` | POST | End session |
| `/api/bookings` | GET / POST | List or create bookings (staff only) |
| `/api/bookings/[id]/confirm` | POST | Explicit confirmation (staff only) |
| `/api/bookings/[id]/cancel` | POST | Cancel booking (staff only) |
| `/api/bookings/[id]/arrive` | POST | Record actual physical arrival (staff only) |
| `/api/simulate` | POST | Simulated WhatsApp chat (staff only) |
| `/api/sync` | POST | Google Sheets snapshot (staff only) |

Requests to `/api/bookings` must include `{displayName, clinicDate, sourceChannel, externalContactRef, locale}`. Date format `YYYY-MM-DD`; no patient medical history or imaging fields are provided.

## Production blockers

Do **not** expose this service to real users until all are resolved:

1. Replace the single prototype password with staff identities, MFA, RBAC, session revocation, and account auditing.
2. Add **CSRF protection** to session-authenticated mutation routes, rate limiting, login lockouts and origin enforcement.
3. Implement Meta webhook verification, deduplication, outbound message permissions, template approval and WhatsApp Business authorization separately for each number.
4. Implement channel-specific adapters for Instagram, Facebook, TikTok and a Wix chat widget; they are **not included**.
5. Implement a durable job queue and message/event store, approved language-model integration, human takeover and staff notifications; **not included**.
6. Conduct Iraqi medical confidentiality/privacy review and vendor risk assessment; do not input real patient data into the starter.
7. Add proper retention controls, PII masking/logging, backups, restoration tests, access monitoring, incident handling and secure deployment.
8. Add reliable synchronization and reconciliation for Sheets. Audit field changes and handle consent-based reminders.
9. Evaluate and test emergency-language coverage separately from this simplified simulator.

See `SPECIFICATION.md`, `CLAUDE.md`, and `docs/ROADMAP.md` for the continuation plan.
