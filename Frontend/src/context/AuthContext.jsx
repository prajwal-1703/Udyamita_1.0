import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ethers } from "ethers";
import { contracts, readProvider } from "@/lib/chain";
import { contractsConfigured } from "@/config";
import { api } from "@/lib/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/**
 * Two identities, kept separate:
 *  - wallet: from MetaMask
 *  - github: from the backend's OAuth session cookie (v1.0 kept a GitHub token in localStorage)
 * plus the on-chain profile that binds them.
 */
export const AuthProvider = ({ children }) => {
  const [wallet, setWallet] = useState(null);
  const [github, setGithub] = useState(null);     // { githubId, login, avatarUrl, wallet }
  const [profile, setProfile] = useState(null);   // on-chain UserDatabase.User or null
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (addr) => {
    if (!addr || !contractsConfigured()) { setProfile(null); return null; }
    const { userDatabase } = contracts(readProvider());
    if (!(await userDatabase.isRegistered(addr))) { setProfile(null); return null; }
    const u = await userDatabase.getUser(addr);
    const p = {
      githubId: u.githubId.toString(), xp: Number(u.xp), level: Number(u.level),
      earned: u.earned, lastSync: Number(u.lastSync), suspended: u.suspended,
      login: await userDatabase.loginOf(addr),
    };
    setProfile(p);
    return p;
  }, []);

  const loadGithub = useCallback(async () => {
    try { setGithub(await api.me()); } catch { setGithub(null); }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadGithub(), loadProfile(wallet)]);
  }, [loadGithub, loadProfile, wallet]);

  useEffect(() => {
    (async () => {
      try {
        if (window.ethereum) {
          const accounts = await window.ethereum.request({ method: "eth_accounts" });
          if (accounts[0]) setWallet(ethers.getAddress(accounts[0]));
        }
        await loadGithub();
      } finally {
        setLoading(false);
      }
    })();
    if (!window.ethereum) return undefined;
    const onAccounts = (accs) => setWallet(accs[0] ? ethers.getAddress(accs[0]) : null);
    const onChain = () => window.location.reload();
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [loadGithub]);

  useEffect(() => { loadProfile(wallet).catch(() => setProfile(null)); }, [wallet, loadProfile]);

  const connectWallet = async () => {
    if (!window.ethereum) throw new Error("Please install MetaMask.");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    setWallet(ethers.getAddress(accounts[0]));
  };

  const connectGithub = () => { window.location.href = api.githubLoginUrl(); };
  const disconnectGithub = async () => { await api.logout().catch(() => {}); setGithub(null); };

  return (
    <AuthContext.Provider value={{
      wallet, github, profile, loading,
      connectWallet, connectGithub, disconnectGithub, refresh, loadProfile,
      // v1.0 compatibility for components that read currentUser/login
      currentUser: wallet ? { wallet } : null, isConnected: !!wallet, login: connectWallet,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
