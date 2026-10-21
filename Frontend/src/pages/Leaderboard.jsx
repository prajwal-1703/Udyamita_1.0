import React, { useCallback, useEffect, useState } from "react";
import Navbar from "@/components/Navbar.jsx";
import { contracts, readProvider, addressUrl } from "@/lib/chain";
import { titleFor } from "@/lib/progression";
import { contractsConfigured } from "@/config";

const PAGE = 200;

// v1.0 recomputed every user's XP in the viewer's browser from GitHub (and, without a token,
// substituted repos*10 + followers*5), so two visitors could see different rankings.
// v1.1 ranks by the XP recorded on chain, which is the same for everyone.
const Leaderboard = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (!contractsConfigured()) throw new Error("Contract addresses are not configured.");
      const { userDatabase } = contracts(readProvider());
      const n = Number(await userDatabase.getUserCount());
      const rows = [];
      for (let offset = 0; offset < n; offset += PAGE) {
        const [wallets, profiles, logins] = await userDatabase.getUsers(offset, PAGE);
        wallets.forEach((w, i) => {
          if (profiles[i].suspended) return;
          rows.push({ wallet: w, login: logins[i], xp: Number(profiles[i].xp), level: Number(profiles[i].level) });
        });
      }
      rows.sort((a, b) => b.xp - a.xp || a.login.localeCompare(b.login));
      setUsers(rows);
    } catch (e) {
      setError(e.message || "Failed to load leaderboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Navbar />
      <div className="container mx-auto p-4 md:p-6 pt-24 flex-grow">
        <h1 className="text-3xl font-bold text-center mb-6">Leaderboard</h1>
        {loading && <p className="text-center text-blue-600 dark:text-blue-400">Loading leaderboard...</p>}
        {error && <div className="text-center text-red-600 bg-red-100 dark:bg-red-900 p-4 rounded-md"><span className="font-semibold">Error:</span> {error}</div>}
        {!loading && !error && users.length === 0 && <p className="text-center text-gray-500">No users yet.</p>}
        {!loading && !error && users.length > 0 && (
          <div className="overflow-x-auto shadow-md rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-center w-16">Rank</th>
                  <th className="px-6 py-3">GitHub</th>
                  <th className="px-6 py-3">Level</th>
                  <th className="px-6 py-3 hidden md:table-cell">Wallet</th>
                  <th className="px-6 py-3 text-right">XP</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.wallet} className="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
                    <td className="px-4 py-4 text-center">{i + 1}</td>
                    <td className="px-6 py-4 font-medium"><a className="hover:underline" href={`https://github.com/${u.login}`} target="_blank" rel="noopener noreferrer">@{u.login}</a></td>
                    <td className="px-6 py-4">{u.level} <span className="text-xs text-gray-500">{titleFor(u.level)}</span></td>
                    <td className="px-6 py-4 font-mono text-xs hidden md:table-cell"><a className="hover:underline" href={addressUrl(u.wallet)} target="_blank" rel="noopener noreferrer">{u.wallet.slice(0, 10)}...{u.wallet.slice(-6)}</a></td>
                    <td className="px-6 py-4 font-bold text-right text-indigo-600 dark:text-indigo-400">{u.xp.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Leaderboard;
