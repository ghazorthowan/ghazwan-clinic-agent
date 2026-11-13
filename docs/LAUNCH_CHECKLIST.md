# Ghazwan Clinic Receptionist — Pre-Production Launch Checklist

> Complete every item and obtain written sign-off from the clinic owner before connecting live patient channels.
> Reference: `CLAUDE.md` rules 1–8.

---

## Phase 1 — Legal & clinical-safety gates

- [ ] Privacy notice text reviewed and approved by a qualified Iraqi data-protection advisor
- [ ] Patient consent flow reviewed and approved by clinic owner (Dr. Ghazwan)
- [ ] Emergency escalation reply reviewed and approved by a licensed physician
- [ ] FAQ seed content reviewed and approved by a licensed physician — no clinical advice present
- [ ] Data retention policy (24 months) confirmed in writing with clinic owner
- [ ] Right-to-forget / erasure procedure documented and tested end-to-end
- [ ] CLAUDE.md rule 1 confirmed: no real patient records processed during development

## Phase 2 — Infrastructure

- [ ] Production PostgreSQL 17 instance provisioned (not Docker on a laptop)
- [ ] Database backups configured and tested (daily at minimum, point-in-time recovery preferred)
- [ ] All 12 migrations run successfully on production DB
- [ ] `GET /api/health` returns `{ "ok": true, "schemaVersion": 12 }` on production
- [ ] SSL/TLS certificate installed on the server (HTTPS only — Meta webhooks require HTTPS)
- [ ] Environment variables set in production (see `.env.example`):
  - [ ] `DATABASE_URL`
  - [ ] `ANTHROPIC_API_KEY`
  - [ ] `INTERNAL_API_SECRET`
  - [ ] `CSRF_SECRET` (or equivalent)
  - [ ] `META_APP_SECRET`
  - [ ] `META_VERIFY_TOKEN`
  - [ ] `WA_PHONE_NUMBER_ID` / `WA_PHONE_CHANNEL_MAP`
  - [ ] `WIDGET_ALLOWED_ORIGINS` (set to clinic website domain)
  - [ ] `TIKTOK_ENABLED=false` (until TikTok channel is ready)

## Phase 3 — Third-party credentials

- [ ] Meta Business Suite account created and verified
- [ ] WhatsApp Business API access approved by Meta
- [ ] WhatsApp Business phone number(s) registered and verified
- [ ] Webhook URL registered in Meta App Dashboard and verified (GET challenge test passed)
- [ ] Instagram account connected (if using Instagram channel)
- [ ] Facebook Page connected (if using Messenger channel)
- [ ] TikTok Business Messaging credentials obtained (if using TikTok — keep `TIKTOK_ENABLED=false` until ready)
- [ ] Wix website widget embed code configured with production URL and allowed origin

## Phase 4 — Security review

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all tests pass (unit + integration)
- [ ] `npm run build` — production build succeeds with no errors
- [ ] CSRF protection verified: webhook routes are exempt, staff API routes are protected
- [ ] Rate limiting tested: > 20 req/min from same IP returns 429
- [ ] HMAC signature verification tested for each active channel (WhatsApp, Meta, TikTok if enabled)
- [ ] Staff login: TOTP/MFA enforced for all accounts
- [ ] Staff login: lockout after 5 failed attempts confirmed
- [ ] RBAC: ADMIN and RECEPTIONIST roles tested — RECEPTIONIST cannot access admin-only endpoints
- [ ] Outbox worker: idempotency key prevents duplicate message sends
- [ ] Advisory lock: concurrent sync jobs do not overlap (tested with two simultaneous requests)

## Phase 5 — Operational readiness

- [ ] All staff have read `docs/RUNBOOK.md`
- [ ] Emergency procedure tested end-to-end with a test phone number (send "طوارئ", verify escalation)
- [ ] Consent flow tested end-to-end: new contact → privacy notice → consent → AI responds
- [ ] Data erasure tested end-to-end: contact sends deletion phrase → data erased → confirmation sent
- [ ] FAQ search tested: Arabic and English queries return relevant results
- [ ] Outbox retry tested: simulate send failure → message retries automatically
- [ ] Staff dashboard: inbox triage, assignment, and manual reply all tested
- [ ] Monitoring / uptime alert configured for `/api/health`
- [ ] On-call contact identified for after-hours system failures

## Phase 6 — Go-live

- [ ] Clinic owner has reviewed and signed off all items above
- [ ] Soft launch: connect one WhatsApp number only, with a small test group, for 48 hours
- [ ] Review audit log and AI responses after soft launch — no hallucinated clinical advice
- [ ] Full launch: connect remaining channels
- [ ] Post-launch: monitor inbox and audit log for the first 7 days daily

---

**Sign-off**

| Name | Role | Date | Signature |
|---|---|---|---|
| | Clinic owner | | |
| | IT / system admin | | |
| | Legal / data protection | | |
| | Clinical safety reviewer | | |
