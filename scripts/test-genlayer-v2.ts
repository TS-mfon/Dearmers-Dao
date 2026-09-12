import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant, type TransactionHash } from "genlayer-js/types";

const key = process.env.GENLAYER_OPERATOR_PRIVATE_KEY || process.env.GENLAYER_PLATFORM_SIGNER_PRIVATE_KEY;
const evaluator = process.env.GENLAYER_V2_EVALUATOR_ADDRESS;
if (!key || !evaluator) throw new Error("Set GENLAYER_OPERATOR_PRIVATE_KEY and GENLAYER_V2_EVALUATOR_ADDRESS.");

const account = createAccount(key as `0x${string}`);
const client = createClient({ endpoint: "https://studio-dev.genlayer.com/api", account, chain: studioDevnet });
const daoId = `anime-demo-${Date.now()}`;
const proposalId = `proposal-${Date.now()}`;
const constitution = "This anime fan DAO funds community projects that preserve, discuss, and expand appreciation of the named anime. Claims about releases, creators, history, and impact must be supported by independent public evidence.";

async function write(functionName: string, args: unknown[]) {
  const estimate = await client.estimateTransactionFeesForWrite({ address: evaluator as `0x${string}`, functionName, args } as never);
  const hash = await client.writeContract({ address: evaluator as `0x${string}`, functionName, args, fees: { distribution: estimate.distribution, messageAllocations: estimate.messageAllocations, feeValue: estimate.feeValue } } as never);
  const receipt = await client.waitForTransactionReceipt({ hash: hash as TransactionHash, waitUntil: "finalized", retries: 240 });
  if (String(receipt.execution_result || receipt.consensus_data?.leader_receipt?.[0]?.execution_result || "SUCCESS").toUpperCase() === "ERROR") throw new Error(`Transaction execution failed: ${hash}`);
  return hash;
}

const constitutionHash = await write("set_constitution", [daoId, "anime-v1", constitution, JSON.stringify({ mission: "anime preservation and community projects", evidenceRequired: true, allInputsUntrusted: true })]);
const evaluationHash = await write("evaluate_proposal", [daoId, proposalId, JSON.stringify({ title: "Archive the anime production timeline", description: "Create a public, source-linked archive of production milestones and verified creator interviews.", category: "research", amount: "0", evidence: ["https://en.wikipedia.org/wiki/Anime", "https://example.invalid/unavailable-anime-source"], claims: ["The archive will preserve public history", "The unavailable source proves the project is complete"] })]);
const result = await client.readContract({ address: evaluator as `0x${string}`, functionName: "get_evaluation", args: [daoId, proposalId], jsonSafeReturn: true, transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
console.log(JSON.stringify({ evaluator, daoId, proposalId, constitutionHash, evaluationHash, result }, null, 2));
