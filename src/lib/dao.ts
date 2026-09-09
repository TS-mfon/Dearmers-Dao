import { createPublicClient, createWalletClient, custom, getAddress, http, isAddress, keccak256, stringToHex, type Address, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import registryArtifact from "../abi/DearmersRegistry.json";
import daoArtifact from "../abi/DearmersDAO.json";
const registryAbi = registryArtifact.abi;
const daoAbi = daoArtifact.abi;

export function normalizeConfiguredAddress(value: unknown, name: string): Address {
  const raw = String(value || "").trim();
  if (!raw || !isAddress(raw, { strict: false })) throw new Error(`${name} is not a valid EVM address. Check for trailing spaces or an incorrect value.`);
  return getAddress(raw.toLowerCase());
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const REGISTRY_ADDRESS = import.meta.env.VITE_DEARMERS_REGISTRY ? normalizeConfiguredAddress(import.meta.env.VITE_DEARMERS_REGISTRY, "VITE_DEARMERS_REGISTRY") : "" as Address;
export const BASE_RPC_URL = import.meta.env.VITE_BASE_RPC_URL || "https://sepolia.base.org";
export const USDC_ADDRESS = normalizeConfiguredAddress(import.meta.env.VITE_USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "VITE_USDC_TOKEN_ADDRESS");
export const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC_URL) });

type InjectedProvider = {
  isMetaMask?: boolean;
  isRabby?: boolean;
  providers?: InjectedProvider[];
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function injectedProvider(): InjectedProvider {
  const injected = (window as unknown as { ethereum?: InjectedProvider }).ethereum;
  if (!injected) throw new Error("Install MetaMask to connect a wallet.");
  const providers = injected.providers?.length ? injected.providers : [injected];
  return providers.find((provider) => provider.isMetaMask && !provider.isRabby) || providers[0];
}

export async function ensureBaseSepolia(provider: InjectedProvider = injectedProvider()) {
  const targetChainId = `0x${baseSepolia.id.toString(16)}`;
  const currentChainId = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (currentChainId === targetChainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainId }] });
  } catch (error) {
    const code = String((error as { code?: number | string }).code || "");
    if (code !== "4902") throw new Error("Switch your wallet to Base Sepolia to continue.", { cause: error });
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: targetChainId,
        chainName: "Base Sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [BASE_RPC_URL],
        blockExplorerUrls: ["https://sepolia.basescan.org"],
      }],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainId }] });
  }
}

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

type DaoSource = Partial<DaoRecord> & { metadata?: unknown; logoUrl?: string; bannerUrl?: string };

export function normalizeDaoRecord(source: DaoSource): DaoRecord {
  const metadataValue = typeof source.metadata === "string" ? source.metadata : JSON.stringify(source.metadata || {});
  const metadata = parseDaoMetadata(String(source.metadataUri || metadataValue));
  const record = source as DaoRecord;
  const nested = metadata as Partial<DaoMetadata> & { logoUrl?: string; bannerUrl?: string };
  return {
    ...record,
    daoId: String(source.daoId || "") as Hash,
    name: String(source.name || "Unnamed DAO"),
    metadataUri: String(source.metadataUri || metadataValue),
    logoUri: String(source.logoUri || source.logoUrl || nested.logoUri || nested.logoUrl || "/logo.png"),
    bannerUri: String(source.bannerUri || source.bannerUrl || nested.bannerUri || nested.bannerUrl || "/dreamers-dao-logo.svg"),
    description: source.description || metadata.description || "",
    category: source.category || metadata.category || "",
    mission: source.mission || metadata.mission || "",
    rules: source.rules || metadata.rules || "",
    constitution: source.constitution || metadata.constitution || "",
    tags: source.tags || metadata.tags || [],
    access: source.access || metadata.access || "public",
    treasuryPolicy: source.treasuryPolicy || metadata.treasuryPolicy,
    gateChain: source.gateChain || metadata.gate?.chain,
    gateAsset: source.gateAsset || metadata.gate?.asset,
    gateStandard: source.gateStandard || metadata.gate?.standard,
    gateName: source.gateName || metadata.gate?.name,
    gateSymbol: source.gateSymbol || metadata.gate?.symbol,
  };
}

export async function walletClient() {
  const provider = injectedProvider();
  await ensureBaseSepolia(provider);
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
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
  const reviewOracle = normalizeConfiguredAddress(input.reviewOracle, "Review oracle address");
  const executor = normalizeConfiguredAddress(input.executor, "Automation executor address");
  const daoId = createDaoId(input.name, admin);
  const hash = await client.writeContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "createDAO",
    args: [daoId, input.treasury, input.mode === "grant" ? 1 : 0, reviewOracle, executor, input.name.trim(), input.metadataUri.trim()],
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
  const indexed = await fetch("/api/daos").then(async (response) => {
    if (!response.ok) return [] as Array<Partial<DaoRecord> & { metadata?: unknown; logoUrl?: string; bannerUrl?: string }>;
    const body = await response.json() as { daos?: Array<Partial<DaoRecord> & { metadata?: unknown; logoUrl?: string; bannerUrl?: string }> };
    return body.daos || [];
  }).catch(() => [] as Array<Partial<DaoRecord> & { metadata?: unknown; logoUrl?: string; bannerUrl?: string }>);
  const indexedById = new Map(indexed.map((record) => [String(record.daoId).toLowerCase(), normalizeDaoRecord(record)]));
  return records.map((record) => {
    const indexedRecord = indexedById.get(String(record.daoId).toLowerCase());
    return normalizeDaoRecord({ ...record, ...indexedRecord, metadataUri: indexedRecord?.metadataUri || record.metadataUri });
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
