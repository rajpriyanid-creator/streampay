// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockBadToken
 * @notice Token that returns false on transfer instead of reverting. For testing fallback credit logic.
 */
contract MockBadToken is ERC20 {
    bool public shouldFail;

    constructor() ERC20("Bad Token", "BAD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (shouldFail) return false;
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (shouldFail) return false;
        return super.transferFrom(from, to, amount);
    }
}
