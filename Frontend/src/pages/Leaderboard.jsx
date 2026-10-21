// src/components/Leaderboard.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { ethers } from "ethers";
import UserDatabaseABI from "../abis/UserDatabase.json";
import Navbar from "@/components/Navbar.jsx";

const CONTRACT_ADDRESS = "0xe92cFff8436007F804F2ec05AF83851AD3dA9945";

const Leaderboard = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const contractRef = useRef(null);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (!window.ethereum) {
                throw new Error("MetaMask not detected. Please install it to view the leaderboard.");
            }
            const provider = new ethers.BrowserProvider(window.ethereum);
            // Read-only, so provider is sufficient
            contractRef.current = new ethers.Contract(CONTRACT_ADDRESS, UserDatabaseABI.abi, provider);

            console.log("Fetching users from contract...");
            const allUsersRaw = await contractRef.current.getAllUsers();

            if (!allUsersRaw || allUsersRaw.length === 0) {
                setUsers([]);
                return;
            }

            // Map contract data to friendly format
            // Contract struct: { wallet, username, xp, lastRewardedLevel }
            const formattedUsers = allUsersRaw.map(user => ({
                wallet: user.wallet,
                username: user.username,
                xp: Number(user.xp), // Convert BigInt to Number
            })).filter(u => u.wallet && u.wallet !== ethers.ZeroAddress);

            // === STEP 3: Fetch XP Data from GitHub (Client-Side) ===
            console.log(`Leaderboard: Fetching GitHub data for ${formattedUsers.length} users...`);

            const token = localStorage.getItem("github_token");
            const headers = token ? { Authorization: `token ${token}` } : {};

            const xpPromises = formattedUsers.map(async (user) => {
                if (!user.username) return { ...user, xp: 0 };

                try {
                    // Option A: Use GraphQL for accurate contribution count (Same as Dashboard)
                    // This requires a token. If no token, fall back to REST (less accurate).
                    if (token) {
                        const query = `{ user(login: "${user.username}") { contributionsCollection { contributionCalendar { totalContributions } } } }`;
                        const res = await fetch("https://api.github.com/graphql", {
                            method: "POST",
                            headers: { ...headers, "Content-Type": "application/json" },
                            body: JSON.stringify({ query })
                        });
                        const data = await res.json();
                        if (data.data?.user?.contributionsCollection) {
                            const contribs = data.data.user.contributionsCollection.contributionCalendar.totalContributions;
                            return { ...user, xp: contribs * 50 };
                        }
                    }

                    // Option B: Fallback to REST API (Public info only)
                    // Note: REST API doesn't give "total contributions" easily. 
                    // We'll use a simplified metric: (Public Repos * 10) + (Followers * 5)
                    const res = await fetch(`https://api.github.com/users/${user.username}`, { headers });
                    if (!res.ok) throw new Error("Failed to fetch");
                    const ghUser = await res.json();
                    const simulatedXP = (ghUser.public_repos * 10) + (ghUser.followers * 5);
                    return { ...user, xp: simulatedXP };

                } catch (e) {
                    console.warn(`Failed to fetch stats for ${user.username}`, e);
                    return { ...user, xp: 0 };
                }
            });

            const usersWithXP = await Promise.all(xpPromises);

            // Sort by XP descending
            const sortedUsers = usersWithXP.sort((a, b) => b.xp - a.xp);
            setUsers(sortedUsers);

        } catch (err) {
            console.error("Leaderboard fetch error:", err);
            setError(err.message || "Failed to load leaderboard.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();

        // Optional: Listener for live updates
        const setupListener = async () => {
            if (!window.ethereum) return;
            const provider = new ethers.BrowserProvider(window.ethereum);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, UserDatabaseABI.abi, provider);

            const handleUpdate = () => {
                console.log("XP Update detected, refreshing leaderboard...");
                fetchUsers();
            };

            try {
                contract.on("UserXPUpdated", handleUpdate);
            } catch (e) { console.error("Listener setup failed", e); }

            return () => {
                try { contract.removeAllListeners("UserXPUpdated"); } catch (e) { }
            };
        };

        const cleanup = setupListener();
        return () => { cleanup.then(c => c && c()); };

    }, [fetchUsers]);

    return (
        <div className="min-h-screen flex flex-col bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
            <Navbar />
            <div className="container mx-auto p-4 md:p-6 flex-grow">
                <h1 className="text-3xl font-bold text-center mb-6 text-gray-800 dark:text-gray-200">Leaderboard</h1>

                {loading && (
                    <p className="text-center text-blue-600 dark:text-blue-400">Loading Leaderboard...</p>
                )}

                {error && (
                    <div className="text-center text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900 p-4 rounded-md">
                        <span className="font-semibold">Error:</span> {error}
                    </div>
                )}

                {!loading && !error && users.length === 0 && (
                    <p className="text-center text-gray-500">No users found.</p>
                )}

                {!loading && !error && users.length > 0 && (
                    <div className="overflow-x-auto shadow-md rounded-lg border border-gray-200 dark:border-gray-700">
                        <table className="w-full text-sm text-left text-gray-600 dark:text-gray-400">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                                <tr>
                                    <th className="px-4 py-3 text-center w-16">Rank</th>
                                    <th className="px-6 py-3">Username</th>
                                    <th className="px-6 py-3">Wallet</th>
                                    <th className="px-6 py-3 text-right">XP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user, index) => (
                                    <tr key={index} className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50">
                                        <td className="px-4 py-4 text-center">{index + 1}</td>
                                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{user.username}</td>
                                        <td className="px-6 py-4 font-mono text-xs text-gray-500 truncate max-w-xs">{user.wallet}</td>
                                        <td className="px-6 py-4 font-bold text-right text-indigo-600 dark:text-indigo-400">{user.xp}</td>
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
