# Dearmers-Dao deployment handoff

Dearmers-Dao intentionally keeps every DAO treasury isolated. Do not use one treasury address or one DAO contract for multiple organizations.

## Base Sepolia deployment order

1. Deploy the zero-argument Base `DearmersRegistry` contract. It is a factory/adapter only and never holds funds.
2. Deploy `contracts/genlayer/dearmers_registry.py` to Bradbury and configure `VITE_DEARMERS_GENLAYER_REGISTRY` plus the server-only platform signer.
3. Set `VITE_DEARMERS_REGISTRY` to the Base adapter address. DAO creators call `createDAO`; the adapter deploys one isolated `DearmersDAO` for each organization.
4. Register each confirmed DAO in the GenLayer registry. GenLayer is the authoritative multi-DAO directory; Base remains the deterministic execution layer.
5. The creator schedules the public constitution on Base and registers the same version in the evaluator through `/api/genlayer`.
6. After the timelock, activate the constitution.
7. From the DAO treasury EOA, create its MetaMask ERC-7715 periodic USDC delegation.
8. Store automation, MongoDB, email, and review-oracle secrets in GitHub and Vercel.

## Constitution argument defaults for the demo

Use these as deployment-call arguments, not hidden policy:

```text
maxProposalAmount: 250000000       # 250 USDC, six decimals
weeklySpendLimit: 1000000000       # 1,000 USDC, six decimals
quorumBps: 2000                    # 20%
approvalBps: 5000                  # 50% + one weighted vote
votingPeriod: 259200               # 3 days
gateToken: 0x0000000000000000000000000000000000000000
gateBalance: 0
categories: grants,contributors,infra,marketing,emergency
policyText: public constitution text used by GenLayer
activatesAt: current unix time + timelock seconds
```

For token-gated DAOs, replace `gateToken` and `gateBalance`. For a whitelist DAO, call `setMembershipMode(1)` and populate `setWhitelist`; for a token-gated DAO use `setMembershipMode(2)`.

## GenLayer deployment

Deploy `contracts/genlayer/dearmers_dao.py` once on Bradbury with no constructor arguments. Each DAO registers versioned constitutions through `set_constitution`.

Set the resulting evaluator address in `VITE_GENLAYER_EVALUATOR` or in the app’s evaluator binding. The evaluator is intentionally DAO-scoped: each DAO must use the constitution version attached to its proposal.

## Frontend environment

```env
VITE_DEARMERS_REGISTRY=0x...
VITE_DEARMERS_DAO=0x...
VITE_GENLAYER_EVALUATOR=0x...
VITE_BASE_RPC_URL=https://sepolia.base.org
```

The current app retains Siggy’s delegation and 1Shot modules while the new DAO API is introduced. The next UI migration should replace the legacy single-council routes with DAO-scoped routes using these variables.

## GitHub Actions secrets

Configure:

- `BASE_RPC_URL`
- `DEARMERS_REGISTRY_ADDRESS`
- `DEARMERS_RELAYER_KEY`
- `MONGODB_URI`
- `EMAIL_API_KEY`

The relayer key must be limited to the DAO execution methods. MongoDB and email services must never be able to authorize a payout.

## Current deployment (September 4, 2026)

- Base Sepolia `DearmersRegistry`: `0x7C28705d82C1248C69dEd64569C7460F078524a4`
- Base deployer: `0xEd9EDd8586b20524CafA4F568413C504C9B03172`
- GenLayer Bradbury registry: `0x4b39A99fec60f34b981233Ef6C4A8F13D225373C`
- Vercel production: `https://dearmers-dao.vercel.app`

The StudioNext registry should be deployed with the pinned runner header supplied for this build. After deployment, set `VITE_DEARMERS_GENLAYER_REGISTRY` to its address. Deploy the evaluator with the same approved StudioNext runner, then set `VITE_GENLAYER_EVALUATOR`. No CDP wallet is used.
