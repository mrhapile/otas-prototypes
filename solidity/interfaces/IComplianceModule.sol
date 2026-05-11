// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IComplianceModule {
    struct ComplianceMetadata {
        bytes20 lei;
        bytes12 isin;
        bytes6 cfi;
        bytes2 jurisdiction;
        uint8 investorCategory;
        bytes32 kycAttestationHash;
        uint256 attestationExpiry;
        bytes32 customRestrictionFlags;
    }

    struct HashedAttestation {
        bytes32 kycAttestationHash;
        uint256 attestationExpiry;
    }

    function isEligible(
        address holder,
        bytes2 jurisdiction,
        uint8 requiredCategory
    ) external view returns (bool);

    function storeAttestation(
        address holder,
        ComplianceMetadata calldata meta
    ) external;

    function storeAttestationHash(
        address holder,
        bytes32 kycAttestationHash,
        uint256 attestationExpiry
    ) external;

    function revokeAttestation(address holder) external;

    function getMetadata(
        address holder
    ) external view returns (ComplianceMetadata memory);

    function getHashedAttestation(
        address holder
    ) external view returns (HashedAttestation memory);

    function authorizeIssuer(address issuer) external;
}
