# Packet 01: Corrected Resubmission - CPT 97155 Supported

## Packet Status

- Packet type: Corrected/resubmitted claim example
- Scenario: Original `97155` note corrected to document protocol modification
- Payer: Mock commercial payer, "Northstar Health"
- Original claim number: `CLM-8842001`
- Corrected claim number: `CLM-8842001-R1`
- Client: `CLIENT-001`
- Date created: `2026-04-29`

## Corrected Claim Line Summary

| Field | Value |
| --- | --- |
| Client ID | `CLIENT-001` |
| Date of service | `2026-03-12` |
| CPT/HCPCS | `97155` |
| Modifier | `HN` |
| Place of service | `11` |
| Rendering provider | `PROV-BCBA-014` |
| Rendering credential | `BCBA` |
| Units billed | `8` |
| Unit length | 15 minutes |
| Total billed time | 120 minutes |
| Diagnosis | `F84.0` Autism spectrum disorder |
| Charge amount | `$320.00` |
| Authorization number | `AUTH-NS-778201` |
| Frequency limit status | Within authorized units |

## Corrected Session Note

| Field | Value |
| --- | --- |
| Session date | `2026-03-12` |
| Start time | `10:00 AM` |
| End time | `12:00 PM` |
| Location | Clinic |
| Provider | `PROV-BCBA-014` |
| Provider credential | BCBA |
| Technician present | Yes, `PROV-RBT-219` |
| Client present | Yes |
| Caregiver present | No |
| Signature | Electronic signature present |

### Clinical Purpose

BCBA provided adaptive behavior treatment with protocol modification due to reduced independence on functional communication targets and increased elopement during denied-access routines. The purpose of the session was to observe current protocol implementation, review client response data, direct the technician, and modify antecedent and reinforcement procedures.

### Protocols Reviewed

- Functional communication training for access to preferred items
- Denied-access tolerance program
- Elopement reduction protocol
- Token reinforcement schedule

### Data Reviewed During Session

| Target | Recent baseline / trend | Observation during session |
| --- | --- | --- |
| Functional communication | 58 to 65 percent independent across prior week | 62 percent independent |
| Denied-access tolerance | Tantrum average 2 per session | 1 tantrum |
| Elopement | Increased from 0-1 to 2-3 per session | 2 elopement attempts |
| Listener responding | Stable near 70 percent independent | 70 percent independent |

### Protocol Modification Made

BCBA modified the denied-access protocol by adding a visual delay cue before removal of preferred items and changing the reinforcement schedule from fixed ratio 3 to fixed ratio 2 for independent manding during denied-access trials. BCBA also revised the technician prompt hierarchy to require a 5-second wait before gestural prompting, unless safety risk is present.

### Direction Given To Technician

BCBA modeled the revised denied-access sequence for `PROV-RBT-219`, observed technician implementation, and provided corrective feedback on timing of prompts and delivery of reinforcement. Technician demonstrated the revised sequence correctly in 4 of 5 observed opportunities by the end of session.

### Medical Necessity / Clinical Rationale

Protocol modification was needed because the client's elopement attempts increased when preferred access was delayed or denied. The modification is intended to reduce escape-maintained elopement and increase independent functional communication as a replacement behavior.

### Future Plan

Continue revised visual delay cue and fixed ratio 2 reinforcement schedule for five treatment days. BCBA will review data after 20 denied-access trials or sooner if elopement exceeds 3 occurrences in one session.

## Resubmission Cover Note

Original denial stated that the submitted documentation did not support `97155`. The corrected documentation clarifies that the BCBA reviewed treatment data, modified the denied-access protocol, directed the technician, and updated implementation instructions. No billed time, CPT code, provider, diagnosis, authorization, or date of service changed.

## Audit Engine Expected Output

```json
{
  "packet_id": "packet-01-resubmission",
  "status": "pass",
  "findings": [
    {
      "rule_id": "AUTH-001",
      "severity": "pass",
      "message": "Authorization active on date of service and remaining units available."
    },
    {
      "rule_id": "CPT-97155-001",
      "severity": "pass",
      "message": "Session note identifies protocol modification."
    },
    {
      "rule_id": "CPT-97155-002",
      "severity": "pass",
      "message": "Clinical rationale and data supporting modification are documented."
    },
    {
      "rule_id": "CPT-97155-004",
      "severity": "pass",
      "message": "Provider direction to technician is documented."
    }
  ]
}
```

