import { useCallback, useEffect, useRef, useState } from "react";
import { getEmbeddedConnectedWallet, useCreateWallet, usePrivy, useSignMessage, useSignTypedData, useWallets, type ConnectedWallet } from "@privy-io/react-auth";

let walletCreation: Promise<{ address?: string }> | null = null;

function embeddedEthereumWallet(wallets: ConnectedWallet[]) {
  const embedded = getEmbeddedConnectedWallet(wallets);
  if (embedded) return embedded;
  return wallets.find((wallet) => ["privy", "privy-v2"].includes(wallet.walletClientType || "") && !wallet.imported) || null;
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object") {
    const source = reason as Record<string, unknown>;
    for (const key of ["message", "error", "reason"]) if (typeof source[key] === "string") return String(source[key]);
  }
  return String(reason || "");
}

function alreadyHasEmbeddedWallet(reason: unknown) {
  return errorMessage(reason).toLowerCase().includes("already has an embedded wallet");
}

export function usePrivyMemberWallet() {
  const { ready: authReady, authenticated, login, user } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signMessage: privySignMessage } = useSignMessage();
  const { signTypedData: privySignTypedData } = useSignTypedData();
  const [creating, setCreating] = useState(false);
  const [walletError, setWalletError] = useState<{ owner: string; message: string } | null>(null);
  const [createdWallet, setCreatedWallet] = useState<{ owner: string; address: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const attempted = useRef(false);
  const walletsRef = useRef(wallets);
  const wallet = embeddedEthereumWallet(wallets);
  const userId = user?.id || "";
  const address = wallet?.address || (createdWallet?.owner === userId ? createdWallet.address : "");
  const error = walletError?.owner === userId ? walletError.message : "";

  useEffect(() => { walletsRef.current = wallets; }, [wallets]);
  useEffect(() => {
    if (!authenticated) attempted.current = false;
  }, [authenticated]);

  const waitForEmbeddedWallet = useCallback(async (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = embeddedEthereumWallet(walletsRef.current);
      if (current) {
        setWalletError(null);
        return current.address;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return "";
  }, []);

  useEffect(() => {
    if (!authReady || !walletsReady || !authenticated || wallet || creating || attempted.current) return;
    attempted.current = true;
    setCreating(true);
    setWalletError(null);
    const creation = walletCreation ||= createWallet().then((created) => ({ address: created.address })).finally(() => { walletCreation = null; });
    void creation
      .then(async (created) => {
        if (created.address) setCreatedWallet({ owner: userId, address: created.address });
        await waitForEmbeddedWallet(10_000);
      })
      .catch(async (reason) => {
        if (alreadyHasEmbeddedWallet(reason)) {
          const addressAfterRace = await waitForEmbeddedWallet(15_000);
          if (!addressAfterRace) setWalletError({ owner: userId, message: "Your Privy embedded wallet is still being prepared. Try again in a moment." });
          return;
        }
        setWalletError({ owner: userId, message: errorMessage(reason) || "Your Privy wallet could not be created." });
      })
      .finally(() => setCreating(false));
  }, [authReady, authenticated, createWallet, creating, retryNonce, userId, waitForEmbeddedWallet, wallet, walletsReady]);

  const retry = useCallback(() => {
    attempted.current = false;
    setCreatedWallet(null);
    setWalletError(null);
    setRetryNonce((value) => value + 1);
  }, []);

  const requireAddress = useCallback(() => {
    if (!authenticated) throw new Error("Sign in to continue.");
    if (!address) throw new Error(error || (creating ? "Your Privy wallet is being created. Try again shortly." : "Your Privy embedded wallet is not ready."));
    return address;
  }, [address, authenticated, creating, error]);

  const signMessage = useCallback(async (message: string) => {
    const address = requireAddress();
    return (await privySignMessage({ message }, { address })).signature;
  }, [privySignMessage, requireAddress]);

  const signTypedData = useCallback(async (input: Parameters<typeof privySignTypedData>[0]) => {
    const address = requireAddress();
    return (await privySignTypedData(input, { address })).signature;
  }, [privySignTypedData, requireAddress]);

  return {
    ready: authReady && walletsReady && (!authenticated || Boolean(address) || Boolean(error)),
    authenticated,
    address,
    creating,
    error: address ? "" : error,
    login,
    retry,
    signMessage,
    signTypedData,
  };
}
