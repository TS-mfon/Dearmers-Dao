import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, createWalletClient, decodeEventLog, getAddress, http, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";

function address(value: unknown) { return String(value || "").trim() as Address; }
const registryAbi = [{ type: "function", name: "createDAOFor", inputs: [{ name: "admin", type: "address" }, { name: "daoId", type: "bytes32" }, { name: "treasury", type: "address" }, { name: "mode", type: "uint8" }, { name: "reviewOracle", type: "address" }, { name: "executor", type: "address" }, { name: "name", type: "string" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "daoAddress", type: "address" }], stateMutability: "nonpayable" }, { type: "event", name: "DAOCreated", inputs: [{ name: "daoId", type: "bytes32", indexed: true }, { name: "dao", type: "address", indexed: true }, { name: "admin", type: "address", indexed: true }, { name: "mode", type: "uint8", indexed: false }, { name: "name", type: "string", indexed: false }] }] as const;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const db = await database();
    if (req.method === "GET") {
      const clientKey = String(req.query.clientKey || "");
      const daoId = String(req.query.daoId || "");
      if (!clientKey && !daoId) return json(res, 400, { error: "A creation key or DAO id is required." });
      const job = await db.collection("daoCreationJobs").findOne(clientKey ? { clientKey, actor: identity.sub } : { daoId, actor: identity.sub }, { projection: { _id: 0 } });
      if (!job) return json(res, 404, { error: "DAO creation job not found." });
      const indexed = Boolean(job.daoAddress && await db.collection("daoIndex").findOne({ daoId: job.daoId }));
      return json(res, 200, { ...job, indexed });
    }
    const body = req.body || {};
    const clientKey = String(body.clientKey || "");
    const name = String(body.name || "").trim();
    const treasury = address(body.treasury);
    const reviewOracle = address(body.reviewOracle);
    const executor = address(body.executor);
    if (!clientKey || !name || !body.metadataUri || ![treasury, reviewOracle, executor].every((value) => isAddress(value))) return json(res, 400, { error: "Complete DAO creation data is required." });
    const existing = await db.collection("daoCreationJobs").findOne({ clientKey });
    if (existing?.daoId && existing?.daoAddress) return json(res, 200, { ...existing, duplicate: true });
    const delegation = await db.collection("delegations").findOne({ creationKey: clientKey, treasury: treasury.toLowerCase(), actor: identity.sub });
    if (!delegation) return json(res, 409, { error: "Complete the treasury delegation before creating the DAO." });
    const registry = address(process.env.DEARMERS_REGISTRY_ADDRESS || process.env.VITE_DEARMERS_REGISTRY);
    const privateKey = process.env.BASE_PLATFORM_SIGNER_PRIVATE_KEY || process.env.BASE_AUTOMATION_PRIVATE_KEY;
    const rpc = process.env.BASE_RPC_URL || "https://sepolia.base.org";
    if (!registry || !privateKey) return json(res, 503, { error: "Platform DAO creation signer is not configured." });
    const daoId = keccak256(stringToHex(`${name.toLowerCase()}:${treasury.toLowerCase()}:${clientKey}`));
    await db.collection("daoCreationJobs").updateOne({ clientKey }, { $set: { clientKey, actor: identity.sub, status: "creating", daoId, treasury: treasury.toLowerCase(), updatedAt: new Date() } }, { upsert: true });
    const account = privateKeyToAccount(privateKey as Hex);
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
    const hash = await wallet.writeContract({ address: registry, abi: registryAbi, functionName: "createDAOFor", args: [getAddress(treasury), daoId, getAddress(treasury), Number(body.mode) === 1 ? 1 : 0, getAddress(reviewOracle), getAddress(executor), name, String(body.metadataUri)] } as never);
    await db.collection("daoCreationJobs").updateOne({ clientKey }, { $set: { status: "submitted", txHash: hash, updatedAt: new Date() } });
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("DAO creation transaction reverted.");
    const createdLog = receipt.logs.map((log) => { try { return decodeEventLog({ abi: registryAbi, data: log.data, topics: (log as unknown as { topics: [] | [Hex, ...Hex[]] }).topics }) as { eventName: string; args: Record<string, unknown> }; } catch { return null; } }).find((log) => log?.eventName === "DAOCreated");
    const daoAddress = createdLog?.args ? String(createdLog.args.dao || "") : "";
    if (!daoAddress) throw new Error("DAO created but the registry event did not contain its address.");
    const metadata = String(body.metadataUri);
    let metadataFields: { logoUri?: string; bannerUri?: string; tags?: string[]; rules?: string } = {};
    try { metadataFields = JSON.parse(metadata) as typeof metadataFields; } catch { /* Keep the submitted top-level fields when metadata is not JSON. */ }
    await db.collection("daoIndex").updateOne({ daoId }, { $set: { daoId, dao: daoAddress.toLowerCase(), admin: treasury.toLowerCase(), treasury: treasury.toLowerCase(), name, mode: Number(body.mode) || 0, metadata, description: String(body.description || ""), mission: String(body.mission || ""), constitution: String(body.constitution || ""), category: String(body.category || ""), access: String(body.access || "public"), gate: body.gate || null, logoUri: String(body.logoUri || metadataFields.logoUri || ""), bannerUri: String(body.bannerUri || metadataFields.bannerUri || ""), tags: metadataFields.tags || [], rules: metadataFields.rules || "", treasuryPolicy: { weeklyUsdcLimit: String(body.weeklyLimit || "0"), executor: executor.toLowerCase() }, active: true, updatedAt: new Date() } }, { upsert: true });
    await db.collection("delegations").updateOne({ creationKey: clientKey }, { $set: { daoId, daoAddress: daoAddress.toLowerCase(), updatedAt: new Date() } });
    await db.collection("daoCreationJobs").updateOne({ clientKey }, { $set: { status: "indexed", daoAddress: daoAddress.toLowerCase(), txHash: hash, receiptBlock: receipt.blockNumber.toString(), createdAt: new Date(), updatedAt: new Date() } });
    return json(res, 201, { ok: true, daoId, daoAddress: daoAddress.toLowerCase(), txHash: hash, status: "indexed", indexed: true });
  } catch (error) {
    const message = safeError(error);
    try { const body = req.body || {}; if (body.clientKey) { const db = await database(); await db.collection("daoCreationJobs").updateOne({ clientKey: String(body.clientKey) }, { $set: { status: "failed", error: message, updatedAt: new Date() } }).catch(() => undefined); } } catch { await Promise.resolve(); }
    return json(res, 500, { error: message });
  }
}
