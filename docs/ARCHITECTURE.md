# Dearmers-Dao architecture

## Authority boundaries

- Base Sepolia contracts own DAO identity, constitutions, membership, proposal state, votes, deadlines, guardrails, and execution hashes.
- GenLayer evaluates evidence, applicant fit, constitutional compatibility, milestone delivery, and emergency context through independent validator consensus.
- MetaMask ERC-7715 owns the creator’s bounded USDC delegation. A DAO has one isolated treasury delegation.
- GitHub Actions provides liveness automation but is not the source of truth. Vote finalization and eligible retries remain permissionless.
- MongoDB indexes events, stores notification preferences, caches public GitHub evidence, and tracks retries. It cannot move funds.

## Decision lifecycle

`create proposal -> GenLayer review -> revision/reject/escalate/voting -> three-day vote -> permissionless finalization -> bounded delegated payout -> execution hash`

Grant DAOs use:

`application -> GitHub/evidence review -> eligible ranking -> whitelisted VC vote -> milestone review -> tranche payout -> reputation update`

## Isolation invariant

Every stateful DAO operation is addressed by a DAO contract. The registry is a directory only. No contract in this repository is allowed to spend from a treasury belonging to another DAO.
