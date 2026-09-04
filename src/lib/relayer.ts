import { encodeFunctionData, parseAbi, numberToHex } from "viem";
import { decodeDelegations } from "@metamask/delegation-core";

export const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "https://relayer.1shotapi.dev/relayers";

// Standard ERC-20 ABI snippet for transfer
const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// Helper for JSON-RPC requests
export async function rpcCall(method: string, params: any): Promise<any> {
  try {
    const response = await fetch(RELAYER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    if (data.error) {
      console.error("1Shot RPC error detail:", data.error.data);
      throw new Error(`${data.error.message || JSON.stringify(data.error)}${data.error.data ? ` | data: ${JSON.stringify(data.error.data)}` : ""}`);
    }
    return data.result;
  } catch (error: any) {
    console.error(`1Shot RPC Call Error (${method}):`, error);
    throw error;
  }
}

// 1. Get capabilities for Base Sepolia (Chain ID: 84532)
export async function getCapabilities(chainId: string = "84532"): Promise<any> {
  return await rpcCall("relayer_getCapabilities", [chainId]);
}

// 2. Fetch fee data
export async function getFeeData(chainId: string = "84532", tokenAddress: string = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"): Promise<any> {
  return await rpcCall("relayer_getFeeData", { chainId, token: tokenAddress });
}

// Encode ERC20 transfer calldata
export function encodeErc20Transfer(recipient: string, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient as `0x${string}`, amount],
  });
}

// 3. Estimate a 7710 delegated transaction
// Helper to decode and format delegation chain
export function getFormattedDelegationChain(delegation: any): any[] {
  const delegationArray = Array.isArray(delegation) ? delegation : [delegation];
  
  // Try to find if there is a context inside the first element (redelegateResult.permissionContext)
  const childContext = delegationArray[0]?.context || delegationArray[0]?.permissionContext;
  let decodedChain: any[] = [];
  
  if (childContext) {
    try {
      const decoded = decodeDelegations(childContext);
      if (decoded && decoded.length >= 2) {
        // Order: [child, root] -> decoded[0] is the child, decoded[1] is the root
        decodedChain = [decoded[0], decoded[1]];
      } else if (decoded && decoded.length === 1) {
        decodedChain = [decoded[0]];
      }
    } catch (e) {
      console.warn("Failed to decode child context, falling back to decoding elements individually:", e);
    }
  }

  // Fallback: if decodedChain is empty, try to decode each element or use as-is
  if (decodedChain.length === 0) {
    for (const d of delegationArray) {
      const context = d?.context || d?.permissionContext;
      if (context) {
        try {
          const decoded = decodeDelegations(context);
          if (decoded && decoded.length > 0) {
            decodedChain.push(...decoded);
            continue;
          }
        } catch (e) {
          console.warn("Failed to decode individual delegation context:", e);
        }
      }
      decodedChain.push(d);
    }
  }

  // Map each delegation in the chain to verify/format all 6 required fields to hex strings
  return decodedChain.map(d => {
    const delegate = d.delegate || d.to || "";
    const delegator = d.delegator || d.from || "";
    const authority = d.authority || "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const caveats = d.caveats ?? [];
    
    // Salt formatting
    let salt = d.salt;
    if (typeof salt === "bigint") {
      salt = numberToHex(salt, { size: 32 });
    } else if (typeof salt === "string" && /^\d+$/.test(salt)) {
      salt = numberToHex(BigInt(salt), { size: 32 });
    } else if (!salt) {
      salt = "0x0000000000000000000000000000000000000000000000000000000000000000";
    }

    const signature = d.signature || "";

    return {
      ...d,
      delegate,
      delegator,
      authority,
      caveats,
      salt,
      signature
    };
  });
}

// 3. Estimate a 7710 delegated transaction
export async function estimate7710Transaction(
  chainId: string,
  _tokenAddress: string,
  transactions: Array<{ from?: string; to: string; data: string; value: string; permissionContext?: string }>,
  delegation: any
): Promise<{ requiredPaymentAmount: string; gasUsed: string; context: string }> {
  const formattedDelegations = getFormattedDelegationChain(delegation);

  const payload = {
    chainId,
    transactions: [
      {
        permissionContext: formattedDelegations,
        executions: transactions.map(tx => ({
          target: tx.to,
          value: tx.value || "0x0",
          data: tx.data
        }))
      }
    ],
    authorizationList: []
  };

  console.log("relayer_estimate7710Transaction payload:", JSON.stringify(payload, null, 2));

  try {
    return await rpcCall("relayer_estimate7710Transaction", payload);
  } catch (error: any) {
    throw new Error(`relayer_estimate7710Transaction failed: ${error.message || error} (Payload: ${JSON.stringify(payload)})`);
  }
}

// 4. Send a 7710 delegated transaction
export async function send7710Transaction(
  chainId: string,
  _tokenAddress: string,
  transactions: Array<{ from?: string; to: string; data: string; value: string; permissionContext?: string }>,
  delegation: any,
  context: string
): Promise<string> {
  const formattedDelegations = getFormattedDelegationChain(delegation);

  const payload = {
    chainId,
    transactions: [
      {
        permissionContext: formattedDelegations,
        executions: transactions.map(tx => ({
          target: tx.to,
          value: tx.value || "0x0",
          data: tx.data
        }))
      }
    ],
    authorizationList: [],
    context
  };

  console.log("relayer_send7710Transaction payload:", JSON.stringify(payload, null, 2));

  try {
    const res = await rpcCall("relayer_send7710Transaction", payload);
    // Returns taskId/transaction id
    return typeof res === "string" ? res : res.result || res.taskId || JSON.stringify(res);
  } catch (error: any) {
    throw new Error(`relayer_send7710Transaction failed: ${error.message || error} (Payload: ${JSON.stringify(payload)})`);
  }
}

// 5. Get status of a task
export async function getStatus(taskId: string): Promise<{ status: string; txHash?: string; error?: string }> {
  const res = await rpcCall("relayer_getStatus", { id: taskId, logs: false });
  const statusMap: Record<number | string, string> = {
    "100": "Pending",
    "110": "Submitted",
    "200": "Confirmed",
    "400": "Rejected",
    "500": "Reverted",
  };
  const rawStatus = res.status;
  const status = statusMap[rawStatus] || "Pending";
  const txHash = res.receipt?.transactionHash || res.hash || res.txHash || res.transactionHash;
  const error = res.message || (res.data ? JSON.stringify(res.data) : undefined) || res.error;
  
  return {
    status,
    txHash,
    error,
  };
}

// Polling wrapper for transaction finality
export async function pollTransactionStatus(
  taskId: string,
  intervalMs: number = 2500,
  maxAttempts: number = 30
): Promise<string> {
  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const result = await getStatus(taskId);
    console.log(`Polling task ${taskId}:`, result);
    
    if (result.status === "Confirmed" && result.txHash) {
      return result.txHash;
    }
    if (result.status === "Failed" || result.status === "Rejected" || result.status === "Reverted") {
      throw new Error(`Transaction relay failed with status: ${result.status}. Error: ${result.error || "unknown"}`);
    }
    attempts++;
  }
  throw new Error("Transaction relay timeout");
}
