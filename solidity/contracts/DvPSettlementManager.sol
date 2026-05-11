// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IHoldToken.sol";
import "../interfaces/IComplianceModule.sol";

enum SettlementStatus {
    Pending,
    BothCommitted,
    Finalised,
    Aborted
}

struct Settlement {
    address assetToken;
    uint256 assetAmount;
    address paymentToken;
    uint256 paymentAmount;
    address buyer;
    address seller;
    uint256 expiryBlock;
    bytes32 holdId;
    bool buyerCommitted;
    bool sellerCommitted;
    SettlementStatus status;
}

contract DvPSettlementManager is Ownable {
    mapping(bytes32 => Settlement) public settlements;
    IComplianceModule public complianceModule;
    bytes2 public jurisdiction;
    uint8 public requiredCategory;

    event DvPCreated(
        bytes32 indexed settlementId,
        address buyer,
        address seller,
        uint256 assetAmount,
        uint256 paymentAmount
    );
    event PartyCommitted(bytes32 indexed settlementId, address party);
    event DvPFinalised(bytes32 indexed settlementId);
    event DvPAborted(bytes32 indexed settlementId);

    constructor(
        address _complianceModule,
        bytes2 _jurisdiction,
        uint8 _requiredCategory
    ) Ownable(msg.sender) {
        require(_complianceModule != address(0), "Invalid compliance module");

        complianceModule = IComplianceModule(_complianceModule);
        jurisdiction = _jurisdiction;
        requiredCategory = _requiredCategory;
    }

    function createDvP(
        address assetToken,
        uint256 assetAmount,
        address paymentToken,
        uint256 paymentAmount,
        address buyer,
        address seller,
        uint256 expiryBlock
    ) external returns (bytes32 settlementId) {
        require(assetToken != address(0), "Invalid asset token");
        require(paymentToken != address(0), "Invalid payment token");
        require(buyer != address(0), "Invalid buyer");
        require(seller != address(0), "Invalid seller");
        require(assetAmount > 0, "Invalid asset amount");
        require(paymentAmount > 0, "Invalid payment amount");
        require(expiryBlock > block.number, "Expiry block in past");
        require(
            complianceModule.isEligible(buyer, jurisdiction, requiredCategory),
            "Buyer not eligible"
        );
        require(
            complianceModule.isEligible(seller, jurisdiction, requiredCategory),
            "Seller not eligible"
        );

        settlementId = keccak256(abi.encodePacked(buyer, seller, block.number));
        require(settlements[settlementId].buyer == address(0), "Settlement exists");

        bytes32 holdId = keccak256(abi.encodePacked(settlementId, "hold"));

        IHoldToken(assetToken).createHold(
            holdId,
            seller,
            address(this),
            assetAmount,
            expiryBlock
        );

        settlements[settlementId] = Settlement({
            assetToken: assetToken,
            assetAmount: assetAmount,
            paymentToken: paymentToken,
            paymentAmount: paymentAmount,
            buyer: buyer,
            seller: seller,
            expiryBlock: expiryBlock,
            holdId: holdId,
            buyerCommitted: false,
            sellerCommitted: false,
            status: SettlementStatus.Pending
        });

        emit DvPCreated(
            settlementId,
            buyer,
            seller,
            assetAmount,
            paymentAmount
        );
    }

    function commit(bytes32 settlementId) external {
        Settlement storage settlement = settlements[settlementId];

        require(settlement.buyer != address(0), "Settlement does not exist");
        require(settlement.status == SettlementStatus.Pending, "Settlement not committable");

        if (msg.sender == settlement.buyer) {
            require(!settlement.buyerCommitted, "Buyer already committed");

            IERC20(settlement.paymentToken).transferFrom(
                settlement.buyer,
                address(this),
                settlement.paymentAmount
            );
            settlement.buyerCommitted = true;
        } else if (msg.sender == settlement.seller) {
            require(!settlement.sellerCommitted, "Seller already committed");
            settlement.sellerCommitted = true;
        } else {
            revert("Caller is not a party");
        }

        if (settlement.buyerCommitted && settlement.sellerCommitted) {
            settlement.status = SettlementStatus.BothCommitted;
        }

        emit PartyCommitted(settlementId, msg.sender);
    }

    function finalise(bytes32 settlementId) external {
        Settlement storage settlement = settlements[settlementId];

        require(settlement.buyer != address(0), "Settlement does not exist");
        require(
            settlement.status == SettlementStatus.BothCommitted,
            "Settlement not ready"
        );

        IHoldToken(settlement.assetToken).executeHold(
            settlement.holdId,
            settlement.buyer
        );
        IERC20(settlement.paymentToken).transfer(
            settlement.seller,
            settlement.paymentAmount
        );

        settlement.status = SettlementStatus.Finalised;

        emit DvPFinalised(settlementId);
    }

    function abort(bytes32 settlementId) external {
        Settlement storage settlement = settlements[settlementId];

        require(settlement.buyer != address(0), "Settlement does not exist");
        require(block.number > settlement.expiryBlock, "Settlement not expired");
        require(
            settlement.status == SettlementStatus.Pending ||
                settlement.status == SettlementStatus.BothCommitted,
            "Settlement not abortable"
        );

        IHoldToken(settlement.assetToken).releaseHold(settlement.holdId);

        if (settlement.buyerCommitted) {
            IERC20(settlement.paymentToken).transfer(
                settlement.buyer,
                settlement.paymentAmount
            );
        }

        settlement.status = SettlementStatus.Aborted;

        emit DvPAborted(settlementId);
    }
}
