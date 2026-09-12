# Dearmers-Dao deployment handoff

Dearmers-Dao intentionally keeps every DAO treasury isolated. Do not use one treasury address or one DAO contract for multiple organizations.

## Base Sepolia deployment order

1. Deploy the zero-argument Base `DearmersRegistry` contract. It is a factory/adapter only and never holds funds.
2. Deploy `contracts/genlayer/dearmers_registry.py` to Bradbury and configure `VITE_DEARMERS_GENLAYER_REGISTRY` plus the server-only platform signer.
3. Set `VITE_DEARMERS_REGISTRY` to the Base adapter address. Configure the platform creation signer as a registry `creationRelayer`; the API calls `createDAOFor` so the connected user remains the DAO admin.
4. Register each confirmed DAO in the GenLayer registry. GenLayer is the authoritative multi-DAO directory; Base remains the deterministic execution layer.
5. The creator schedules the public constitution on Base and registers the same version in the evaluator through `/api/genlayer`.
6. After the timelock, activate the constitution.
7. From the DAO treasury EOA, create its MetaMask ERC-7715 periodic USDC delegation. The delegation is stored against the creation idempotency key before the platform creates the DAO.
8. Store automation, MongoDB, email, and review-oracle secrets in GitHub and Vercel.

## Media ownership migration

Before enabling the new DAO media resolver, run `npm run migration:media` with the production MongoDB environment loaded. This is a dry run and reports every legacy DAO logo/banner association that cannot be proven DAO-owned. After reviewing the report, run `npm run migration:media -- --apply` to clear only those unprovable associations and record audit events. Do not restore heuristic creator-upload recovery; upload replacements through the DAO control room so each asset is stored with an explicit DAO scope and purpose.

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

### Studio Dev evaluator v2

The legacy evaluator remains deployed and is not modified. Deploy the StudioNext evaluator separately:

```bash
GENLAYER_RPC_URL=https://studio-dev.genlayer.com/api \
GENLAYER_CHAIN_ID=61997 \
GENLAYER_OPERATOR_PRIVATE_KEY=0x... \
npm run deploy:genlayer-v2
```

The command writes `deployment.genlayer-v2.json`. Configure the resulting address as
`GENLAYER_V2_EVALUATOR_ADDRESS` in the server environment. The StudioNext runtime is pinned to
`py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`. The proposal pipeline submits a transaction first,
returns its hash immediately, and polls finality from the proposal detail route before relaying an approved review.
The Studio Dev explorer is `https://explorer-studio-dev.genlayer.com/`.

The v2 evaluator fetches HTTPS evidence with GenLayer's nondeterministic web primitive. Fetch failures, conflicting
sources, and unsupported claims are recorded as uncertainty; submitted text and web content cannot redefine the
authoritative DAO or grant rules.

Deploy `contracts/genlayer/dearmers_dao.py` once on Bradbury with no constructor arguments. Each DAO registers versioned constitutions through `set_constitution`.

Set the resulting evaluator address in `VITE_GENLAYER_EVALUATOR` or in the app’s evaluator binding. The evaluator is intentionally DAO-scoped: each DAO must use the constitution version attached to its proposal.

## Frontend environment

```env
VITE_DEARMERS_REGISTRY=0x...
VITE_DEARMERS_DAO=0x...
VITE_GENLAYER_EVALUATOR=0x...
VITE_BASE_RPC_URL=https://sepolia.base.org
BASE_PLATFORM_SIGNER_PRIVATE_KEY=0x...
BASE_VOTE_RELAYER_PRIVATE_KEY=0x...
INTERNAL_API_SECRET=...
RESEND_API_KEY=re_...
EMAIL_FROM=verified-sender@example.com
```

Normal application actions use Privy bearer sessions. Proposal submission is offchain until GenLayer review creates the linked onchain proposal; only the resulting vote intent is signed by the user and relayed on Base Sepolia. Grants never call the DAO contract or transfer funds.

## GitHub Actions secrets

Configure:

- `BASE_RPC_URL`
- `DEARMERS_REGISTRY_ADDRESS`
- `DEARMERS_RELAYER_KEY`
- `MONGODB_URI`
- `EMAIL_API_KEY`

The relayer key must be limited to the DAO execution methods. MongoDB and email services must never be able to authorize a payout.

## Current deployment (September 7, 2026)

- Base Sepolia `DearmersRegistry` (final migration deployment, September 7, 2026): `0x93DD96b0843ECe31597B5a78a2B4F93113fd1b9F`
- Base deployer: `0xEd9EDd8586b20524CafA4F568413C504C9B03172`
- GenLayer Bradbury registry: `0x4b39A99fec60f34b981233Ef6C4A8F13D225373C`
- Vercel production: `https://dearmers-dao.vercel.app`
- Custom domain: `https://dreamersdao.me` (attached to Vercel; registrar DNS migration remains required)

The StudioNext registry should be deployed with the pinned runner header supplied for this build. After deployment, set `VITE_DEARMERS_GENLAYER_REGISTRY` to its address. Deploy the evaluator with the same approved StudioNext runner, then set `VITE_GENLAYER_EVALUATOR`. No CDP wallet is used.

The updated registry is deployed and the production platform signer is authorized as a creation relayer. New DAO contracts authorize the configured executor as their proposal and vote relayer during construction.

Until the custom-domain DNS migration completes, keep server-only `APP_URL` set to `https://dearmers-dao.vercel.app` so internal GenLayer and review callbacks reach the application. At the registrar, replace the existing apex GitHub Pages record with:

```text
Type: A
Host: @
Value: 76.76.21.21
```

After Vercel reports the domain as configured and TLS is issued, change `APP_URL` to `https://dreamersdao.me` and redeploy once more. Alternatively, move nameservers to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.

The temporary migration setup uses the existing Base deployer as the platform creation and vote relayer. Before mainnet or material treasury use, rotate to dedicated least-privilege relayer keys, authorize the replacement creation relayer in the registry, and configure each new DAO with the replacement executor.
