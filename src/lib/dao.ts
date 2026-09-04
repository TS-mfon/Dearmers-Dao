import { createPublicClient, createWalletClient, custom, http, keccak256, stringToHex, type Address, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import registryAbi from "../abi/DearmersRegistry.json";
import daoAbi from "../abi/DearmersDAO.json";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const REGISTRY_ADDRESS = (import.meta.env.VITE_DEARMERS_REGISTRY || "") as Address;
export const BASE_RPC_URL = import.meta.env.VITE_BASE_RPC_URL || "https://sepolia.base.org";
export const USDC_ADDRESS = (import.meta.env.VITE_USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
export const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC_URL) });

export type DaoMode = "operating" | "grant";
export type MembershipMode = "public" | "whitelist" | "token";

export interface DaoMetadata {
  version: number;
  description: string;
  mission: string;
  rules: string;
  constitution: string;
  category: string;
  tags: string[];
  access: "public" | "whitelist" | "private" | "token" | "nft";
  logoUri: string;
  bannerUri: string;
  gate: { chain: string; asset: string; standard: string; name: string; symbol: string };
  treasuryPolicy: { weeklyUsdcLimit: string; token: string; executor: string };
  createdBy: string;
}

export interface DaoRecord {
  daoId: Hash;
  admin: Address;
  dao: Address;
  treasury: Address;
  mode: number;
  name: string;
  metadataUri: string;
  description?: string;
  category?: string;
  logoUri?: string;
  bannerUri?: string;
  gateChain?: string;
  gateAsset?: string;
  gateStandard?: string;
  gateName?: string;
  gateSymbol?: string;
  mission?: string;
  rules?: string;
  constitution?: string;
  tags?: string[];
  access?: DaoMetadata["access"];
  treasuryPolicy?: DaoMetadata["treasuryPolicy"];
  active: boolean;
}

export function parseDaoMetadata(value: string): Partial<DaoMetadata> {
  if (!value || !value.trim().startsWith("{")) return {};
  try {
    const parsed = JSON.parse(value) as Partial<DaoMetadata>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function walletClient() {
  if (!(window as unknown as { ethereum?: unknown }).ethereum) throw new Error("MetaMask is not installed.");
  const provider = (window as unknown as { ethereum: { request(args: { method: string }): Promise<string[]> } }).ethereum;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts[0]) throw new Error("Connect a wallet before continuing.");
  return createWalletClient({ chain: baseSepolia, account: accounts[0] as Address, transport: custom(provider as never) });
}

export async function connectedAccount(): Promise<Address> {
  const client = await walletClient();
  if (!client.account) throw new Error("Wallet account unavailable.");
  return client.account.address;
}

export function createDaoId(name: string, admin: Address): Hash {
  return keccak256(stringToHex(`${name.trim().toLowerCase()}:${admin}:${crypto.randomUUID()}`));
}

export async function createDao(input: { name: string; mode: DaoMode; treasury: Address; reviewOracle: Address; executor: Address; metadataUri: string }) {
  requireRegistry();
  const client = await walletClient();
  const admin = client.account!.address;
  const daoId = createDaoId(input.name, admin);
  const hash = await client.writeContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "createDAO",
    args: [daoId, input.treasury, input.mode === "grant" ? 1 : 0, input.reviewOracle, input.executor, input.name.trim(), input.metadataUri.trim()],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("DAO creation reverted on Base Sepolia.");
  const record = await getDao(daoId);
  if (!record.dao || record.dao === ZERO_ADDRESS) throw new Error("DAO transaction confirmed but registry record was not found.");
  return { hash, daoId, daoAddress: record.dao };
}

export async function getDaoIds(offset = 0n, limit = 100n): Promise<Hash[]> {
  requireRegistry();
  return publicClient.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: "getDAOIds", args: [offset, limit] }) as Promise<Hash[]>;
}

export async function getDao(daoId: Hash): Promise<DaoRecord> {
  requireRegistry();
  const value = await publicClient.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: "getDAO", args: [daoId] });
  return value as unknown as DaoRecord;
}

export async function listDaos(): Promise<DaoRecord[]> {
  const ids = await getDaoIds();
  const records = await Promise.all(ids.map(getDao));
  return records.map((record) => {
    const metadata = parseDaoMetadata(record.metadataUri);
    return {
      ...record,
      description: metadata.description || record.description,
      category: metadata.category || record.category,
      logoUri: metadata.logoUri || record.logoUri,
      bannerUri: metadata.bannerUri || record.bannerUri,
      gateChain: metadata.gate?.chain || record.gateChain,
      gateAsset: metadata.gate?.asset || record.gateAsset,
      gateStandard: metadata.gate?.standard || record.gateStandard,
      gateName: metadata.gate?.name || record.gateName,
      gateSymbol: metadata.gate?.symbol || record.gateSymbol,
      mission: metadata.mission,
      rules: metadata.rules,
      constitution: metadata.constitution,
      tags: metadata.tags,
      access: metadata.access,
      treasuryPolicy: metadata.treasuryPolicy,
    };
  });
}

export async function writeDao(dao: Address, functionName: string, args: readonly unknown[] = []) {
  const client = await walletClient();
  const hash = await client.writeContract({ address: dao, abi: daoAbi, functionName, args } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted on Base Sepolia.`);
  return hash;
}

export async function readDao<T>(dao: Address, functionName: string, args: readonly unknown[] = []): Promise<T> {
  return publicClient.readContract({ address: dao, abi: daoAbi, functionName, args } as never) as Promise<T>;
}

export async function getProposal(dao: Address, proposalId: bigint) {
  return readDao<Record<string, unknown>>(dao, "getProposal", [proposalId]);
}

export async function getGrantRound(dao: Address, roundId: bigint) {
  return readDao<Record<string, unknown>>(dao, "getGrantRound", [roundId]);
}

export async function getApplication(dao: Address, roundId: bigint, applicationId: bigint) {
  return readDao<Record<string, unknown>>(dao, "getGrantApplication", [roundId, applicationId]);
}

export function explainContractError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("User rejected") || message.includes("rejected the request")) return "The wallet request was cancelled.";
  if (message.includes("NotMember")) return "This wallet is not an eligible DAO member.";
  if (message.includes("Unauthorized")) return "This wallet does not have permission for that action.";
  if (message.includes("DeadlinePassed")) return "The action deadline has already passed.";
  if (message.includes("DeadlineNotReached")) return "The action is not available until its deadline.";
  if (message.includes("TreasuryPaused")) return "The DAO treasury is currently paused.";
  if (message.includes("SpendingLimitExceeded")) return "This payment would exceed the active weekly spending limit.";
  if (message.includes("InvalidState")) return "The item is not in the required lifecycle state.";
  if (message.includes("InvalidInput")) return "One or more submitted values violate the DAO rules.";
  return message.length > 260 ? `${message.slice(0, 257)}...` : message;
}

function requireRegistry() {
  if (!REGISTRY_ADDRESS || REGISTRY_ADDRESS === ZERO_ADDRESS) throw new Error("VITE_DEARMERS_REGISTRY is not configured.");
}
