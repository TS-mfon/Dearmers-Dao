import { verifyMessage, type Address, type Hex } from "viem";

export function authMessage(action: string, wallet: Address, resource: string) {
  return `Dearmers-Dao\nAction: ${action}\nWallet: ${wallet.toLowerCase()}\nResource: ${resource}`;
}

export async function verifyWallet(action: string, wallet: Address, resource: string, signature: Hex) {
  return verifyMessage({ address: wallet, message: authMessage(action, wallet, resource), signature });
}
