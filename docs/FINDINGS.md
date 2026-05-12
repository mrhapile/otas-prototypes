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
| `storeAttestation()` with full `ComplianceMetadata` struct | 119,645 |
| `storeAttestationHash()` with hash + expiry only | 70,555 |
| Difference | 49,090 |

### Open Questions Surfaced

Should `customRestrictionFlags` remain a raw bitmask, or should OTAS define a named restriction registry so different implementations do not assign conflicting meanings to the same bits?

Is a single `jurisdiction` field sufficient for cross-border cases where issuer, instrument, and investor restrictions may each need separate country semantics?

### Implications for OTAS Schema Design

The current shape suggests that a compact, platform-agnostic compliance primitive is feasible. The evidence from Prototype 1 points toward a "yes, with caveats" answer: the common schema is workable for a shared eligibility module, but OTAS still needs explicit standardisation around restriction-flag semantics and richer cross-border jurisdiction modeling.

## Prototype 2: HoldToken

### Research Question

Can one standardised hold interface serve both CCP margin holds and DvP settlement holds without introducing security gaps?

### Implementation Approach

Implemented `HoldToken.sol` as an ERC-20 extension with a four-operation hold lifecycle: `createHold`, `executeHold`, `releaseHold`, and `reclaimHold`.

The core design is the notary model. Every hold records a `holder`, `notary`, `amount`, `expiry`, and `status`. The holder retains ownership of the tokens while the hold is active, but transfers are restricted by `availableBalanceOf()`, which excludes locked balances.

To avoid an obvious locking attack, hold creation is not fully open-ended in the implementation: the caller must be the holder or an approved spender with sufficient ERC-20 allowance. That allows a DvP manager to create a hold on behalf of a seller while preventing arbitrary third parties from freezing someone else's balance.

### What Worked

The same interface supports both intended roles cleanly. In a CCP-style flow, the CCP can act as notary and execute or release the hold. In a DvP flow, the settlement manager can use the same notary privileges without any interface changes.

Tests confirmed the full lifecycle behavior: hold creation reduces available balance, execution transfers locked tokens to the recipient, release restores available balance, reclaim safely unlocks expired holds, and both `transfer` and `transferFrom` respect the locked balance.

The notary abstraction turned out to be the key unifying design choice. It lets OTAS describe "who may consummate or unwind the lock" without hardcoding whether that actor is a CCP, custodian, or settlement coordinator.

### What Did Not Work / Limitations

The contract currently supports full execution only. It does not support partial execution, hold resizing, or batching, all of which may matter for more realistic margin and settlement workflows.

Expiry semantics are necessarily a little broader in practice than the original schema text suggests. The Solidity implementation accepts timestamp-style expiries for HoldToken tests and block-based expiries for DvP composition, which is useful for prototyping but indicates OTAS should choose and standardise one normative expiry model or explicitly define both.

The token also assumes transparent balances and a simple notary authorization model. It does not address privacy-preserving holds, partitioned balances, or institutional segregation requirements.

### Gas Cost Analysis

| Operation | Gas |
| --- | ---: |
| `createHold()` | 141,941 |
| `executeHold()` | 89,762 |
| `releaseHold()` | 55,017 |
| `reclaimHold()` | 57,045 |

### Open Questions Surfaced

Should OTAS standardise hold expiry as a timestamp, a block number, or an explicitly typed field that supports both modes without interpretation ambiguity?

Should holds support partial execution and partial release, or is a simpler full-amount lifecycle preferable for interoperability?

How should the standard represent off-chain notaries or legal entities when the implementation platform does not use EVM addresses?

### Implications for OTAS Schema Design

Prototype 2 supports a strong "yes, with constraints" answer. A standardised four-operation hold interface is sufficient for both CCP and DvP-style locking if the schema preserves the notary role explicitly and if the standard is clear about expiry semantics and authorization expectations.

## Prototype 3: DvPSettlementManager

### Research Question

What is the minimal on-chain interface for atomic DvP settlement, and does a compliance precondition break atomicity guarantees?

### Implementation Approach

Implemented `DvPSettlementManager.sol` as a coordinator that composes Prototype 1 and Prototype 2.

`createDvP()` first calls `ComplianceModule.isEligible()` for buyer and seller. If both pass, it creates a hold on the seller's asset tokens through `IHoldToken.createHold()`. The settlement then progresses through `commit()`, `finalise()`, and `abort()`.

The buyer commit escrows payment tokens in the settlement manager contract. The seller commit is a readiness confirmation. Once both commitments are present, `finalise()` executes the held asset transfer to the buyer and transfers payment to the seller in the same transaction.

### What Worked

The minimal interface proved workable in practice: `createDvP`, `commit`, `finalise`, and `abort` were enough to model the full lifecycle.

Tests confirmed that the compliance gate prevents ineligible parties from entering the flow before any asset lock is created, which preserves the atomicity of the settlement phase itself. The system either rejects early or settles atomically once both parties are committed.

The composition story is the important result here. DvP did not need custom escrow logic inside the asset token. Instead, it reused the shared compliance primitive and the shared hold primitive, which is exactly the composable pattern OTAS is trying to validate.

### What Did Not Work / Limitations

The current settlement ID derivation uses `keccak256(buyer, seller, block.number)`, which is simple but can collide if the same buyer and seller create multiple settlements in the same block. That is acceptable for a prototype but should not be the final identifier design.

The payment leg assumes a plain ERC-20 style `transferFrom` escrow into the settlement manager. More sophisticated payment assets may need their own hold semantics rather than simple escrow transfer.

Compliance is checked only at `createDvP()` time. If an attestation expires after creation but before finalisation, the current prototype does not re-check compliance. That was a deliberate simplification to isolate the research question, but it is an important policy question for a real standard.

### Gas Cost Analysis

| Operation | Gas |
| --- | ---: |
| `createDvP()` | 359,438 |
| `commit()` buyer leg | 89,034 |
| `commit()` seller leg | 33,690 |
| `finalise()` | 137,585 |
| `abort()` | 88,427 |

### Open Questions Surfaced

Should compliance be checked only at settlement creation, or should OTAS define optional re-validation at finalisation time for long-lived settlements?

Should both asset and payment legs rely on shared hold semantics, or is escrow-on-commit sufficient for the cash leg in the common case?

What canonical settlement identifier scheme would remain deterministic while avoiding same-block collisions across repeated trades?

### Implications for OTAS Schema Design

Prototype 3 supports a positive answer. The minimal DvP interface is small, composable, and workable, and the compliance precondition does not break atomicity when it is treated as an entry gate rather than part of the final settlement transaction.

The broader implication is that OTAS does not need a monolithic token standard to express DvP. A reusable compliance primitive plus a reusable hold primitive are enough to build settlement coordination on top.

## Prototype 4: JSON Schema + Go Chaincode

### Research Question

Does a shared schema enable cross-platform interoperability without custom translation layers?

### Implementation Approach

The ComplianceMetadata JSON Schema was used as the single source of truth. A Solidity struct and a Go struct were derived from it independently. The `isEligible()` function was implemented in both languages with identical logic — same three checks, same field names, same validation rules.

### What Worked

The JSON Schema successfully serves as a platform-agnostic contract between implementations. The eight fields map cleanly to both Solidity value types and Go primitive types with no semantic loss.

The Go `ComplianceChaincode` mirrors the Solidity module closely enough that a reader can compare the two implementations side by side and see the shared semantics directly, even before a full Fabric runtime is introduced.

### What Did Not Work / Limitations

Without a running Fabric network, cross-platform compliance query relaying via Cacti cannot be demonstrated. The Go implementation proves semantic equivalence structurally but not operationally in this phase.

The current Go side is a scaffold, not a full chaincode package: it demonstrates the data model and eligibility semantics, but it does not yet include network deployment, endorsement policy handling, or Fabric integration tests.

### Open Questions Surfaced

Can SATP's message format carry the ComplianceMetadata schema as a structured payload without modification? What governance process would maintain schema alignment across platform implementations over time?

### Implications for OTAS Schema Design

The schema-first approach is viable. Platform implementations can diverge in syntax while remaining semantically aligned if the schema is treated as the normative definition.
