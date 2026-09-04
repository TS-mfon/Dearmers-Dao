#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="${1:-/home/sudodave/.env.build}"
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" == *=* ]]; then
      export "$line"
    elif [[ "$line" =~ ^[[:space:]]*private[[:space:]]key[[:space:]]*:(.*)$ ]]; then
      export PRIVATE_KEY="${BASH_REMATCH[1]//[[:space:]]/}"
    fi
  done < "$ENV_FILE"
fi
RPC="${BASE_RPC_URL:-${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}}"
KEY="${BASE_DEPLOYER_PRIVATE_KEY:-${BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY:-${PRIVATE_KEY:-}}}"
if [[ -z "$KEY" ]]; then echo "Missing BASE_DEPLOYER_PRIVATE_KEY, BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY, or PRIVATE_KEY in $ENV_FILE" >&2; exit 2; fi
forge create contracts/evm/DearmersRegistry.sol:DearmersRegistry --rpc-url "$RPC" --private-key "$KEY" --broadcast
