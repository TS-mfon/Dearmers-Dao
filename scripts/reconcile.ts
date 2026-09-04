import { createDecipheriv, createHash } from "node:crypto";
import { MongoClient } from "mongodb";
import { Resend } from "resend";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import { redelegatePermissionContextAction } from "@metamask/smart-accounts-kit/actions";
import registryAbi from "../src/abi/DearmersRegistry.json" with { type: "json" };
import daoAbi from "../src/abi/DearmersDAO.json" with { type: "json" };

const erc20Abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
const required = ["BASE_RPC_URL", "DEARMERS_REGISTRY_ADDRESS", "BASE_AUTOMATION_PRIVATE_KEY", "MONGODB_URI", "DELEGATION_ENCRYPTION_KEY"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);

const account = privateKeyToAccount(process.env.BASE_AUTOMATION_PRIVATE_KEY as Hex);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) });
const mongo = new MongoClient(process.env.MONGODB_URI!);
const db = mongo.db(process.env.MONGODB_DB || "dearmers_dao");
const registry = process.env.DEARMERS_REGISTRY_ADDRESS as Address;
const relayerUrl = process.env.ONESHOT_RELAYER_URL || "https://relayer.1shotapi.dev/relayers";

async function rpc(method: string, params: unknown) {
  const response = await fetch(relayerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  if (!response.ok) throw new Error(`1Shot HTTP ${response.status}`);
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`1Shot: ${body.error.message || "unknown error"}`);
  return body.result as any;
}

function decrypt(payload: { iv: string; tag: string; ciphertext: string }) {
  const key = createHash("sha256").update(process.env.DELEGATION_ENCRYPTION_KEY!).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}

async function relayTransfer(daoAddress: Address, proposalId: bigint, recipient: Address, amount: bigint) {
  const stored = await db.collection("delegations").findOne({ daoAddress: daoAddress.toLowerCase() }) || await db.collection("delegations").findOne({ daoAddress });
  if (!stored?.payload) throw new Error("No encrypted delegation is registered for this DAO");
  if (String(stored.executor).toLowerCase() !== account.address.toLowerCase()) throw new Error("Automation key does not match delegated executor");
  const permissions = decrypt(stored.payload);
  const parent = Array.isArray(permissions) ? permissions[0] : permissions;
  const permissionContext = parent?.context || parent?.permissionContext;
  if (!permissionContext) throw new Error("Delegation permission context is missing");
  const feeData = await rpc("relayer_getFeeData", { chainId: "84532", token: stored.token });
  const relayerTarget = feeData.targetAddress as Address;
  const feeCollector = feeData.feeCollector as Address;
  const redelegated = await redelegatePermissionContextAction(wallet as any, { permissionContext, to: relayerTarget, environment: getSmartAccountsEnvironment(84532), chainId: 84532, allowInsecureUnrestrictedDelegation: true } as any);
  const child = { ...(redelegated.delegation as any), context: redelegated.permissionContext };
  parent.context = redelegated.permissionContext;
  const chain = [child, parent];
  const work = { target: stored.token, value: "0x0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }) };
  const estimatePayload = (executions: unknown[]) => ({ chainId: "84532", transactions: [{ permissionContext: chain, executions }], authorizationList: [] });
  const first = await rpc("relayer_estimate7710Transaction", estimatePayload([{ target: stored.token, value: "0x0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [feeCollector, 1_000_000n] }) }, work]));
  const fee = BigInt(first.requiredPaymentAmount);
  const executions = [{ target: stored.token, value: "0x0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [feeCollector, fee] }) }, work];
  const estimate = await rpc("relayer_estimate7710Transaction", estimatePayload(executions));
  const taskId = await rpc("relayer_send7710Transaction", { ...estimatePayload(executions), context: estimate.context });
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const status = await rpc("relayer_getStatus", { id: typeof taskId === "string" ? taskId : taskId.taskId, logs: false });
    if (String(status.status) === "200") {
      const transactionHash = status.receipt?.transactionHash || status.hash || status.txHash;
      if (!transactionHash) throw new Error("1Shot confirmed without a transaction hash");
      const recordHash = await wallet.writeContract({ address: daoAddress, abi: daoAbi, functionName: "recordProposalExecution", args: [proposalId, transactionHash] });
      await publicClient.waitForTransactionReceipt({ hash: recordHash });
      return transactionHash as Hex;
    }
    if (["400", "500"].includes(String(status.status))) throw new Error(`1Shot payout failed: ${status.message || status.error || status.status}`);
  }
  throw new Error("1Shot payout timed out");
}

async function notify(walletAddress: Address, title: string, message: string) {
  const walletKey = walletAddress.toLowerCase();
  await db.collection("notifications").insertOne({ wallet: walletKey, title, message, createdAt: new Date(), readAt: null });
  const profile = await db.collection("profiles").findOne({ wallet: walletKey });
  if (profile?.email && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: process.env.EMAIL_FROM, to: profile.email, subject: title, text: message });
  }
}

async function processDao(daoAddress: Address) {
  const proposalCount = await publicClient.readContract({ address: daoAddress, abi: daoAbi, functionName: "proposalCount" }) as bigint;
  for (let proposalId = 0n; proposalId < proposalCount; proposalId++) {
    const proposal = await publicClient.readContract({ address: daoAddress, abi: daoAbi, functionName: "getProposal", args: [proposalId] }) as any;
    if (Number(proposal.status) === 2 && Number(proposal.votingEndsAt) <= Math.floor(Date.now() / 1000)) {
      const hash = await wallet.writeContract({ address: daoAddress, abi: daoAbi, functionName: "finalizeProposalVote", args: [proposalId] });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    const refreshed = await publicClient.readContract({ address: daoAddress, abi: daoAbi, functionName: "getProposal", args: [proposalId] }) as any;
    if (Number(refreshed.status) === 4) {
      try {
        const payoutHash = await relayTransfer(daoAddress, proposalId, refreshed.recipient, refreshed.amount);
        await notify(refreshed.proposer, "Proposal paid", `Proposal ${proposalId} was paid on Base Sepolia: ${payoutHash}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.collection("automation_failures").updateOne({ daoAddress, proposalId: proposalId.toString() }, { $set: { message, updatedAt: new Date() }, $inc: { attempts: 1 } }, { upsert: true });
        await notify(refreshed.proposer, "Proposal payout needs attention", message);
      }
    }
  }
}

async function main() {
  await mongo.connect();
  const daoIds = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getDAOIds", args: [0n, 500n] }) as Hex[];
  for (const daoId of daoIds) {
    const record = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getDAO", args: [daoId] }) as any;
    if (record.active) await processDao(record.dao);
  }
  console.log(JSON.stringify({ ok: true, processedDaos: daoIds.length, timestamp: new Date().toISOString() }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => mongo.close());
