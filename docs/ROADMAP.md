# Claude Code Implementation Roadmap

## M0 — Completed starter (local-only)
- Next.js dashboard and local signed-cookie password prototype
- PostgreSQL booking tables and mutations
- Opening-day rules, confirmation/cancellation/check-in
- WhatsApp-like deterministic simulator
- Google Sheets A:T snapshot adapter
- Policy unit tests

## M1 — Production foundation (do first)
- Move password prototype to individual staff identities, MFA, RBAC
- Rate limit login, mutations, webhook endpoints; add CSRF/origin protection
- Add database integration tests with disposable Postgres instance
- Closure and override management with approval/audit
- Structured event processing with transaction-safe idempotency
- Durable outbox and Sheets sync job (no overlapping snapshots), failure alerts
- Staff audit actor IDs, immutable event log; backup/restore tests
- CI pipeline for test/build/security checks

## M2 — One official WhatsApp number (sandbox first)
- Meta app and WhatsApp Cloud API onboarding, provider credentials via secret manager
- Webhook GET challenge + POST signature verification, replay handling
- Event normalization and unique provider message IDs
- Provider message-window checks and approved utility template mapping
- Outbound delivery queue with retries, read receipts kept informational
- Staff opt-out/handoff and response pause
- Contract tests using official fixture formats and synthetic contacts

## M3 — Expand channels
- Two additional independently authorized WhatsApp numbers
- Instagram Business and Facebook Messenger authorized providers
- Wix embeddable widget with limited origin and abusive traffic protections
- TikTok Business Messaging adapter behind feature flag; only after approved access
- Human inbox, message history and role-based assignment

## M4 — Safe administrative AI
- Model API credentials/server-only tool execution
- Retrieval from physician-approved administrative FAQs
- Safe tools for clinic-day lookup, book/cancel/confirm/escalate
- Rule-based emergency response and clinician approved wording
- Language tests: Arabic, Iraqi dialect variants, English, typo robustness
- Strict prohibition on clinical interpretation or patient-specific medical advice

## M5 — Operations/production release gate
- Patient-facing bilingual privacy disclosure, consent and data retention
- Security penetration assessment, provider contracts and medical privacy review
- Provider API approvals and failure-mode testing
- Staff runbook, daily clinic session management, alerts and disaster recovery
- Supervised staged launch, monitoring and post-launch audit
