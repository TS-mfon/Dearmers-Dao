import { readFile, writeFile } from "node:fs/promises";
import { chains, createAccount, createClient } from "genlayer-js";
import { type TransactionHash } from "genlayer-js/types";

const key = process.env.GENLAYER_OPERATOR_PRIVATE_KEY || process.env.GENLAYER_PLATFORM_SIGNER_PRIVATE_KEY;
if (!key) throw new Error("Set GENLAYER_OPERATOR_PRIVATE_KEY or GENLAYER_PLATFORM_SIGNER_PRIVATE_KEY before deployment.");
const endpoint = process.env.GENLAYER_RPC_URL || "https://studio-dev.genlayer.com/api";
const account = createAccount(key as `0x${string}`);
const client = createClient({ endpoint, account, chain: chains.studioDevnet });
const code = new Uint8Array(await readFile("contracts/genlayer/dearmers_dao_v2.py"));
const fees = await client.estimateTransactionFees({ leaderTimeunitsAllocation: 100n, validatorTimeunitsAllocation: 200n });
const hash = await client.deployContract({ code, args: [], fees: { distribution: fees.distribution, feeValue: fees.feeValue } });
const receipt = await client.waitForTransactionReceipt({ hash: hash as TransactionHash, waitUntil: "finalized", retries: 200 });
const address = receipt.data?.contract_address;
if (!address) throw new Error(`Deployment finalized without a contract address: ${JSON.stringify(receipt)}`);
const record = { network: "studio-dev", chainId: 61997, endpoint, explorer: "https://explorer-studio-dev.genlayer.com", runner: "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng", owner: account.address, evaluatorV2: address, deploymentTransaction: hash };
await writeFile("deployment.genlayer-v2.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
