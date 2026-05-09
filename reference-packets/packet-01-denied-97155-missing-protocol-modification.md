# Packet 01: Denied Claim - CPT 97155 Not Supported

## Packet Status

- Packet type: Denied claim example
- Scenario: Protocol modification billed, but session note reads like direct therapy only
- Payer: Mock commercial payer, "Northstar Health"
- Claim format: Professional claim / CMS-1500 style
- Client: `CLIENT-001`
- Provider organization: `Thrive Advanced Care` mock record
- Date created: `2026-04-29`

## Claim Line Summary

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

## Authorization Snapshot

| Field | Value |
| --- | --- |
| Authorization number | `AUTH-NS-778201` |
| Authorized CPT | `97155` |
| Authorized period | `2026-02-01` to `2026-05-01` |
| Authorized units | 96 units |
| Used before this claim | 40 units |
| Remaining before this claim | 56 units |
| Provider type required | BCBA or physician/qualified healthcare professional |
| Service location allowed | Clinic |

## Session Note Submitted

| Field | Value |
| --- | --- |
| Session date | `2026-03-12` |
| Start time | `10:00 AM` |
| End time | `12:00 PM` |
| Location | Clinic |
| Provider | `PROV-BCBA-014` |
| Client present | Yes |
| Caregiver present | No |
| Signature | Electronic signature present |

### Narrative Note

Client arrived at clinic and transitioned to the therapy room with minimal prompting. Provider worked on matching, manding, listener responding, and tolerating denied access. Client completed several table work activities and earned breaks with preferred items. Client had two instances of elopement and one tantrum. Provider redirected client back to task and used differential reinforcement. Client responded well to token board and visual schedule. No safety concerns observed.

### Goals Referenced

- Increase functional communication
- Increase listener responding
- Decrease tantrum behavior
- Decrease elopement

### Data Summary

| Target | Result |
| --- | --- |
| Manding | 62 percent independent |
| Listener responding | 70 percent independent |
| Tantrum | 1 occurrence |
| Elopement | 2 occurrences |

## Payer Denial / Remittance

| Field | Value |
| --- | --- |
| Claim number | `CLM-8842001` |
| Denial date | `2026-03-28` |
| Claim status | Denied |
| CARC | `50` |
| CARC meaning | These are non-covered services because this is not deemed a medical necessity by the payer |
| RARC | `M127` |
| RARC meaning | Missing patient medical record for this service |
| Payer note | Documentation submitted does not support adaptive behavior treatment with protocol modification. Session note reflects direct treatment activities and does not identify protocol modification, technician direction, assessment of treatment protocol, or treatment plan changes. |

## Why This Should Fail Pre-Submission

The claim line bills `97155`, which generally requires documentation of adaptive behavior treatment with protocol modification by a qualified provider. The submitted note describes direct implementation of goals but does not clearly document:

- What protocol was reviewed or modified
- Why the modification was medically necessary
- Which data or client response triggered the change
- Whether the provider directed a technician or caregiver
- What change was made to the treatment plan or program instructions
- How the modification affects future treatment

## Audit Engine Expected Output

```json
{
  "packet_id": "packet-01",
  "status": "fail",
  "primary_issue": "Documentation does not support CPT 97155",
  "findings": [
    {
      "rule_id": "CPT-97155-001",
      "severity": "fail",
      "message": "Session note must identify protocol modification or treatment protocol assessment."
    },
    {
      "rule_id": "CPT-97155-002",
      "severity": "fail",
      "message": "Session note should describe the clinical reason for the protocol modification."
    },
    {
      "rule_id": "CPT-97155-003",
      "severity": "warning",
      "message": "Direct therapy activities are documented, but provider-level protocol work is not clearly separated."
    }
  ],
  "recommended_fix": "Revise the note only if supported by the actual service. Add the protocol reviewed, data prompting the change, provider direction given, changes made, and future implementation instructions."
}
```

