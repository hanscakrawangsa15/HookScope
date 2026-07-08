"use client";
/**
 * Anvil-specific utilities for Demo Mode.
 * Uses Anvil's debug RPC methods to perform transactions without MetaMask
 * signatures — only safe on chainId 31337 (local fork).
 */

const ANVIL_RPC = "http://127.0.0.1:8545";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const POSITION_MANAGER = "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e"; // Mainnet / Anvil fork

// Well-known Anvil Account 0 (10000 ETH on any fork) — public key from Foundry docs.
const ACCOUNT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ACCOUNT0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

async function anvilRpc(method: string, params: unknown[]): Promise<{ result?: unknown; error?: { message: string } }> {
  const res = await fetch(ANVIL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

/** Send an impersonated tx, force-mine it, then check the receipt succeeds. */
async function anvilSendAndMine(from: string, to: string, data: string, gas = "0x50000"): Promise<void> {
  const sent = await anvilRpc("eth_sendTransaction", [{ from, to, data, gas }]);
  if (sent.error) throw new Error(`TX send failed: ${sent.error.message}`);

  // Force immediate mining so state is visible before next call
  await anvilRpc("evm_mine", []);

  // Confirm the tx succeeded (status=0x1)
  const receipt = await anvilRpc("eth_getTransactionReceipt", [sent.result]) as
    { result?: { status: string } | null; error?: { message: string } };

  if (!receipt.result) throw new Error("TX não encontrada no receipt após mining");
  if (receipt.result.status !== "0x1") {
    throw new Error(`TX reverted (status=0). Impersonated tx gagal.`);
  }
}

/** Check ETH balance of an address on Anvil. */
async function getEthBalance(address: string): Promise<bigint> {
  const r = await anvilRpc("eth_getBalance", [address, "latest"]);
  return r.result ? BigInt(r.result as string) : 0n;
}

/**
 * Ensure the wallet has enough ETH on Anvil to cover a LP/swap transaction.
 * Sends ETH from Account 0 (always pre-funded by Anvil) if needed.
 *
 * `minRequired` = minimum ETH needed (default: 1000 ETH so any LP position fits).
 * In Demo Mode users can deposit any amount, so we fund generously — it's fake ETH anyway.
 */
export async function demoEnsureGas(userAddress: string, minRequired = 1000): Promise<void> {
  if (userAddress.toLowerCase() === ACCOUNT0.toLowerCase()) return; // already funded

  const balance = await getEthBalance(userAddress);
  const minWei = BigInt(minRequired) * 10n ** 18n;
  if (balance >= minWei) return; // already has enough

  const { createWalletClient, http, parseEther } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { anvil: anvilChain } = await import("viem/chains");

  const account = privateKeyToAccount(ACCOUNT0_KEY);
  const wallet = createWalletClient({ account, chain: anvilChain, transport: http(ANVIL_RPC) });
  // Fund with minRequired + 100 ETH buffer for gas
  await wallet.sendTransaction({
    to: userAddress as `0x${string}`,
    value: parseEther(String(minRequired + 100)),
  });
}

/**
 * Approve token for Permit2 (ERC20.approve) + set Permit2 allowance for PositionManager.
 * Both steps are done via Anvil impersonation — no MetaMask popup required.
 *
 * Permit2 two-step flow:
 *   1. ERC20.approve(Permit2, maxUint256)            → selector 0x095ea7b3
 *   2. Permit2.approve(token, PositionManager, max, expiryFarFuture) → selector below
 *
 * Without step 2, PositionManager can't pull tokens even after step 1.
 */
export async function demoAutoApprove(tokenAddress: string, userAddress: string): Promise<void> {
  await demoEnsureGas(userAddress);

  await anvilRpc("anvil_impersonateAccount", [userAddress]);

  // Step 1: ERC20.approve(Permit2, maxUint256) — selector 0x095ea7b3
  const erc20Data = "0x095ea7b3"
    + PERMIT2.slice(2).padStart(64, "0")
    + "f".repeat(64); // maxUint256

  // Step 2: Permit2.approve(token, PositionManager, maxUint160, maxUint48)
  // selector: keccak256("approve(address,address,uint160,uint48)")[0:4] = 0x87517c45
  // maxUint160 = 2^160-1 = 20 bytes = 40 hex f's, padded left to 32 bytes
  // maxUint48  = 2^48-1  =  6 bytes = 12 hex f's, padded left to 32 bytes (~year 8921)
  const MAX_UINT160 = "000000000000000000000000" + "f".repeat(40);
  const MAX_UINT48  = "0".repeat(52) + "f".repeat(12);
  const permit2Data = "0x87517c45"
    + tokenAddress.slice(2).padStart(64, "0")
    + POSITION_MANAGER.slice(2).padStart(64, "0")
    + MAX_UINT160
    + MAX_UINT48;

  try {
    // Send + mine + verify receipt for each tx so state is confirmed before next step
    await anvilSendAndMine(userAddress, tokenAddress, erc20Data);
    await anvilSendAndMine(userAddress, PERMIT2, permit2Data);
  } finally {
    await anvilRpc("anvil_stopImpersonatingAccount", [userAddress]);
  }
}

/**
 * Fund the connected wallet with 10 ETH from Account 0 for Demo Mode gas.
 * Called by the DemoModeToggle "Fund Wallet" button.
 */
export async function demoFundWallet(userAddress: string): Promise<void> {
  if (userAddress.toLowerCase() === ACCOUNT0.toLowerCase()) return;
  await demoEnsureGas(userAddress);
}

/**
 * Fund any ERC20 token balance via direct storage slot override.
 *
 * Tries slot indices 0–9 (OZ standard is slot 0, but proxy/diamond contracts
 * may use higher slots). Verifies by reading balanceOf after each write.
 * No whale, no impersonation, no mining — instant effect.
 */
export async function demoFundToken(tokenAddress: string, userAddress: string, amount: bigint): Promise<void> {
  const { keccak256 } = await import("viem");
  const amountHex = amount.toString(16).padStart(64, "0");
  const paddedAddr = userAddress.slice(2).toLowerCase().padStart(64, "0");

  // balanceOf(address) = selector 0x70a08231
  const balData = `0x70a08231${userAddress.slice(2).toLowerCase().padStart(64, "0")}`;

  for (let slotIdx = 0; slotIdx <= 9; slotIdx++) {
    const paddedSlot = slotIdx.toString(16).padStart(64, "0");
    const slot = keccak256(`0x${paddedAddr}${paddedSlot}` as `0x${string}`);

    await anvilRpc("anvil_setStorageAt", [tokenAddress, slot, `0x${amountHex}`]);

    // B2-fix: Safely verify by checking result type before BigInt conversion.
    // check.result can be undefined (eth_call revert at JSON-RPC level) or "0x"
    // (empty returndata). BigInt(undefined) throws TypeError; BigInt("0x") throws
    // SyntaxError. Guard against both before attempting conversion.
    const check = await anvilRpc("eth_call", [{ to: tokenAddress, data: balData }, "latest"]);
    const result = typeof check.result === "string" ? check.result : null;
    if (result && result !== "0x" && result !== "0x0" && result.length > 2) {
      try {
        if (BigInt(result as string) > 0n) return; // success
      } catch { /* malformed returndata — not a standard ERC20, try next slot */ }
    }

    // Didn't work — reset slot and try next
    await anvilRpc("anvil_setStorageAt", [tokenAddress, slot, `0x${"0".repeat(64)}`]);
  }
  throw new Error(`demoFundToken: could not find balance storage slot for ${tokenAddress}. Token may use non-standard layout.`);
}

/**
 * Transfer test ERC20 tokens from Account 0 to target address.
 * Account 0 receives tokens from `pnpm anvil:setup`.
 */
export async function demoFundERC20(tokenAddress: string, toAddress: string, amount: bigint): Promise<void> {
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { anvil: anvilChain } = await import("viem/chains");

  const account = privateKeyToAccount(ACCOUNT0_KEY);
  const wallet = createWalletClient({ account, chain: anvilChain, transport: http(ANVIL_RPC) });
  const transferAbi = [{
    name: "transfer", type: "function" as const, stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  }] as const;
  await wallet.writeContract({ address: tokenAddress as `0x${string}`, abi: transferAbi, functionName: "transfer", args: [toAddress as `0x${string}`, amount] });
}
