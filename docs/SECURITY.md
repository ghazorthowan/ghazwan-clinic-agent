# Security & Privacy Gate — NOT production approved

The demo has a single staff password and signed session cookie; this is intentionally limited. Its cookie-authenticated mutation routes lack dedicated CSRF defense and rate limits, so do not expose it publicly.

For a clinic system, before live data: (1) secure individual account authentication with MFA and role-based access; (2) data processing agreements and medical/privacy counsel; (3) encryption in transit/at rest; (4) retention/deletion workflow; (5) safe logging, backups, incident response; (6) webhook signature checks and idempotency; (7) staff training; (8) urgent-symptom escalation verified by clinicians; (9) no unapproved medical imaging, reports or diagnoses in receptionist chats or booking database.

Simulator is not a substitute for clinical-safety testing or official API integrations.
