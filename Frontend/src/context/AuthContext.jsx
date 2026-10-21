
import React, { createContext, useContext, useState, useEffect } from 'react';
import { ethers } from 'ethers';
import UserDatabaseABI from '../abis/UserDatabase.json';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

// Hardcoded for now, should ideally be in env but client-side logic needs it
const USER_DB_ADDRESS = "0xe92cFff8436007F804F2ec05AF83851AD3dA9945";

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null); // { wallet, username, ... }
    const [loading, setLoading] = useState(true);
    const [isConnected, setIsConnected] = useState(false);

    // Initialize wallet connection on load
    useEffect(() => {
        checkConnection();
    }, []);

    const checkConnection = async () => {
        if (typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts.length > 0) {
                    handleUserLogin(accounts[0]);
                } else {
                    setLoading(false);
                }
            } catch (err) {
                console.error("Connection check failed", err);
                setLoading(false);
            }
        } else {
            setLoading(false);
        }
    };

    const login = async () => {
        if (typeof window.ethereum === 'undefined') {
            alert("Please install MetaMask!");
            return;
        }
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            await handleUserLogin(accounts[0]);
            return true;
        } catch (error) {
            console.error("Login failed:", error);
            return false;
        }
    };

    const logout = () => {
        setCurrentUser(null);
        setIsConnected(false);
        // MetaMask doesn't strictly "disconnect", but we clear our app state
    };

    const handleUserLogin = async (walletAddress) => {
        try {
            setLoading(true);
            const provider = new ethers.BrowserProvider(window.ethereum);
            const contract = new ethers.Contract(USER_DB_ADDRESS, UserDatabaseABI.abi, provider);

            // Fetch User Details from Contract
            let userData = { wallet: walletAddress, isRegistered: false };

            try {
                const userStruct = await contract.getUser(walletAddress);
                // If call succeeds, user exists
                userData = {
                    wallet: walletAddress,
                    username: userStruct.username,
                    xp: Number(userStruct.xp),
                    isRegistered: true
                };
            } catch (err) {
                // Expected if user doesn't exist (assuming contract reverts or returns empty)
                // Check if error is "User does not exist" or similar
                console.log("User might be new or fetch failed:", err);
            }

            setCurrentUser(userData);
            setIsConnected(true);
        } catch (error) {
            console.error("Error fetching user details:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthContext.Provider value={{ currentUser, isConnected, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};
