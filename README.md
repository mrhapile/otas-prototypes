# otas-prototypes

Illustrative smart contract primitives for post-trade token base types, hold semantics, and DvP settlement — research artefacts contributed to LF Decentralized Trust OTAS Lab exploring composable token standards across EVM and Hyperledger environments.

---

## What This Is

Global securities markets settle trillions of dollars of trades daily through infrastructure built in the 1970s. The move to distributed ledger technology has not fixed this fragmentation it has reproduced it. Every institution runs its own DLT network with its own token schema. Compliance metadata is lost every time an asset crosses a ledger boundary. No token standard defines atomic delivery-versus-payment natively. No two standards agree on what a hold means.

This repository is a research workspace for the [OTAS Lab](https://github.com/OpenTokenizedAssetStandard) under [LF Decentralized Trust](https://www.lfdecentralizedtrust.org/). It contains illustrative smart contract examples — not production code  designed to test whether a small set of composable token primitives can describe institutional post-trade workflows across heterogeneous platforms.

Each prototype targets a specific structural gap in the existing tokenization landscape. Each one is documented with a research question, implementation approach, findings, and open questions. The code is the experiment. The `docs/` folder is the result.

---

## The Six Gaps This Work Addresses

Based on a comparative survey of ERC-1400, ERC-3643, CMTAT, ERC-4626, Hyperledger Fabric Token SDK, and SATP, six structural gaps were identified in the existing tokenization framework landscape:

1. **No universal compliance metadata schema** — every standard defines its own model, none maps to ISO 20022
2. **Compliance metadata lost at ledger boundaries** — SATP carries only asset ID and amount; KYC claims are silently dropped
3. **No standard DvP settlement primitive** — all standards delegate atomic settlement to application-level logic
4. **Hold and escrow mechanics not standardised** — no common interface for CCP margin holds or settlement locks
5. **No cross-platform semantic equivalence** — no formal mapping between Solidity interfaces and Fabric Chaincode
6. **Regulatory alignment documentation absent** — no token standard maps its fields to US, EU, or UK regulatory requirements

---

## The Four Prototypes

| # | Prototype | Research Question | Status |
|---|-----------|-------------------|--------|
| 1 | `ComplianceModule.sol` | Can a single schema satisfy ERC-3643, CMTAT, and ISO 20022 simultaneously? | ✅ Complete |
| 2 | `HoldToken.sol` | Can one hold interface serve both CCP margin holds and DvP settlement holds? | 🔧 In Progress |
| 3 | `DvPSettlementManager.sol` | What is the minimal on-chain DvP interface, and does a compliance precondition break atomicity? | 📋 Planned |
| 4 | JSON Schema + Go Chaincode | Does a shared schema enable cross-platform interoperability without custom translation? | 📋 Planned |

Prototypes 2 and 3 depend on Prototype 1 — the `DvPSettlementManager` calls `ComplianceModule.isEligible()` as a mandatory precondition before any tokens are locked. That composition is the point.

---

## Key Finding So Far

Storing full `ComplianceMetadata` on-chain costs **119,633 gas**. Storing only the attestation hash costs **70,543 gas** — a difference of **49,090 gas** per attestation. This gap directly informs the design question of whether compliance metadata should live on-chain or be referenced via hash with off-chain resolution.

Full findings in [`docs/FINDINGS.md`](docs/FINDINGS.md).

---

## Repository Structure

```
otas-prototypes/
├── schemas/                          # platform-agnostic data definitions
│   ├── compliance-metadata.schema.json
│   ├── hold.schema.json              # placeholder
│   └── dvp-settlement.schema.json    # placeholder
├── solidity/                         # EVM reference implementations
│   ├── contracts/
│   │   └── ComplianceModule.sol
│   ├── interfaces/
│   │   └── IComplianceModule.sol
│   ├── test/
│   │   └── ComplianceModule.test.js
│   ├── hardhat.config.js
│   └── package.json
├── chaincode/                        # Hyperledger Fabric implementation (planned)
│   └── compliance/
└── docs/
    ├── FINDINGS.md
    └── RESEARCH_QUESTIONS.md
```

The architecture is intentionally layered:

- `schemas/` defines shared meaning independent of any platform
- `solidity/` proves EVM behavior against that schema
- `chaincode/` will prove Fabric behavior against the same schema
- `docs/` captures what the prototypes taught us

---

## How to Run

### Prerequisites

- Node.js 18+
- npm

### Run Prototype 1 tests

```bash
cd solidity
npm install
npm test
```

### Compile only

```bash
cd solidity
npm run compile
```

---

## Research Context

This work is conducted as part of the [LFX Mentorship Program 2026](https://mentorship.lfx.linuxfoundation.org/) under the OTAS Lab, LF Decentralized Trust.

All outputs are research artefacts intended for educational and community discussion purposes. No implied standard, mandate, or regulatory guidance is attached to any output produced here.

Primary sources informing this research:
- BIS Annual Economic Report 2025, Chapter III (Unified Ledger)
- IOSCO Final Report on Financial Asset Tokenization, November 2025
- IETF SATP Draft, Revision 11, August 2025
- ERC-1400, ERC-3643, CMTAT, ERC-4626 specifications and reference implementations
- Hyperledger Fabric Token SDK and Cacti documentation

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).

All research outputs contributed to the LF Decentralized Trust community under open source licensing consistent with OTAS Lab governance.