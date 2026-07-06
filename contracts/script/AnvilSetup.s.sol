// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TestToken} from "../src/TestToken.sol";

/// Deploy two ERC20 test tokens on a local Anvil mainnet fork, mint a generous
/// supply to the default Anvil test account, and approve both the Uniswap v4
/// PoolManager and Permit2 so the HookScope LP/Swap UI can send transactions
/// immediately without a separate approval step.
///
/// Run:
///   pnpm anvil:setup
///   (which calls: forge script script/AnvilSetup.s.sol --rpc-url http://127.0.0.1:8545 --broadcast ...)
///
/// Outputs token addresses and instructions to stdout.
contract AnvilSetup is Script {
    // Uniswap v4 mainnet addresses — available on the fork at the same addresses.
    address constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // First Anvil funded test account (well-known dev key, never use on mainnet).
    address constant TEST_ACCOUNT = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    function run() external {
        uint256 deployerKey = vm.envUint("ANVIL_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Deploy token A (18 decimals) and token B (6 decimals — mimics USDC).
        TestToken tokenA = new TestToken("Test Token A", "TTKA", 18);
        TestToken tokenB = new TestToken("Test Token B", "TTKB", 6);

        // Sort addresses so token0 < token1, as required by Uniswap v4.
        address addr0 = address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB);
        address addr1 = address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA);

        // Mint generous amounts.
        tokenA.mint(deployer, 10_000 ether);
        tokenA.mint(TEST_ACCOUNT, 10_000 ether);
        tokenB.mint(deployer, 10_000_000 * 1e6);   // 10M TTKB (6 dec)
        tokenB.mint(TEST_ACCOUNT, 10_000_000 * 1e6);

        // Approve PoolManager + Permit2 for max amount, so HookScope's LP flow
        // doesn't require a separate approval transaction during testing.
        tokenA.approve(POOL_MANAGER, type(uint256).max);
        tokenA.approve(PERMIT2, type(uint256).max);
        tokenB.approve(POOL_MANAGER, type(uint256).max);
        tokenB.approve(PERMIT2, type(uint256).max);

        vm.stopBroadcast();

        console.log("=== HookScope Anvil Test Tokens ===");
        console.log("Token A (TTKA, 18 dec):", address(tokenA));
        console.log("Token B (TTKB,  6 dec):", address(tokenB));
        console.log("currency0 (lower addr):", addr0);
        console.log("currency1 (higher addr):", addr1);
        console.log("Deployer / funded:", deployer);
        console.log("");
        console.log("Next step: run pnpm anvil:test to verify Swap + LP.");
        console.log("Or in HookScope UI: add chainId 31337 hook manually");
        console.log("using hook address 0x0000...0000 (no hook) and the above currency pair.");

        // Write a JSON file that scripts/anvil-test.ts can read.
        string memory json = string(abi.encodePacked(
            '{"tokenA":"', vm.toString(address(tokenA)), '"',
            ',"tokenB":"', vm.toString(address(tokenB)), '"',
            ',"currency0":"', vm.toString(addr0), '"',
            ',"currency1":"', vm.toString(addr1), '"',
            ',"deployer":"', vm.toString(deployer), '"',
            ',"poolManager":"', vm.toString(POOL_MANAGER), '"',
            ',"positionManager":"', vm.toString(POSITION_MANAGER), '"',
            ',"permit2":"', vm.toString(PERMIT2), '"',
            '}'
        ));
        vm.writeFile("out/anvil-addresses.json", json);
        console.log("Wrote addresses to contracts/out/anvil-addresses.json");
    }
}
