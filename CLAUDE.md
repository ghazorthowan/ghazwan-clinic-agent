# Instructions for Claude Code

This is the **Ghazwan Clinic Receptionist** repository. Use `SPECIFICATION.md` and `docs/ROADMAP.md` as the authoritative implementation plan.

## Hard rules

1. **Do not process real patient records or real messages.** Use fictional fixtures until privacy, legal, vendor and clinical-safety gates are approved.
2. Do not invent provider API access. Official Meta WhatsApp Cloud API / Instagram / Messenger and TikTok Business Messaging credentials and eligibility must be separately obtained.
3. Keep the PostgreSQL database authoritative. Google Sheets is a synchronized operational view.
4. A patient must explicitly confirm. Read/delivered receipts do not count. In-person queue position is assigned at arrival.
5. Never put diagnosis, images, clinical notes or surgical advice into the bookings data model.
6. No direct SQL or arbitrary message-sending tool access for the language model. All AI actions use validated, allow-listed commands.
7. Every feature requires unit/integration tests and a clear rollback plan.
8. Do not deploy, migrate production data, message patients or connect third-party accounts without explicit user approval.

## Current repo

- `lib/policy.ts`: pure date/phone/intent policies.
- `lib/booking.ts`: transactional PostgreSQL booking operations.
- `lib/sheets.ts`: Sheets snapshot synchronization. It overwrites the configured A:T tab.
- `app/api`: staff-only prototype routes.
- `components`: staff dashboard and WhatsApp simulator.
- `tests`: pure-policy tests.

## Getting started

Follow `README.md`. Export `.env.local` variables when running CLI migration scripts. Run `npm test && npm run typecheck && npm run build` before opening a pull request.

## Next requested feature

Start with milestone **M1** in `docs/ROADMAP.md`: DB integration tests, date-closing API, real staff accounts/MFA/RBAC, CSRF, outbox worker, idempotent APIs and audit trails. Do not begin live WhatsApp channel connections until these pass.

## User experience

The clinic operates Saturday 12–5 and Sunday–Wednesday 5–8 Baghdad local time; Thursday/Friday closed; patient consultations remain first come, first served. Chat messages should clearly disclose automation and be respectful in Arabic/Iraqi Arabic and English.
