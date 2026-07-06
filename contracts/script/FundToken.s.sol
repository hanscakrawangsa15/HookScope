// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Fund any ERC20 token balance for a target address by finding and writing
/// to the correct storage slot automatically via stdstore.
/// This works regardless of the token's storage layout.
///
/// Usage:
///   forge script script/FundToken.s.sol --sig "run(address,address,uint256)" \
///     <token> <recipient> <amount> --rpc-url http://127.0.0.1:8545 --broadcast
contract FundToken is Script {
    using stdStorage for StdStorage;

    function run(address token, address recipient, uint256 amount) external {
        vm.startBroadcast();
        stdstore.target(token).sig(IERC20.balanceOf.selector).with_key(recipient).checked_write(amount);
        vm.stopBroadcast();

        uint256 bal = IERC20(token).balanceOf(recipient);
        console.log("Token:", token);
        console.log("Recipient:", recipient);
        console.log("New balance:", bal);
        require(bal >= amount, "FundToken: balance not set correctly");
    }
}
