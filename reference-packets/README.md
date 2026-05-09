# ABA Claim Audit Reference Pack

This folder contains synthetic, redacted-style examples for designing a pre-submission ABA billing audit tool.

These are not real patient records, payer documents, or legal guidance. They are realistic mockups based on common ABA billing and documentation patterns so we can model the workflow safely without PHI.

## Files

- `packet-01-denied-97155-missing-protocol-modification.md`
  - A claim denied because the documentation does not support CPT `97155`.
- `packet-01-corrected-resubmission.md`
  - The same claim corrected with stronger clinical documentation and resubmission notes.
- `packet-02-paid-97153-clean.md`
  - A clean direct-treatment claim packet that should pass a pre-submission audit.
- `audit-rules-v0.json`
  - Starter machine-readable rules for the future audit engine.
- `audit-checklist.md`
  - Human-readable checklist for billing/admin review.

## Intended Product Use

The future tool should ingest the same categories represented here:

1. Claim line details
2. Authorization details
3. Client eligibility and diagnosis
4. Provider credentials
5. Session note
6. Treatment plan alignment
7. Payer denial/remittance details, when available

Then it should produce:

1. Pass/warning/fail status
2. Rule-level findings
3. Plain-language correction steps
4. A final claim readiness report

