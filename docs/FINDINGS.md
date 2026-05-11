# OTAS Findings

## Prototype 1: ComplianceModule

### Research Question

Can a single platform-agnostic compliance metadata schema simultaneously satisfy ERC-3643 claim requirements, CMTAT role requirements, and ISO 20022 field requirements?

### Implementation Approach

Implemented a Solidity registry keyed by holder address, storing an eight-field `ComplianceMetadata` struct plus a supporting hash-only storage path to compare full metadata persistence against minimal attestation persistence.

The eligibility surface is intentionally narrow: `isEligible(holder, jurisdiction, requiredCategory)` checks only attestation freshness, jurisdiction match, and minimum investor category, keeping the module focused on shared semantics rather than standard-specific compliance workflows.

### What Worked

Prototype 1 is implemented with issuer authorization, attestation storage, revocation, metadata retrieval, and an eligibility check that can be reused by later hold and DvP prototypes.

Initial tests cover successful eligibility, expired attestations, jurisdiction mismatch, insufficient investor category, unauthorized issuer rejection, and revocation behavior.

Based on this first implementation pass, the shared eight-field schema appears sufficient for the minimum common denominator across ERC-3643-style eligibility checks, CMTAT-style role categorisation, and ISO-aligned instrument/entity identifiers. No direct field collision surfaced in the prototype itself; the remaining ambiguity is semantic rather than structural.

### What Did Not Work / Limitations

The contract does not attempt to model ERC-3643 claim issuers, CMTAT role graphs, or ISO 20022 message envelopes in full; it only captures the minimum shared metadata needed for a reusable eligibility gate.

Jurisdiction-specific rules are reserved in `customRestrictionFlags` but not yet interpreted, so the current `isEligible` behavior is deliberately narrower than production compliance engines.

The main unresolved conflict area is not missing fields but shared meaning: `customRestrictionFlags` still needs a canonical registry, and a single `jurisdiction` field may be too coarse for multi-jurisdiction issuance and distribution patterns.

### Gas Cost Analysis (Solidity prototypes)

| Operation | Gas |
| --- | ---: |
| `storeAttestation()` with full `ComplianceMetadata` struct | 119,633 |
| `storeAttestationHash()` with hash + expiry only | 70,543 |
| Difference | 49,090 |

### Open Questions Surfaced

Should `customRestrictionFlags` remain a raw bitmask, or should OTAS define a named restriction registry so different implementations do not assign conflicting meanings to the same bits?

Is a single `jurisdiction` field sufficient for cross-border cases where issuer, instrument, and investor restrictions may each need separate country semantics?

### Implications for OTAS Schema Design

The current shape suggests that a compact, platform-agnostic compliance primitive is feasible. The evidence from Prototype 1 points toward a "yes, with caveats" answer: the common schema is workable for a shared eligibility module, but OTAS still needs explicit standardisation around restriction-flag semantics and richer cross-border jurisdiction modeling.
