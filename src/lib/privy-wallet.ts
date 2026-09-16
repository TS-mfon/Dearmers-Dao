import { useCallback, useEffect, useRef, useState } from "react";
import { getEmbeddedConnectedWallet, useCreateWallet, usePrivy, useSignMessage, useSignTypedData, useWallets, type ConnectedWallet } from "@privy-io/react-auth";

let walletCreation: Promise<unknown> | null = null;

function embeddedEthereumWallet(wallets: ConnectedWallet[]) {
  const embedded = getEmbeddedConnectedWallet(wallets);
  if (embedded) return embedded;
  return wallets.find((wallet) => ["privy", "privy-v2"].includes(wallet.walletClientType || "") && !wallet.imported) || null;
}

function alreadyHasEmbeddedWallet(reason: unknown) {
  return reason instanceof Error && reason.message.toLowerCase().includes("already has an embedded wallet");
}

export function usePrivyMemberWallet() {
  const { ready: authReady, authenticated, login } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signMessage: privySignMessage } = useSignMessage();
  const { signTypedData: privySignTypedData } = useSignTypedData();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const attempted = useRef(false);
  const wallet = embeddedEthereumWallet(wallets);

  useEffect(() => {
    if (!authenticated) attempted.current = false;
  }, [authenticated]);

  useEffect(() => {
    if (!authReady || !walletsReady || !authenticated || wallet || creating || attempted.current) return;
    attempted.current = true;
    setCreating(true);
    setError("");
    walletCreation ||= createWallet().finally(() => { walletCreation = null; });
    void walletCreation
      .catch((reason) => {
        if (!alreadyHasEmbeddedWallet(reason)) setError(reason instanceof Error ? reason.message : "Your Privy wallet could not be created.");
      })
      .finally(() => setCreating(false));
  }, [authReady, authenticated, createWallet, creating, wallet, walletsReady]);

  const requireAddress = useCallback(() => {
    if (!authenticated) throw new Error("Sign in to continue.");
    if (!wallet) throw new Error(error || (creating ? "Your Privy wallet is being created. Try again shortly." : "Your Privy embedded wallet is not ready."));
    return wallet.address;
  }, [authenticated, creating, error, wallet]);

  const signMessage = useCallback(async (message: string) => {
    const address = requireAddress();
    return (await privySignMessage({ message }, { address })).signature;
  }, [privySignMessage, requireAddress]);

  const signTypedData = useCallback(async (input: Parameters<typeof privySignTypedData>[0]) => {
    const address = requireAddress();
    return (await privySignTypedData(input, { address })).signature;
  }, [privySignTypedData, requireAddress]);

  return {
    ready: authReady && walletsReady && (!authenticated || Boolean(wallet) || Boolean(error)),
    authenticated,
    address: wallet?.address || "",
    creating,
    error: wallet ? "" : error,
    login,
    signMessage,
    signTypedData,
  };
}
