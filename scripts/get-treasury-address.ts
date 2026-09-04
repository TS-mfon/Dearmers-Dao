import { toMetaMaskSmartAccount, Implementation } from "@metamask/smart-accounts-kit";
import { createPublicClient, createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";
import * as path from "path";

// Read private key
const envPath = "C:\\Users\\Tech Shine\\.gemini\\antigravity-ide\\brain\\d60866f6-fc5c-4693-be2a-fba2a1e6c11c\\scratch\\.env.build";
let privateKey = "";
try {
  const content = fs.readFileSync(envPath, "utf-8");
  const match = content.match(/private key\s*=\s*(0x[a-fA-F0-9]{64})/i);
  if (match) {
    privateKey = match[1];
  }
} catch (e: any) {
  console.log("Fallback or issue reading scratch file:", e.message || e);
}

if (!privateKey) {
  privateKey = "0xce69ecfd5b79f1903b5eff89342a7e321ed2438074d8a4c5b7bc831beead3641";
}

const ownerAccount = privateKeyToAccount(privateKey as `0x${string}`);
console.log("EOA Owner Address:", ownerAccount.address);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

const walletClient = createWalletClient({
  account: ownerAccount,
  chain: baseSepolia,
  transport: http(),
});

async function main() {
  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [ownerAccount.address, [], [], []],
    deploySalt: "0x0000000000000000000000000000000000000000000000000000000000000000",
    signer: { walletClient },
  } as any);

  console.log("Calculated Treasury Smart Account Address:", smartAccount.address);
}

main().catch(console.error);
