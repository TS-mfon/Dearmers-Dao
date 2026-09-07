import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { base, mainnet } from "viem/chains";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";

const stringAbi = (name: string) => [{ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;
const decimalsAbi = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const;
const interfaceAbi = [{ type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] }] as const;

const chains = {
  ethereum: { id: 1, chain: mainnet, rpc: process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io" },
  base: { id: 8453, chain: base, rpc: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org", explorer: "https://basescan.org" },
} as const;

async function optionalRead<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try { return await read(); } catch { return fallback; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET"])) return;
  try {
    const address = String(req.query.address || "");
    const chainName = String(req.query.chain || "base") as keyof typeof chains;
    const config = chains[chainName];
    if (!config) return json(res, 400, { error: "Choose Ethereum or Base." });
    if (!isAddress(address)) return json(res, 400, { error: "Enter a valid token or NFT contract address." });

    const normalized = address.toLowerCase();
    const db = await database().catch(() => null);
    const cached = await db?.collection("assetMetadata").findOne({ chain: chainName, address: normalized, expiresAt: { $gt: new Date() } });
    if (cached) return json(res, 200, { ...cached, _id: undefined, source: "cache" });

    const client = createPublicClient({ chain: config.chain, transport: http(config.rpc) });
    const code = await client.getCode({ address: address as Address });
    if (!code || code === "0x") return json(res, 404, { error: `No contract was found at this address on ${chainName === "base" ? "Base" : "Ethereum"}.` });

    const read = (parameters: unknown) => client.readContract(parameters as never) as Promise<unknown>;
    const is721 = await optionalRead(() => read({ address: address as Address, abi: interfaceAbi, functionName: "supportsInterface", args: ["0x80ac58cd"] }) as Promise<boolean>, false);
    const is1155 = await optionalRead(() => read({ address: address as Address, abi: interfaceAbi, functionName: "supportsInterface", args: ["0xd9b67a26"] }) as Promise<boolean>, false);
    const name = await optionalRead(() => read({ address: address as Address, abi: stringAbi("name"), functionName: "name" }) as Promise<string>, "Unknown asset");
    const symbol = await optionalRead(() => read({ address: address as Address, abi: stringAbi("symbol"), functionName: "symbol" }) as Promise<string>, "");
    const decimals = is721 || is1155 ? null : await optionalRead(() => read({ address: address as Address, abi: decimalsAbi, functionName: "decimals" }) as Promise<number>, null);
    let standard = is1155 ? "ERC-1155" : is721 ? "ERC-721" : decimals !== null ? "ERC-20" : "Contract";
    let source = "rpc";
    let contractName = "";

    if (standard === "Contract" && process.env.ETHERSCAN_API_KEY) {
      const url = `https://api.etherscan.io/v2/api?chainid=${config.id}&module=contract&action=getsourcecode&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}`;
      const response = await fetch(url, { headers: { accept: "application/json" } });
      const payload = await response.json() as { result?: Array<{ ContractName?: string; ABI?: string }> };
      contractName = payload.result?.[0]?.ContractName || "";
      if (contractName) source = "rpc+etherscan";
      if (/721|nft/i.test(contractName)) standard = "ERC-721";
      if (/1155/i.test(contractName)) standard = "ERC-1155";
      if (/token|erc20/i.test(contractName)) standard = "ERC-20";
    }

    const asset = { chain: chainName, chainId: config.id, address: normalized, name: name || contractName || "Unknown asset", symbol, standard, decimals, explorerUrl: `${config.explorer}/address/${address}`, source, verified: Boolean(contractName), updatedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
    await db?.collection("assetMetadata").updateOne({ chain: chainName, address: normalized }, { $set: asset }, { upsert: true });
    return json(res, 200, asset);
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
