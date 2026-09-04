# Dearmers-Dao contracts

`DearmersRegistry` is a directory only. It never holds DAO funds.

Every DAO gets an isolated `DearmersDAO` deployment and a creator-owned treasury EOA. USDC delegation remains an application/MetaMask execution concern; the DAO contract records the bounded proposal lifecycle and execution hash.

Deploy order:

1. Deploy `DearmersDAO` with `admin`, `daoId`, `treasury`, and `address(0)`.
2. Deploy `DearmersRegistry` with the DAO implementation address (or `address(0)` for the first standalone deployment).
3. Call `setRegistry` from the DAO admin.
4. Register the DAO with `registerDAO`.
5. Schedule and activate its first constitution.
6. Create the DAO’s MetaMask ERC-7715 periodic USDC delegation.
