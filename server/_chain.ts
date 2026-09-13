import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import daoArtifact from "../src/abi/DearmersDAO.json" with { type: "json" };
import registryArtifact from "../src/abi/DearmersRegistry.json" with { type: "json" };
import { HttpError } from "./_http.js";

export const daoAbi = daoArtifact.abi as Abi;
export const registryAbi = registryArtifact.abi as Abi;
export const baseClient = () => createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_RPC_URL || "https://sepolia.base.org", { timeout: 12_000 }) });
export function baseSigner(keyName: string) {
  const key = process.env[keyName];
  if (!key) throw new HttpError(503, `${keyName} is not configured.`);
  return createWalletClient({ account: privateKeyToAccount(key as Hex), chain: baseSepolia, transport: http(process.env.BASE_RPC_URL || "https://sepolia.base.org", { timeout: 12_000 }) });
}
export type ChainProposal = { proposer: Address; recipient: Address; amount: bigint; kind: number; status: number; votingEndsAt: bigint; yesWeight: bigint; noWeight: bigint; executionHash: Hex; constitutionVersion: bigint };
export async function chainProposal(address: Address, proposalId: bigint) {
  return await baseClient().readContract({ address, abi: daoAbi, functionName: "getProposal", args: [proposalId] }) as ChainProposal;
}
export async function confirmed(hash: Hex) {
  const receipt = await baseClient().waitForTransactionReceipt({ hash, timeout: 15_000 });
  if (receipt.status !== "success") throw new HttpError(409, "The Base transaction reverted.");
  return receipt;
}
