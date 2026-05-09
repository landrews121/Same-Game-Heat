# Packet 02: Clean Paid Claim - CPT 97153 Direct Treatment

## Packet Status

- Packet type: Paid/good packet example
- Scenario: Direct adaptive behavior treatment by technician under treatment plan
- Payer: Mock commercial payer, "Northstar Health"
- Claim status: Paid
- Client: `CLIENT-002`
- Date created: `2026-04-29`

## Claim Line Summary

| Field | Value |
| --- | --- |
| Client ID | `CLIENT-002` |
| Date of service | `2026-03-18` |
| CPT/HCPCS | `97153` |
| Modifier | `HM` |
| Place of service | `11` |
| Rendering provider | `PROV-RBT-219` |
| Rendering credential | `RBT` |
| Supervising provider | `PROV-BCBA-014` |
| Units billed | `12` |
| Unit length | 15 minutes |
| Total billed time | 180 minutes |
| Diagnosis | `F84.0` Autism spectrum disorder |
| Charge amount | `$420.00` |
| Authorization number | `AUTH-NS-779912` |

## Authorization Snapshot

| Field | Value |
| --- | --- |
| Authorization number | `AUTH-NS-779912` |
| Authorized CPT | `97153` |
| Authorized period | `2026-02-15` to `2026-05-15` |
| Authorized units | 360 units |
| Used before this claim | 116 units |
| Remaining before this claim | 244 units |
| Provider type allowed | RBT/technician under BCBA supervision |
| Service location allowed | Clinic |

## Eligibility / Client Snapshot

| Field | Value |
| --- | --- |
| Eligibility verified | Yes |
| Eligibility date checked | `2026-03-17` |
| Active coverage on DOS | Yes |
| Diagnosis on file | `F84.0` Autism spectrum disorder |
| Treatment plan active | Yes |
| Treatment plan dates | `2026-02-15` to `2026-08-15` |
| Referral/prescription on file | Yes |

## Session Note

| Field | Value |
| --- | --- |
| Session date | `2026-03-18` |
| Start time | `9:00 AM` |
| End time | `12:00 PM` |
| Location | Clinic |
| Provider | `PROV-RBT-219` |
| Credential | RBT |
| Client present | Yes |
| Caregiver present | No |
| Supervising BCBA | `PROV-BCBA-014` |
| Signature | Electronic signature present |

### Narrative Note

RBT provided direct adaptive behavior treatment according to the active treatment plan. Session targeted functional communication, listener responding, imitation, transition tolerance, and reduction of tantrum behavior. Client transitioned into the therapy room with one verbal prompt. RBT used differential reinforcement, token board, visual schedule, and least-to-most prompting. Client requested preferred items using two-word phrases in 18 of 25 opportunities. Client completed listener responding targets with 76 percent independence. One tantrum occurred when access to tablet was delayed; RBT followed the denied-access protocol and client returned to task after 3 minutes.

### Goals Addressed

| Treatment plan goal | Session target | Result |
| --- | --- | --- |
| Increase functional communication | Two-word manding | 18/25 independent |
| Increase listener responding | Receptive object identification | 19/25 independent |
| Improve transitions | Transition to table work | 4/5 successful |
| Decrease tantrum behavior | Denied-access tolerance | 1 occurrence |

### Interventions Used

- Differential reinforcement
- Visual schedule
- Token economy
- Least-to-most prompting
- Functional communication training

### Plan

Continue current treatment plan targets. Monitor denied-access tolerance and report any increase in tantrum duration or frequency to supervising BCBA.

## Paid Remittance Snapshot

| Field | Value |
| --- | --- |
| Claim number | `CLM-8844773` |
| Claim received | `2026-03-19` |
| Claim processed | `2026-03-25` |
| Status | Paid |
| Allowed amount | `$330.00` |
| Paid amount | `$297.00` |
| Patient responsibility | `$33.00` |
| CARC | `PR-3` |
| CARC meaning | Co-payment amount |

## Why This Should Pass Pre-Submission

- Authorization is active for the date of service
- Billed CPT matches authorized CPT
- Units billed do not exceed remaining authorization
- Rendering provider credential matches direct-treatment service
- Session time supports 12 units
- Note documents client presence, goals, interventions, response, and plan
- Goals match active treatment plan
- Diagnosis and referral are on file
- Signature is present

## Audit Engine Expected Output

```json
{
  "packet_id": "packet-02",
  "status": "pass",
  "findings": [
    {
      "rule_id": "AUTH-001",
      "severity": "pass",
      "message": "Authorization active on date of service."
    },
    {
      "rule_id": "AUTH-002",
      "severity": "pass",
      "message": "CPT code is authorized."
    },
    {
      "rule_id": "TIME-001",
      "severity": "pass",
      "message": "Documented time supports billed units."
    },
    {
      "rule_id": "CPT-97153-001",
      "severity": "pass",
      "message": "Direct treatment note supports 97153."
    }
  ]
}
```

