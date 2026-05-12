// SPDX-License-Identifier: Apache-2.0
package compliance

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// ComplianceMetadata mirrors compliance-metadata.schema.json
// semantically equivalent to ComplianceModule.sol ComplianceMetadata struct
type ComplianceMetadata struct {
	LEI                    string `json:"lei"`
	ISIN                   string `json:"isin"`
	CFI                    string `json:"cfi"`
	Jurisdiction           string `json:"jurisdiction"`
	InvestorCategory       int    `json:"investorCategory"`
	KYCAttestationHash     string `json:"kycAttestationHash"`
	AttestationExpiry      int64  `json:"attestationExpiry"`
	CustomRestrictionFlags int    `json:"customRestrictionFlags"`
}

// ComplianceChaincode implements isEligible semantics
// equivalent to ComplianceModule.sol isEligible()
type ComplianceChaincode struct {
	contractapi.Contract
}

// StoreAttestation writes ComplianceMetadata to world state
func (c *ComplianceChaincode) StoreAttestation(
	ctx contractapi.TransactionContextInterface,
	holderID string,
	metadataJSON string,
) error {
	var meta ComplianceMetadata
	if err := json.Unmarshal([]byte(metadataJSON), &meta); err != nil {
		return fmt.Errorf("invalid metadata: %w", err)
	}

	return ctx.GetStub().PutState(holderID, []byte(metadataJSON))
}

// IsEligible checks attestation freshness, jurisdiction, and investor category
// same three checks as ComplianceModule.sol isEligible()
func (c *ComplianceChaincode) IsEligible(
	ctx contractapi.TransactionContextInterface,
	holderID string,
	jurisdiction string,
	requiredCategory int,
) (bool, error) {
	data, err := ctx.GetStub().GetState(holderID)
	if err != nil || data == nil {
		return false, nil
	}

	var meta ComplianceMetadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return false, err
	}

	if meta.AttestationExpiry < time.Now().Unix() {
		return false, nil
	}

	if meta.Jurisdiction != jurisdiction {
		return false, nil
	}

	if meta.InvestorCategory < requiredCategory {
		return false, nil
	}

	return true, nil
}
