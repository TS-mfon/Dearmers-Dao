import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const hash = "0x9a160bfdf84b7208c4048be24e75086939d39417b9c311ac39667b5a913eafc0";
const privateKey = "0xce69ecfd5b79f1903b5eff89342a7e321ed2438074d8a4c5b7bc831beead3641";

const account = createAccount(privateKey as `0x${string}`);
const client = createClient({
  chain: studionet,
  account,
});

async function main() {
  try {
    const tx = await (client as any).getTransaction({ hash });
    console.log("TRANSACTION DETAILS:", JSON.stringify(tx, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));
  } catch (e: any) {
    console.log("Error fetching transaction:", e.message || e);
  }

  try {
    const receipt = await (client as any).getTransactionReceipt({ hash });
    console.log("RECEIPT DETAILS:", JSON.stringify(receipt, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));
  } catch (e: any) {
    console.log("Error fetching receipt:", e.message || e);
  }
}

main().catch(console.error);
