import { useCallback, useEffect, useState } from "react";

/**
 * Wallet-based authentication: there is no username, password, or session.
 * The account the wallet exposes IS the identity, and the private key never
 * leaves the wallet — this app never sees or handles a key.
 */
export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const hasWallet = typeof window !== "undefined" && Boolean(window.ethereum);

  const connect = useCallback(async () => {
    if (!hasWallet) {
      setError("No Ethereum wallet detected. Install MetaMask to continue.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0] ?? null);
      const id = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(parseInt(id, 16));
    } catch (err) {
      setError(err?.code === 4001 ? "Connection request rejected." : err.message);
    } finally {
      setConnecting(false);
    }
  }, [hasWallet]);

  // Reflect a wallet the user already authorised, without prompting them.
  useEffect(() => {
    if (!hasWallet) return;
    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts) => setAccount(accounts[0] ?? null))
      .catch(() => {});
    window.ethereum
      .request({ method: "eth_chainId" })
      .then((id) => setChainId(parseInt(id, 16)))
      .catch(() => {});
  }, [hasWallet]);

  useEffect(() => {
    if (!hasWallet) return;
    const onAccounts = (accounts) => setAccount(accounts[0] ?? null);
    const onChain = (id) => setChainId(parseInt(id, 16));

    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccounts);
      window.ethereum.removeListener("chainChanged", onChain);
    };
  }, [hasWallet]);

  return { account, chainId, connect, connecting, error, hasWallet };
}
