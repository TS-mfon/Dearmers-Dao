const contractKey = "dearmers_evaluator_contract";
export const getEvaluatorAddress = () => (localStorage.getItem(contractKey) || import.meta.env.VITE_GENLAYER_EVALUATOR || "") as `0x${string}`;
export const setEvaluatorAddress = (address: string) => localStorage.setItem(contractKey, address);

async function platformWrite(action: string, args: unknown[], targetAddress = getEvaluatorAddress()) {
  const address = targetAddress;
  if (!address) throw new Error("VITE_GENLAYER_EVALUATOR is not configured.");
  const response = await fetch("/api/genlayer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, address, args }) });
  const body = await response.json() as { hash?: string; error?: string };
  if (!response.ok || !body.hash) throw new Error(body.error || "Platform signer request failed.");
  return body.hash as `0x${string}`;
}

export async function registerDearmersDao(input: { registryAddress: string; daoId: string; admin: string; treasury: string; baseDao: string; mode: string; membershipMode: string; name: string; mission: string; description: string; category: string; gateChain: string; gateAsset: string; gateStandard: string; gateName: string; gateSymbol: string; logoUri: string; bannerUri: string; treasuryPolicy: string; evaluator: string; metadataUri: string }) {
  return platformWrite("register_dao", [input.daoId, input.admin, input.treasury, input.baseDao, input.mode, input.membershipMode, input.name, input.mission, input.description, input.category, input.gateChain, input.gateAsset, input.gateStandard, input.gateName, input.gateSymbol, input.logoUri, input.bannerUri, input.treasuryPolicy, "1", input.evaluator, input.metadataUri], input.registryAddress as `0x${string}`);
}

export async function setDearmersConstitution(daoId: string, version: string, text: string, rules: object) {
  return platformWrite("set_constitution", [daoId, version, text, JSON.stringify(rules)]);
}

export async function evaluateWithDearmers(daoId: string, proposalId: string, proposal: object) {
  return platformWrite("evaluate_proposal", [daoId, proposalId, JSON.stringify(proposal)]);
}
