import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import { createPublicClient, createWalletClient, custom, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

export const USDC_BASE_SEPOLIA = (import.meta.env.VITE_USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
export const executorAddress = (import.meta.env.VITE_DEARMERS_EXECUTOR_ADDRESS || "") as Address;
export const publicClient = createPublicClient({ chain: baseSepolia, transport: http(import.meta.env.VITE_BASE_RPC_URL || "https://sepolia.base.org") });

type Eip1193Provider = {
  isMetaMask?: boolean;
  isRabby?: boolean;
  providers?: Eip1193Provider[];
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function walletProviders(): Eip1193Provider[] {
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!injected) return [];
  return injected.providers?.length ? injected.providers : [injected];
}

function selectMetaMask(): Eip1193Provider {
  const providers = walletProviders();
  if (!providers.length) throw new Error("MetaMask is required to create a treasury delegation. Install MetaMask and try again.");
  const provider = providers.find((candidate) => candidate.isMetaMask && !candidate.isRabby);
  if (!provider) {
    if (providers.some((candidate) => candidate.isRabby)) throw new Error("Rabby does not support ERC-7715 delegations. Select MetaMask in your wallet extension and try again.");
    throw new Error("This wallet does not support ERC-7715 delegations. Use the MetaMask browser extension, not Rabby.");
  }
  return provider;
}

export async function assertDelegationSupport(provider: Eip1193Provider) {
  try {
    const supported = await provider.request({ method: "wallet_getSupportedExecutionPermissions", params: [] });
    if (!supported || typeof supported !== "object" || Object.keys(supported as object).length === 0) throw new Error("MetaMask returned no supported execution permission types.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("does not exist") || message.includes("not available") || message.includes("has no corresponding handler")) throw new Error("Your MetaMask version does not support ERC-7715 delegations. Update MetaMask, unlock it, and retry.", { cause: error });
    throw new Error(`MetaMask cannot create ERC-7715 delegations: ${message}`, { cause: error });
  }
}

export async function requestDelegationPermissions(treasuryAddress: Address, limitAmount: bigint, delegateAddress: Address = executorAddress) {
  const ethereum = selectMetaMask();
  if (!delegateAddress) throw new Error("VITE_DEARMERS_EXECUTOR_ADDRESS is not configured.");
  if (limitAmount <= 0n) throw new Error("The weekly delegation limit must be greater than zero.");
  await assertDelegationSupport(ethereum);
  const wallet = createWalletClient({ chain: baseSepolia, transport: custom(ethereum as never) }).extend(erc7715ProviderActions());
  const currentTime = Math.floor(Date.now() / 1000);
  try {
    return await wallet.requestExecutionPermissions([{
      from: treasuryAddress,
      chainId: baseSepolia.id,
      expiry: currentTime + 365 * 24 * 60 * 60,
      to: delegateAddress,
      permission: { type: "erc20-token-periodic", isAdjustmentAllowed: false, data: { tokenAddress: USDC_BASE_SEPOLIA, periodAmount: limitAmount, periodDuration: 7 * 24 * 60 * 60, startTime: currentTime } } as never,
    }]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("User rejected") || message.includes("rejected")) throw new Error("The MetaMask delegation request was cancelled.", { cause: error });
    if (message.includes("does not exist") || message.includes("not available") || message.includes("has no corresponding handler")) throw new Error("MetaMask did not expose ERC-7715 delegation support. Update MetaMask and ensure the MetaMask extension is the selected wallet.", { cause: error });
    throw new Error(`MetaMask delegation request failed: ${message}`, { cause: error });
  }
}
