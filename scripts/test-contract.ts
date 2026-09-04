import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const contractAddress = "0x6D2DBABf5Afc6800DDA5B5A7B4B0b245c44AB3e7";
const privateKey = "0xce69ecfd5b79f1903b5eff89342a7e321ed2438074d8a4c5b7bc831beead3641";

const account = createAccount(privateKey as `0x${string}`);
const client = createClient({
  chain: studionet,
  account,
});

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTransaction(hash: `0x${string}`) {
  let attempts = 0;
  while (attempts < 60) {
    await sleep(3000);
    try {
      const receipt: any = await client.getTransactionReceipt({ hash } as any);
      const status = receipt.status;
      const statusName = receipt.statusName || "";
      
      console.log(`Transaction ${hash} status: ${status} (${statusName})`);
      
      if (status === 6 || statusName === "FINALIZED" || status === "success" || status === "SUCCESS") {
        return receipt;
      }
      if (status === 5 || statusName === "FINALIZED_WITH_ERROR" || status === "error" || status === "fail") {
        throw new Error(receipt.error?.message || "Transaction finalized with error");
      }
      
      if (status === 3 || status === 2 || statusName === "COMMITTED" || statusName === "REVEALED") {
        console.log(`Transaction ${hash} ready for finalization. Triggering manual finalize...`);
        try {
          await client.finalizeTransaction({ txId: hash } as any);
        } catch (e: any) {
          console.log("Finalize transaction call log:", e.message || e);
        }
      }
    } catch (err: any) {
      console.log("Error querying transaction receipt, waiting...", err.message || err);
    }
    attempts++;
  }
  throw new Error("Transaction finalization timeout");
}

async function runTest() {
  console.log("=== STARTING SIGGY DAO CONTRACT INTEGRATION TEST & STRESS TEST ===");
  console.log(`Using contract: ${contractAddress}`);
  console.log(`Using account: ${account.address}`);

  // Test proposals
  const testProposals = [
    {
      title: "Fullstack Contributor Compensation",
      description: "Payout for completing core frontend templates and integrating 1Shot relayer execution flows on Base Sepolia.",
      category: "contributor",
      recipient: "0xefBA993f9dF57e09AA782fa718f242f70526F817",
      amount_micro: 120n * 10n**6n, // 120 USDC
    },
    {
      title: "Global Marketing Campaign",
      description: "Funds to boost social presence and promote the AI Treasury Council on Base Sepolia.",
      category: "marketing",
      recipient: "0x7f6d95F56c3a3A05dd21476B4fc93B7aA38519DA",
      amount_micro: 50n * 10n**6n, // 50 USDC
    },
    {
      title: "Extremely Expensive Server Infrastructure",
      description: "Proposed cost to buy a supercomputer. This exceeds our remaining weekly cap and should be rejected.",
      category: "infra",
      recipient: "0xD1dEe97109fa63F065725CF1ac4B339bB4a7D073",
      amount_micro: 2000n * 10n**6n, // 2000 USDC (exceeds cap!)
    }
  ];

  // Get initial proposal count to track PIDs correctly
  const initialState: any = await client.readContract({
    address: contractAddress,
    functionName: "get_contract_state",
    args: [],
  } as any);
  const initialCount = Number(initialState.proposal_count);
  console.log(`Initial proposal count on-chain: ${initialCount}`);

  for (let i = 0; i < testProposals.length; i++) {
    const tp = testProposals[i];
    console.log(`\n--- [TEST PROPOSAL #${i + 1}] "${tp.title}" ---`);
    console.log(`Amount: ${Number(tp.amount_micro) / 1e6} USDC | Category: ${tp.category}`);
    
    // 1. Submit proposal
    console.log("Submitting proposal to contract...");
    const submitHash = await client.writeContract({
      address: contractAddress,
      functionName: "submit_proposal",
      args: [tp.title, tp.description, tp.category, tp.recipient, tp.amount_micro],
    } as any);
    
    console.log(`Submission tx sent. Waiting for finalization... Hash: ${submitHash}`);
    await waitForTransaction(submitHash);
    console.log("Proposal submitted and finalized!");

    // Get proposal count (wait for it to increment if node is syncing)
    let pid = -1;
    for (let attempts = 0; attempts < 10; attempts++) {
      const state: any = await client.readContract({
        address: contractAddress,
        functionName: "get_contract_state",
        args: [],
      } as any);
      const count = Number(state.proposal_count);
      if (count > initialCount + i) {
        pid = count - 1;
        break;
      }
      console.log(`Waiting for proposal count to update (current: ${count}, expected: > ${initialCount + i})...`);
      await sleep(3000);
    }
    
    if (pid === -1) {
      throw new Error(`Failed to retrieve valid proposal ID. State shows proposal_count has not updated.`);
    }
    console.log(`Proposal stored with ID: ${pid}`);

    // 2. Evaluate proposal
    console.log(`Evaluating proposal ID #${pid}... This triggers the 3-agent AI Council consensus...`);
    const evalHash = await client.writeContract({
      address: contractAddress,
      functionName: "evaluate_proposal",
      args: [BigInt(pid)],
    } as any);
    
    console.log(`Evaluation tx sent. Waiting for consensus and finalization... Hash: ${evalHash}`);
    await waitForTransaction(evalHash);
    console.log("Evaluation completed on-chain!");

    // 3. Read results (wait for RPC state synchronization)
    let prop: any = null;
    for (let attempts = 0; attempts < 10; attempts++) {
      prop = await client.readContract({
        address: contractAddress,
        functionName: "get_proposal",
        args: [BigInt(pid)],
      } as any);
      if (prop.status !== "pending") {
        break;
      }
      console.log(`Waiting for proposal status to sync (current: PENDING)...`);
      await sleep(3000);
    }

    console.log(`\nConsensus Status: ${prop.status.toUpperCase()}`);
    console.log(`Approved Amount: ${Number(prop.approved_amount_micro) / 1e6} USDC`);
    console.log(`Final Reasoning: "${prop.final_reasoning}"`);
    
    console.log("\nAI Council Breakdown:");
    prop.verdicts.forEach((v: any, idx: number) => {
      console.log(` - Agent #${idx + 1} (${v.persona.toUpperCase()}): Vote = ${v.vote.toUpperCase()} | Conf = ${v.confidence}% | Max = ${Number(v.max_amount_micro) / 1e6} USDC`);
      console.log(`   Reasoning: "${v.reasoning}"`);
    });
  }

  console.log("\n=== STRESS TEST COMPLETED SUCCESSFULLY ===");
}

runTest().catch((e) => {
  console.error("Test failed with error:", e);
});
