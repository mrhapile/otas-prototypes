// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IComplianceModule} from "../interfaces/IComplianceModule.sol";

contract ComplianceModule is Ownable, IComplianceModule {
    mapping(address => ComplianceMetadata) private registry;
    mapping(address => HashedAttestation) private hashedRegistry;
    mapping(address => bool) public authorizedIssuers;

    event AttestationStored(address indexed holder, bytes32 kycHash);
    event AttestationHashStored(address indexed holder, bytes32 kycHash);
    event AttestationRevoked(address indexed holder);
    event IssuerAuthorized(address indexed issuer);

    modifier onlyAuthorizedIssuer() {
        require(authorizedIssuers[msg.sender], "Unauthorized issuer");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {
        authorizedIssuers[initialOwner] = true;
        emit IssuerAuthorized(initialOwner);
    }

    function isEligible(
        address holder,
        bytes2 requiredJurisdiction,
        uint8 requiredCategory
    ) external view returns (bool) {
        ComplianceMetadata memory meta = registry[holder];

        if (meta.attestationExpiry == 0 || meta.attestationExpiry < block.timestamp) {
            return false;
        }

        if (meta.jurisdiction != requiredJurisdiction) {
            return false;
        }

        if (meta.investorCategory < requiredCategory) {
            return false;
        }

        return true;
    }

    function storeAttestation(
        address holder,
        ComplianceMetadata calldata meta
    ) external onlyAuthorizedIssuer {
        require(holder != address(0), "Invalid holder");

        registry[holder] = meta;
        emit AttestationStored(holder, meta.kycAttestationHash);
    }

    function storeAttestationHash(
        address holder,
        bytes32 kycAttestationHash,
        uint256 attestationExpiry
    ) external onlyAuthorizedIssuer {
        require(holder != address(0), "Invalid holder");

        hashedRegistry[holder] = HashedAttestation({
            kycAttestationHash: kycAttestationHash,
            attestationExpiry: attestationExpiry
        });

        emit AttestationHashStored(holder, kycAttestationHash);
    }

    function revokeAttestation(address holder) external onlyAuthorizedIssuer {
        delete registry[holder];
        delete hashedRegistry[holder];

        emit AttestationRevoked(holder);
    }

    function getMetadata(
        address holder
    ) external view returns (ComplianceMetadata memory) {
        return registry[holder];
    }

    function getHashedAttestation(
        address holder
    ) external view returns (HashedAttestation memory) {
        return hashedRegistry[holder];
    }

    function authorizeIssuer(address issuer) external onlyOwner {
        require(issuer != address(0), "Invalid issuer");

        authorizedIssuers[issuer] = true;
        emit IssuerAuthorized(issuer);
    }
}
