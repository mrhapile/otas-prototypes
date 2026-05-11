// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

enum HoldStatus {
    Created,
    Executed,
    Released,
    Reclaimed
}

struct Hold {
    address holder;
    address notary;
    uint256 amount;
    uint256 expiry;
    HoldStatus status;
}

contract HoldToken is ERC20, Ownable {
    uint256 private constant TIMESTAMP_EXPIRY_THRESHOLD = 1_000_000_000;

    mapping(bytes32 => Hold) public holds;
    mapping(address => uint256) private _lockedBalances;

    event HoldCreated(
        bytes32 indexed holdId,
        address indexed holder,
        address indexed notary,
        uint256 amount,
        uint256 expiry
    );
    event HoldExecuted(bytes32 indexed holdId, address to);
    event HoldReleased(bytes32 indexed holdId);
    event HoldReclaimed(bytes32 indexed holdId);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    function createHold(
        bytes32 holdId,
        address holder,
        address notary,
        uint256 amount,
        uint256 expiry
    ) external {
        require(holds[holdId].holder == address(0), "Hold already exists");
        require(holder != address(0), "Invalid holder");
        require(notary != address(0), "Invalid notary");
        require(amount > 0, "Invalid amount");
        require(_isFutureExpiry(expiry), "Expiry in past");
        require(availableBalanceOf(holder) >= amount, "Insufficient available balance");

        if (msg.sender != holder) {
            _spendAllowance(holder, msg.sender, amount);
        }

        holds[holdId] = Hold({
            holder: holder,
            notary: notary,
            amount: amount,
            expiry: expiry,
            status: HoldStatus.Created
        });

        _lockedBalances[holder] += amount;

        emit HoldCreated(holdId, holder, notary, amount, expiry);
    }

    function executeHold(bytes32 holdId, address to) external {
        Hold storage hold = holds[holdId];

        require(hold.holder != address(0), "Hold does not exist");
        require(msg.sender == hold.notary, "Caller is not the notary");
        require(hold.status == HoldStatus.Created, "Hold not executable");
        require(!_isExpired(hold.expiry), "Hold expired");

        _lockedBalances[hold.holder] -= hold.amount;
        hold.status = HoldStatus.Executed;

        _transfer(hold.holder, to, hold.amount);

        emit HoldExecuted(holdId, to);
    }

    function releaseHold(bytes32 holdId) external {
        Hold storage hold = holds[holdId];

        require(hold.holder != address(0), "Hold does not exist");
        require(
            msg.sender == hold.holder || msg.sender == hold.notary,
            "Caller cannot release hold"
        );
        require(hold.status == HoldStatus.Created, "Hold not releasable");

        _lockedBalances[hold.holder] -= hold.amount;
        hold.status = HoldStatus.Released;

        emit HoldReleased(holdId);
    }

    function reclaimHold(bytes32 holdId) external {
        Hold storage hold = holds[holdId];

        require(hold.holder != address(0), "Hold does not exist");
        require(hold.status == HoldStatus.Created, "Hold not reclaimable");
        require(_isExpired(hold.expiry), "Hold not expired");

        _lockedBalances[hold.holder] -= hold.amount;
        hold.status = HoldStatus.Reclaimed;

        emit HoldReclaimed(holdId);
    }

    function availableBalanceOf(address holder) public view returns (uint256) {
        return balanceOf(holder) - _lockedBalances[holder];
    }

    function lockedBalanceOf(address holder) public view returns (uint256) {
        return _lockedBalances[holder];
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(
            availableBalanceOf(msg.sender) >= amount,
            "Insufficient available balance"
        );

        return super.transfer(to, amount);
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        require(
            availableBalanceOf(from) >= amount,
            "Insufficient available balance"
        );

        return super.transferFrom(from, to, amount);
    }

    function _isExpired(uint256 expiry) internal view returns (bool) {
        if (expiry >= TIMESTAMP_EXPIRY_THRESHOLD) {
            return expiry <= block.timestamp;
        }

        return expiry <= block.number;
    }

    function _isFutureExpiry(uint256 expiry) internal view returns (bool) {
        if (expiry >= TIMESTAMP_EXPIRY_THRESHOLD) {
            return expiry > block.timestamp;
        }

        return expiry > block.number;
    }
}
