import { useCallback, useEffect, useRef, useState } from "react";
import { useCreateWallet, usePrivy, useSignMessage, useSignTypedData, useWallets } from "@privy-io/react-auth";

type WalletLike = {
  address: string;
  chainType?: string;
  walletClientType?: string;
  connectorType?: string;
  imported?: boolean;
};

function embeddedEthereumWallet(wallets: WalletLike[]) {
  return wallets.find((wallet) => wallet.chainType === "ethereum" && ["privy", "privy-v2"].includes(wallet.walletClientType || "") && wallet.connectorType === "embedded" && !wallet.imported);
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
  const wallet = embeddedEthereumWallet(wallets as WalletLike[]);

  useEffect(() => {
    if (!authenticated) attempted.current = false;
  }, [authenticated]);

  useEffect(() => {
    if (!authReady || !walletsReady || !authenticated || wallet || creating || attempted.current) return;
    attempted.current = true;
    setCreating(true);
    setError("");
    void createWallet()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Your Privy wallet could not be created."))
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
    error,
    login,
    signMessage,
    signTypedData,
  };
}
