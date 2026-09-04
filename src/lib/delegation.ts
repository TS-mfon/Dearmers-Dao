import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import { createPublicClient, createWalletClient, custom, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

export const USDC_BASE_SEPOLIA = (import.meta.env.VITE_USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
export const executorAddress = (import.meta.env.VITE_DEARMERS_EXECUTOR_ADDRESS || "") as Address;
export const publicClient = createPublicClient({ chain: baseSepolia, transport: http(import.meta.env.VITE_BASE_RPC_URL || "https://sepolia.base.org") });

export async function requestDelegationPermissions(treasuryAddress: Address, limitAmount: bigint, delegateAddress: Address = executorAddress) {
  const ethereum = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!ethereum) throw new Error("MetaMask is required to create a treasury delegation.");
  if (!delegateAddress) throw new Error("VITE_DEARMERS_EXECUTOR_ADDRESS is not configured.");
  if (limitAmount <= 0n) throw new Error("The weekly delegation limit must be greater than zero.");
  const wallet = createWalletClient({ chain: baseSepolia, transport: custom(ethereum as never) }).extend(erc7715ProviderActions());
  const currentTime = Math.floor(Date.now() / 1000);
  return wallet.requestExecutionPermissions([{
    from: treasuryAddress,
    chainId: baseSepolia.id,
    expiry: currentTime + 365 * 24 * 60 * 60,
    to: delegateAddress,
    permission: { type: "erc20-token-periodic", isAdjustmentAllowed: false, data: { tokenAddress: USDC_BASE_SEPOLIA, periodAmount: limitAmount, periodDuration: 7 * 24 * 60 * 60, startTime: currentTime } } as never,
  }]);
}
