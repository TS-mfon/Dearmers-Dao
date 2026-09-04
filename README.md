# Dearmers-Dao

Dearmers-Dao is a sovereign operating engine for autonomous DAOs and grant funds. Every DAO has an isolated Base Sepolia contract, creator-owned treasury EOA, MetaMask ERC-7715 USDC delegation, public versioned constitution, GenLayer evidence review, community or VC voting, and autonomous GitHub Actions settlement.

## Product loops

### Operating DAO

1. Create an isolated DAO through `DearmersRegistry`.
2. Publish and activate a constitution.
3. Register public, whitelisted, or token-gated members.
4. Submit a treasury proposal with public evidence.
5. GenLayer reviews constitutional compatibility.
6. Members vote for three days.
7. GitHub Actions finalizes the vote and redeems the DAO-specific USDC delegation through 1Shot.

### Grant DAO

1. Open a grant round with a budget and application deadline.
2. Applicants register wallet, email, GitHub identity, and public evidence.
3. GenLayer evaluates eligibility, evidence, fit, and contributor history.
4. Eligible applications enter a whitelisted VC vote.
5. Selected applicants receive milestone-based releases.
6. Successful milestones update portable applicant reputation.

## Architecture

- `contracts/evm/DearmersRegistry.sol`: permissionless factory and DAO directory; never holds funds.
- `contracts/evm/DearmersDAO.sol`: constitution, membership, proposal, vote, grant, milestone, reputation, pause, and execution state.
- `contracts/genlayer/dearmers_dao.py`: reusable multi-DAO evaluator on GenLayer Bradbury.
- `api/reviews.ts`: verifies finalized GenLayer results and relays bounded statuses to Base.
- `api/delegations.ts`: verifies the treasury wallet and encrypts delegation payloads.
- `api/profile.ts`: stores notification identity and evaluates public GitHub profile evidence.
- `scripts/reconcile.ts`: finalizes expired votes, executes approved USDC transfers through 1Shot, records execution, and sends notifications.
- `.github/workflows/dearmers-automation.yml`: runs the sovereign engine every 15 minutes without a VPS.

MongoDB is an index and notification store only. It cannot approve proposals or move funds.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Validation:

```bash
npm run build
npm run check:api
npm run lint
forge test
genvm-lint check contracts/genlayer/dearmers_dao.py
```

## Deployment

See `docs/DEPLOYMENT.md` for the complete order and environment variables.

Base deployment:

```bash
./scripts/deploy-base.sh /path/to/env-file
```

The environment must define `BASE_DEPLOYER_PRIVATE_KEY`, `BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY`, or `PRIVATE_KEY` plus an optional Base RPC URL.

GenLayer deployment:

```bash
genlayer network set testnet-bradbury
genlayer deploy --contract contracts/genlayer/dearmers_dao.py
```

## Security boundaries

- There is no unified DAO and no pooled treasury.
- Only the configured GenLayer review oracle can open or reject Base proposals.
- Only the configured executor can record payouts.
- Weekly limits are rechecked when execution is recorded.
- Delegations are encrypted at rest and must be authorized by the treasury wallet signature.
- GitHub Actions is a convenience executor; vote finalization remains permissionless.
- Constitution versions are immutable for proposals already in flight.
