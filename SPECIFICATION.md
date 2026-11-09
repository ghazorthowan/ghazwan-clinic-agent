# Development Specification — Clinic Receptionist

## 1. Product goal

A bilingual (Arabic/Iraqi Arabic/English), administrative-only patient receptionist for a Baghdad spine surgery clinic. Eventually connects three independently authorized WhatsApp Business numbers, Instagram Direct, Facebook Messenger, TikTok Business Messaging (subject to eligibility), and Wix website chat. Patients register intentions to visit on a clinic **day**, not at a guaranteed time. Staff maintain actual arrival order. PostgreSQL stores authoritative data, Google Sheets is a read-only operational mirror.

## 2. Current scope (implemented in starter)

- Next.js App Router dashboard and simple signed-cookie staff prototype access.
- PostgreSQL schema: contacts, bookings, clinic closures, booking events, conversations, messages, sync outbox.
- Deterministic clinic date rules: Sat 12–5; Sun–Wed 5–8; Thu/Fri closed.
- Date registration with idempotent handling of an active booking per contact/day.
- Confirm, cancel and arrival sequence transitions.
- Local-only WhatsApp-like chat simulator with Iraqi Arabic and English responses.
- Optional Google Sheets snapshot sync (A:T), using a service account.
- Unit tests for core booking policy.

## 3. Non-goals in starter

No production authentication, live API integrations, AI-generated medical responses, automated reminder service, outbound messages, staff push notifications, secure clinical records, or automatic patient identity matching between social channels.

## 4. Proposed production architecture

```
Official provider webhooks --> verify signature --> durable queue --> event dedupe
     --> channel adapter --> conversation store --> policy/consent router
     --> LLM for approved administrative FAQ ONLY --> safe actions
     --> transactional BookingService --> PostgreSQL --> Sheets sync job
                                      --> outbound delivery queue --> provider APIs
                                      --> staff inbox + human handoff
```

**Never allow the model to call raw SQL, send arbitrary WhatsApp messages, or diagnose symptoms.** Tools should be allow-listed functions such as `findClinicDay`, `createRegistration`, `confirmRegistration`, `cancelRegistration`, `escalateToStaff`.

## 5. Key entities and invariants

- `contacts`: provider-specific identity, not cross-channel identity by guess.
- `bookings`: `AWAITING_PATIENT -> CONFIRMED -> ARRIVED/COMPLETED`; cancellation before completion.
- `booking_events`: immutable action log, with unique action key for retries.
- `clinic_closures`: temporary dates not available for booking.
- `sync_outbox`: event/sync tracking, not the scheduling database.
- Physical queue order is allocated at in-person arrival, not confirmation time.
- A delivered/read receipt is **never** confirmation; only explicit patient reply or authorized staff action.
- Uncertain booking outcome => `NEEDS_STAFF`; never falsely claim success.
- The general receptionist must not request clinical records, review imaging, or deliver patient-specific clinical advice.

## 6. Channel adapter contracts (to implement)

`InboundEvent`: `{provider, providerMessageId, channelAccountId, senderId, receivedAt, text?, attachmentsMetadata?}`. Verify provider signature before trust, deduplicate by `(provider,providerMessageId)` and keep credentials separate for WhatsApp 1/2/3.

`OutboundMessage`: `{provider,channelAccountId,recipientId,kind:'text'|'approved_template',body?,templateId?,variables?,idempotencyKey}`. Enforce 24h window/template restrictions and consent policies per channel.

TikTok eligibility/API grants must be confirmed first; do not use screen scraping or unofficial WhatsApp Web automation.

## 7. Security requirements

- Strong staff authentication/MFA, RBAC, authorization at every route and event action.
- CSRF and origin checks for cookie authenticated mutations; API token scopes for service accounts.
- Webhook signature verification, replay resistance, deduplication, queue retries and dead-letter queue.
- Encrypt secrets at rest; TLS; hosting-region analysis, backups and tested restores.
- Minimal administrative data; never store patient scans, clinical narratives or diagnosis in booking tables.
- Consent, retention, access logs, legal review and vendor agreements before real messages.
- Emergency rule paths should be fail-safe and tested in Arabic/Iraqi Arabic/English.

## 8. Acceptance criteria for next phase

- 100% of scripted in-scope date registrations validated against schedule and closures.
- Repeated webhook delivery never creates an additional booking or confirmation message.
- No claim of confirmed booking before DB transaction commit.
- All operator actions are attributable and auditable.
- AI stops when a human takes ownership.
- No leakage of secrets in Git, user-facing messages, or application logs.
- Mock channel contract tests plus CI, database integration tests and web E2E tests.
