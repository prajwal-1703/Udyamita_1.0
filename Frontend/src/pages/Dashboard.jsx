import React, { useEffect, useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
// useSearchParams removed
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Wallet, Github, Star, GitFork, Code, ExternalLink, Award, CircleHelp, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatUnits, parseUnits, isAddress } from "ethers";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ethers } from "ethers";
import { useAuth } from "@/context/AuthContext";

const UCOIN_DECIMALS = 18;

// --- Updated Contract ABIs and Addresses ---
import UserDatabaseABI from "../abis/UserDatabase.json";
import RewardMechanismABI from "../abis/RewardMechanism.json";
import UCoinABI from "../abis/UCoin.json";
const CONTRACT_ADDRESSES = {
  userDatabase: "0xe92cFff8436007F804F2ec05AF83851AD3dA9945",
  rewardMechanism: "0xaF6b1E1A7A7A7D94FE7d571E269582e8F94EC561",
  ucoin: "0x383125a9312fbc54a62d08e1638628C6BB7B77f7"
};

// --- Level & Token Calculations ---
const calculateTokensForLevel = (level) => {
  if (level <= 0) return 0;
  return (5 * Math.pow(1.08, level));
};

const calculateTotalTokensForLevel = (level) => {
  let totalTokens = 0;
  for (let i = 1; i <= level; i++) {
    totalTokens += calculateTokensForLevel(i);
  }
  return parseFloat(totalTokens.toFixed(4));
};

const calculateLevelAndTitle = (xps) => {
  let level = 0;
  let requiredXps = 0;
  if (xps < 0) xps = 0;
  while (requiredXps <= xps) {
    level++;
    requiredXps = (level * (level + 1) * 50);
  }
  level--;
  level = Math.max(0, level);
  const nextLevelXps = (level + 1) * ((level + 1) + 1) * 50;
  const titles = [
    'Apprentice', 'Aspiring', 'Novice', 'Enthusiastic', 'Explorer',
    'Code Craftsman', 'Skilled', 'Proficient', 'Champion', 'Quality',
    'Expert', 'Professional', 'Innovative', 'Veteran', 'Rising',
    'Master', 'Conquerer', 'Top Tier', 'Insightful', 'Legendary', 'SUPREME'
  ];
  const titleIndex = Math.min(Math.floor(level / 5), titles.length - 1);
  return { level, title: titles[titleIndex] || 'Contributor', nextLevelXps };
};

const determineRole = (totalContributions) => {
  if (totalContributions > 100) return 'Maintainer';
  if (totalContributions > 50) return 'Reviewer';
  return 'Contributor';
};

const calculateStreak = (events) => {
  if (!events || events.length === 0) return 0;
  const sortedEventTimestamps = events
    .map((event) => new Date(event.created_at).setHours(0, 0, 0, 0))
    .filter((timestamp, index, self) => self.indexOf(timestamp) === index)
    .sort((a, b) => b - a);
  if (sortedEventTimestamps.length === 0) return 0;
  let streak = 0;
  let today = new Date(); today.setHours(0, 0, 0, 0);
  let currentExpectedTime = today.getTime();
  if (sortedEventTimestamps[0] === currentExpectedTime || sortedEventTimestamps[0] === currentExpectedTime - 86400000) {
    streak = 1;
    currentExpectedTime = sortedEventTimestamps[0];
    for (let i = 1; i < sortedEventTimestamps.length; i++) {
      const previousExpectedTime = currentExpectedTime - 86400000;
      if (sortedEventTimestamps[i] === previousExpectedTime) {
        streak++; currentExpectedTime = sortedEventTimestamps[i];
      } else { break; }
    }
  }
  return streak;
};


const Dashboard = () => {
  const { currentUser, isConnected, login, loading: authLoading } = useAuth();
  const walletAddress = currentUser?.wallet;

  // --- State Variables ---
  const [userData, setUserData] = useState(null);
  const [repos, setRepos] = useState([]);
  const [localLoading, setLocalLoading] = useState(true);
  const isLoading = localLoading || authLoading;
  const { toast } = useToast();

  const [contributionStats, setContributionStats] = useState({
    totalContributions: 0, recentContributions: [], streak: 0, xps: 0,
    role: 'Contributor', level: 0, title: 'Apprentice', nextLevelXps: 100
  });

  const [ucoinBalance, setUcoinBalance] = useState(0);
  const [isRequestPending, setIsRequestPending] = useState(false);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [withdrawRequestAmount, setWithdrawRequestAmount] = useState("");
  const [isRequestingWithdrawal, setIsRequestingWithdrawal] = useState(false);

  const [contracts, setContracts] = useState({ userDatabase: null, rewardMechanism: null, ucoin: null });

  const [totalEarnableTokens, setTotalEarnableTokens] = useState(0);
  // **MODIFIED**: Tracks claimed amount, initialized at 0, hydrated from localStorage
  const [totalClaimedAmount, setTotalClaimedAmount] = useState(0);
  // **REMOVED**: isFetchingClaimed state

  const [isOwner, setIsOwner] = useState(false);
  const [pendingWithdrawals, setPendingWithdrawals] = useState([]);
  const [pendingWithdrawalsLoading, setPendingWithdrawalsLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  // **KEPT (for Owner Tab)**: State for actual blockchain withdrawal history
  const [withdrawalHistory, setWithdrawalHistory] = useState([]);


  // --- Core Functions ---

  // Contract Initialization (No changes needed)
  const initializeContracts = useCallback(async (wallet) => {
    try {
      if (!window.ethereum) throw new Error("Ethereum provider missing.");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      if (!isAddress(CONTRACT_ADDRESSES.userDatabase) || !isAddress(CONTRACT_ADDRESSES.rewardMechanism) || !isAddress(CONTRACT_ADDRESSES.ucoin)) {
        throw new Error("One or more contract addresses are invalid.");
      }
      setContracts({
        userDatabase: new ethers.Contract(CONTRACT_ADDRESSES.userDatabase, UserDatabaseABI.abi, signer),
        rewardMechanism: new ethers.Contract(CONTRACT_ADDRESSES.rewardMechanism, RewardMechanismABI.abi, signer),
        ucoin: new ethers.Contract(CONTRACT_ADDRESSES.ucoin, UCoinABI.abi, signer),
      });
      console.log("Contracts initialized:", CONTRACT_ADDRESSES);
      return true;
    } catch (error) {
      console.error("Contract initialization error:", error);
      toast({ variant: "destructive", title: "Contract Error", description: error.message || "Failed to initialize contracts." });
      setContracts({ userDatabase: null, rewardMechanism: null, ucoin: null });
      return false;
    }
  }, [toast]);

  // Initialize contracts when wallet address changes
  useEffect(() => {
    if (walletAddress) {
      initializeContracts(walletAddress);
    }
  }, [walletAddress, initializeContracts]);




  // User Registration (No changes needed)
  const registerUser = useCallback(async () => {
    if (!contracts.userDatabase || !userData?.login || !walletAddress) { return; }
    try {
      const tx = await contracts.userDatabase.setUser(userData.login);
      toast({ title: "Registering User...", description: `Linking ${userData.login} to your wallet...` });
      await tx.wait();
      toast({ variant: "success", title: "Registration Successful", description: `GitHub user ${userData.login} linked.` });
    } catch (error) {
      console.error("Registration error:", error);
      const reason = error.reason || error.data?.message || error.message || "An unknown error occurred";
      if (!reason.toLowerCase().includes("user already exists") && !reason.toLowerCase().includes("already linked")) {
        toast({ variant: "destructive", title: "Registration Failed", description: reason });
      } else { console.log("Registration skipped: User likely already exists or linked."); }
    }
  }, [contracts.userDatabase, userData, walletAddress, toast]);

  // Fetch Pending Withdrawal Status (No changes needed)
  const fetchPendingRequestStatus = useCallback(async () => {
    if (!walletAddress || !contracts.rewardMechanism) { setIsRequestPending(false); setPendingAmount(0); return; }
    setIsCheckingStatus(true);
    try {
      const requestData = await contracts.rewardMechanism.getPendingRequest(walletAddress);
      const currentlyPending = requestData.isPending;
      const requestedAmountBigInt = requestData.amount;
      const requestedAmountFormatted = parseFloat(formatUnits(requestedAmountBigInt, UCOIN_DECIMALS));
      if (currentlyPending !== isRequestPending || requestedAmountFormatted !== pendingAmount) {
        setIsRequestPending(currentlyPending); setPendingAmount(requestedAmountFormatted);
      }
    } catch (error) {
      console.error("[Status Check] Error fetching status:", error);
      setIsRequestPending(false); setPendingAmount(0);
    } finally { setIsCheckingStatus(false); }
  }, [walletAddress, contracts.rewardMechanism, isRequestPending, pendingAmount]);

  // **REMOVED**: fetchTotalClaimedAmount function

  // **KEPT (for Owner Tab)**: Fetch actual withdrawal history from blockchain events
  const fetchWithdrawalHistory = useCallback(async () => {
    if (!walletAddress || !contracts.rewardMechanism) {
      setWithdrawalHistory([]); return;
    }
    console.log("[Owner History Check] Fetching withdrawal history...");
    try {
      const filter = contracts.rewardMechanism.filters.WithdrawalApproved(); // Event is WithdrawalApproved
      let events = [];
      try {
        if (window.ethereum) {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const currentBlock = await provider.getBlockNumber();
          const fromBlock = Math.max(0, currentBlock - 45000);
          events = await contracts.rewardMechanism.queryFilter(filter, fromBlock, currentBlock);
        } else {
          events = await contracts.rewardMechanism.queryFilter(filter);
        }
      } catch (qErr) {
        console.warn("Event query error:", qErr);
        events = [];
      }

      const historyPromises = events.map(async (event) => {
        try {
          const block = await event.getBlock();
          return {
            user: event.args.user,
            amount: formatUnits(event.args.amount, UCOIN_DECIMALS),
            timestamp: block ? block.timestamp * 1000 : Date.now(),
            txHash: event.transactionHash
          };
        } catch (blockError) {
          console.error("Error fetching block for event:", event.transactionHash, blockError);
          return {
            user: event.args.user,
            amount: formatUnits(event.args.amount, UCOIN_DECIMALS),
            timestamp: Date.now(),
            txHash: event.transactionHash,
            error: "Could not fetch timestamp"
          };
        }
      });
      const history = (await Promise.all(historyPromises))
        .filter(item => item)
        .sort((a, b) => b.timestamp - a.timestamp);
      setWithdrawalHistory(history);
      console.log("[Owner History Check] Found", history.length, "completed withdrawals for Owner tab.");
    } catch (error) {
      console.error("Error fetching withdrawal history for Owner:", error);
      setWithdrawalHistory([]);
    }
  }, [walletAddress, contracts.rewardMechanism]);


  // Handle Withdrawal Request (Updates frontend state & triggers save to localStorage)
  const handleRequestWithdrawal = useCallback(async () => {
    // Initial checks
    if (!contracts.rewardMechanism || !walletAddress || isRequestPending) {
      toast({ variant: "destructive", title: "Request Error", description: isRequestPending ? "Request already pending." : "Wallet/contract not ready." }); return;
    }
    if (!withdrawRequestAmount || parseFloat(withdrawRequestAmount) <= 0) {
      toast({ variant: "destructive", title: "Invalid Amount", description: "Enter a positive amount." }); return;
    }

    const requestedAmount = parseFloat(withdrawRequestAmount);
    // Validation uses totalClaimedAmount state (hydrated from localStorage)
    const maxRequestableNowCalc = Math.max(0, totalEarnableTokens - totalClaimedAmount);

    if (requestedAmount > maxRequestableNowCalc) {
      toast({
        variant: "destructive", title: "Limit Exceeded",
        description: `Request exceeds available limit based on level and claimed amounts.`
      });
      return;
    }

    setIsRequestingWithdrawal(true);
    let parsedAmount;
    try {
      parsedAmount = parseUnits(withdrawRequestAmount, UCOIN_DECIMALS);
      toast({ title: "Submitting Request...", description: `Requesting ${withdrawRequestAmount} UCoin...` });
      const tx = await contracts.rewardMechanism.requestWithdrawal(parsedAmount);
      toast({ title: "Processing Tx", description: `Waiting for confirmation... Tx: ${tx.hash.substring(0, 10)}...` });
      await tx.wait(); // Wait for transaction confirmation

      // --- Optimistically update frontend claimed amount state ---
      const requestedAmountNum = parseFloat(withdrawRequestAmount);
      if (!isNaN(requestedAmountNum)) {
        // This state update will trigger the useEffect to save to localStorage
        setTotalClaimedAmount(prevClaimed => {
          const newTotal = prevClaimed + requestedAmountNum;
          console.log(`[State Update] Claimed amount updated via request. New total: ${newTotal}`);
          return newTotal; // Return the new value for the state setter
        });
      }
      // ----------------------------------------------------

      toast({ variant: "success", title: "Withdrawal Requested", description: `Request for ${withdrawRequestAmount} UCoin pending approval.` });
      await fetchPendingRequestStatus(); // Re-fetch status
      setIsRequestDialogOpen(false);
      setWithdrawRequestAmount("");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error) {
      console.error("Withdrawal request error:", error);
      let reason = "Transaction failed.";
      // Keep error parsing relevant to the current contract
      if (error.reason?.includes("RM_RequestAlreadyPending")) { reason = "You already have a pending request."; await fetchPendingRequestStatus(); }
      else if (error.reason?.includes("RM_AmountMustBePositive")) { reason = "Amount must be > 0."; }
      else { reason = error.reason || error.data?.message || error.message || reason; }
      toast({ variant: "destructive", title: "Request Failed", description: reason });
    } finally {
      setIsRequestingWithdrawal(false);
    }
  }, [ // Dependencies include totalClaimedAmount for validation
    contracts.rewardMechanism, walletAddress, isRequestPending, withdrawRequestAmount,
    toast, fetchPendingRequestStatus, totalEarnableTokens, totalClaimedAmount
  ]);


  // Fetch UCoin Balance (No changes needed)
  const fetchUCoinBalance = useCallback(async () => {
    if (!walletAddress || !contracts.ucoin) { if (ucoinBalance !== 0) setUcoinBalance(0); return; }
    console.log(`[Balance Check] Fetching balance for ${walletAddress}`);
    try {
      const balanceBigInt = await contracts.ucoin.balanceOf(walletAddress);
      const balanceFormatted = parseFloat(formatUnits(balanceBigInt, UCOIN_DECIMALS));
      if (balanceFormatted !== ucoinBalance) {
        console.log(`[Balance Check] Updating balance state from ${ucoinBalance} to ${balanceFormatted}`);
        setUcoinBalance(balanceFormatted);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error) {
      console.error("[Balance Check] Error fetching UCoin balance:", error);
      if (ucoinBalance !== 0) setUcoinBalance(0); // Reset on error
    }
  }, [walletAddress, contracts.ucoin, ucoinBalance]);

  const addTokenToMetaMask = useCallback(async () => {
    if (typeof window.ethereum !== "undefined") {
      try {
        await window.ethereum.request({
          method: "wallet_watchAsset",
          params: {
            type: "ERC20",
            options: {
              address: CONTRACT_ADDRESSES.ucoin,
              symbol: "UCN",
              decimals: UCOIN_DECIMALS,
            },
          },
        });
        toast({ title: "MetaMask", description: "UCoin (UCN) import prompt sent to MetaMask." });
      } catch (error) {
        console.error("Error adding token to MetaMask:", error);
        toast({ variant: "destructive", title: "Error", description: error.message });
      }
    } else {
      toast({ variant: "destructive", title: "MetaMask not found", description: "Please install MetaMask." });
    }
  }, [toast]);


  // --- GitHub Data Fetching Logic (Original Versions Kept) ---
  const processGitHubUser = useCallback((user) => {
    if (user && user.accessToken && user.username) {
      console.log("Processing GitHub user data for:", user.username);
      localStorage.setItem("github_token", user.accessToken);
      const processedUserData = {
        name: user.displayName || user.username, login: user.username,
        avatar_url: user.photos?.[0]?.value || user._json?.avatar_url,
        bio: user._json?.bio || "No bio available", public_repos: user._json?.public_repos || 0,
        followers: user._json?.followers || 0, following: user._json?.following || 0,
        html_url: user.profileUrl || `https://github.com/${user.username}`,
      };
      setUserData(processedUserData);
      fetchRepos(user.accessToken);
      fetchContributionStats(user.accessToken, processedUserData.login);
    } else {
      console.warn("processGitHubUser called without complete user data:", user);
      setLocalLoading(false);
    }
  }, []); // dependencies added below where functions are defined

  const fetchContributionStats = useCallback(async (token, username) => {
    if (!token) { console.log("Skipping contribution fetch: missing token"); return; }
    try {
      const query = `{ viewer { login contributionsCollection { contributionCalendar { totalContributions } commitContributionsByRepository(maxRepositories: 50) { repository { name url } contributions(first: 1, orderBy: {field: OCCURRED_AT, direction: DESC}) { nodes { occurredAt } totalCount } } } } }`;
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) { throw new Error(`GitHub API Error: ${response.statusText}`); }
      const result = await response.json();
      if (result.errors) { throw new Error(`GraphQL Error: ${result.errors[0].message}`); }
      if (!result.data || !result.data.viewer) { throw new Error("GraphQL Error: No viewer data returned."); }
      const data = result.data.viewer.contributionsCollection;
      const totalContributions = data.contributionCalendar.totalContributions;
      const xps = totalContributions * 50;
      const { level, title, nextLevelXps } = calculateLevelAndTitle(xps);
      const role = determineRole(totalContributions);
      const recentCommitEvents = data.commitContributionsByRepository
        .filter(repoContrib => repoContrib.contributions.nodes.length > 0)
        .map((repoContrib) => ({ type: `Committed to ${repoContrib.repository.name}`, created_at: repoContrib.contributions.nodes[0].occurredAt, url: repoContrib.repository.url }));
      const sortedRecentActivity = recentCommitEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const streak = calculateStreak(sortedRecentActivity);
      setContributionStats({ xps, level, title, nextLevelXps, totalContributions, streak, role, recentContributions: sortedRecentActivity.slice(0, 10) });
      console.log(`Stats updated: Level ${level}, XP ${xps}, Total Contribs ${totalContributions} for ${username}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error) {
      console.error("GitHub contribution fetch error:", error);
      toast({ variant: "destructive", title: "GitHub Error", description: `Failed to fetch contribution data: ${error.message}` });
    }
  }, [toast]); // Added toast dependency

  const fetchUserWithToken = useCallback(async (token) => {
    try {
      const userRes = await fetch("https://api.github.com/user", { headers: { Authorization: `token ${token}` } });
      if (!userRes.ok) {
        if (userRes.status === 401) {
          console.warn("GitHub token invalid/expired."); localStorage.removeItem("github_token");
          toast({ variant: "destructive", title: "GitHub Auth Failed", description: "Token invalid. Please reconnect." });
          setUserData(null); setContributionStats(prev => ({ ...prev, level: 0, xps: 0, totalContributions: 0, title: 'Apprentice', nextLevelXps: 100, streak: 0, role: 'Contributor', recentContributions: [] }));
        } else { throw new Error(`Failed to fetch GitHub user data: ${userRes.statusText}`); }
        setLocalLoading(false); return;
      }
      const githubApiData = await userRes.json();
      const userObject = { accessToken: token, username: githubApiData.login, displayName: githubApiData.name, photos: [{ value: githubApiData.avatar_url }], profileUrl: githubApiData.html_url, _json: githubApiData };
      processGitHubUser(userObject); // Triggers stats/repos fetches
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error) {
      console.error("GitHub token auth error:", error);
      if (!error.message.includes('401')) { toast({ variant: "destructive", title: "GitHub Fetch Failed", description: error.message }); }
      setLocalLoading(false);
    }
  }, [processGitHubUser, toast]); // Added dependencies

  // Removed fetchUserWithSession - Pure Frontend Mode


  const fetchRepos = useCallback(async (token) => {
    if (!token) { return; }
    try {
      const reposRes = await fetch("https://api.github.com/user/repos?sort=updated&per_page=3", { headers: { Authorization: `token ${token}` } });
      if (!reposRes.ok) throw new Error(`Failed to fetch repositories: ${reposRes.statusText}`);
      const reposData = await reposRes.json();
      setRepos(reposData);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error) {
      console.error("GitHub repos fetch error:", error);
      toast({ variant: "destructive", title: "Repo Fetch Error", description: "Failed to fetch repository data." });
    } finally {
      // Assume this is the last fetch in the auth chain
      setLocalLoading(false);
    }
  }, [toast]); // Added dependency

  // Add fetchRepos and fetchContributionStats as dependencies to processGitHubUser
  // Note: This creates a potential dependency cycle if they also depend on processGitHubUser.
  // It's generally better if processGitHubUser just sets userData and other effects react to userData.
  // However, keeping original structure as requested.
  processGitHubUser.dependencies = [fetchRepos, fetchContributionStats];




  const fetchGithubData = useCallback(async () => {
    setLocalLoading(true);
    try {
      const queryParams = new URLSearchParams(window.location.search);
      const urlToken = queryParams.get("token");
      if (urlToken) {
        localStorage.setItem("github_token", urlToken);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      const token = urlToken || localStorage.getItem("github_token");
      if (token) { await fetchUserWithToken(token); }
      else {
        // No token, stop loading.
        setLocalLoading(false);
      }
    } catch (error) {
      console.error("Error in fetchGithubData:", error); setLocalLoading(false);
    }
  }, [fetchUserWithToken]);


  // --- Admin/Owner Functions ---
  const checkOwnerStatus = useCallback(async () => {
    if (walletAddress && contracts.rewardMechanism) {
      try {
        console.log("Checking owner status...");
        const owner = await contracts.rewardMechanism.owner();
        const isOwnerCheck = owner.toLowerCase() === walletAddress.toLowerCase();
        setIsOwner(isOwnerCheck);
        if (isOwnerCheck) {
          console.log("User is owner, fetching admin data...");
          await fetchPendingWithdrawals();
          // Fetch history for owner tab when owner status confirmed
          await fetchWithdrawalHistory();
        } else { setPendingWithdrawals([]); }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error) {
        console.error("Error checking owner status:", error);
        setIsOwner(false); setPendingWithdrawals([]);
      }
    } else { setIsOwner(false); setPendingWithdrawals([]); }
  }, [walletAddress, contracts.rewardMechanism, fetchWithdrawalHistory]); // Added fetchWithdrawalHistory dependency

  const fetchPendingWithdrawals = async () => {
    if (!contracts.rewardMechanism) return;
    setPendingWithdrawalsLoading(true);
    console.log("Fetching pending withdrawals from Blockchain...");
    try {
      const uniqueRequesters = new Set();

      // 1. Get registered users from UserDatabase (direct contract call, 100% reliable)
      if (contracts.userDatabase) {
        try {
          const registeredUsers = await contracts.userDatabase.getAllUsers();
          registeredUsers.forEach(u => {
            const addr = Array.isArray(u) ? u[0] : (u.walletAddress || u);
            if (addr && ethers.isAddress(addr)) {
              uniqueRequesters.add(addr.toLowerCase());
            }
          });
        } catch (udErr) {
          console.warn("Could not query UserDatabase for users:", udErr);
        }
      }

      // 2. Also query WithdrawalRequested events in safe range
      try {
        const filter = contracts.rewardMechanism.filters.WithdrawalRequested();
        if (window.ethereum) {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const currentBlock = await provider.getBlockNumber();
          const fromBlock = Math.max(0, currentBlock - 45000);
          const events = await contracts.rewardMechanism.queryFilter(filter, fromBlock, currentBlock);
          events.forEach(e => {
            if (e.args?.user) uniqueRequesters.add(e.args.user.toLowerCase());
          });
        }
      } catch (evErr) {
        console.warn("Could not fetch WithdrawalRequested events:", evErr);
      }

      const requestersArray = Array.from(uniqueRequesters);
      if (requestersArray.length === 0) {
        setPendingWithdrawals([]);
        return;
      }

      // 3. Check current pending status for each requester
      const statusPromises = requestersArray.map(async (userAddr) => {
        try {
          const request = await contracts.rewardMechanism.getPendingRequest(userAddr);
          if (request.isPending && request.amount > 0n) {
            return {
              user: userAddr,
              amount: formatUnits(request.amount, UCOIN_DECIMALS),
              requestTimestamp: Math.floor(Date.now() / 1000),
              isPending: true
            };
          }
          return null;
        } catch (e) {
          console.error("Error checking status for", userAddr, e);
          return null;
        }
      });

      const results = await Promise.all(statusPromises);
      const pending = results.filter(r => r !== null);
      console.log(`Found ${pending.length} pending withdrawal requests.`);
      setPendingWithdrawals(pending);

    } catch (error) {
      console.error("Error fetching pending withdrawals:", error);
      setPendingWithdrawals([]);
    }
    finally { setPendingWithdrawalsLoading(false); }
  };

  const approveWithdrawal = async (userAddress) => {
    if (!userAddress || !contracts.rewardMechanism) return;
    setIsApproving(true);
    try {
      console.log(`Approving withdrawal for ${userAddress} on-chain...`);
      const tx = await contracts.rewardMechanism.approveWithdrawal(userAddress);
      toast({ title: "Processing Approval", description: "Waiting for confirmation..." });
      await tx.wait(); // Wait for mining

      toast({ variant: "success", title: "Approval Confirmed", description: `Withdrawal approved for ${userAddress.substring(0, 6)}...` });

      // Refresh data
      fetchPendingWithdrawals();
      fetchPendingRequestStatus();
      fetchUCoinBalance();
      fetchWithdrawalHistory();

    } catch (error) {
      console.error("Approval error:", error);
      toast({ variant: "destructive", title: "Approval Failed", description: error.reason || error.message });
    }
    finally { setIsApproving(false); }
  };


  // --- useEffect Hooks ---

  // Initial Load (Fetches GitHub data)
  useEffect(() => {
    console.log("Dashboard loading...");
    fetchGithubData();
  }, [fetchGithubData]); // Run once on mount

  // Register User (When relevant data is available)
  useEffect(() => {
    if (userData?.login && walletAddress && contracts.userDatabase) {
      const timer = setTimeout(() => { registerUser(); }, 500);
      return () => clearTimeout(timer);
    }
  }, [userData, walletAddress, contracts.userDatabase, registerUser]);

  // Check Owner Status (When wallet/contract ready)
  useEffect(() => {
    // Defined with useCallback, so identity changes when deps change
    checkOwnerStatus();
  }, [checkOwnerStatus]);

  // **MODIFIED**: Periodic Fetching (Only Balance & Status)
  useEffect(() => {
    if (walletAddress && contracts.rewardMechanism && contracts.ucoin) {
      console.log("[Interval Setup] Starting periodic checks (Balance, Status).");
      // Initial fetches
      fetchUCoinBalance();
      fetchPendingRequestStatus();

      // Setup intervals
      const balanceInterval = setInterval(fetchUCoinBalance, 30000);
      const statusInterval = setInterval(fetchPendingRequestStatus, 15000);

      // Cleanup intervals
      return () => {
        console.log("[Interval Cleanup] Stopping periodic checks.");
        clearInterval(balanceInterval);
        clearInterval(statusInterval);
      };
    } else {
      // Reset relevant state if wallet disconnects or contracts aren't ready
      setUcoinBalance(0);
      setIsRequestPending(false);
      setPendingAmount(0);
      // totalClaimedAmount reset handled by localStorage load effect
    }
  }, [ // Dependencies for periodic checks
    walletAddress, contracts.rewardMechanism, contracts.ucoin,
    fetchUCoinBalance, fetchPendingRequestStatus
  ]);

  // Calculate Total Earnable Tokens (When Level Changes)
  useEffect(() => {
    const earnable = calculateTotalTokensForLevel(contributionStats.level);
    setTotalEarnableTokens(earnable);
    console.log(`[Earnable Calc] Level ${contributionStats.level} total earnable: ${earnable.toFixed(4)} UCoin`);
  }, [contributionStats.level]);

  // **NEW**: Load claimed amount from localStorage when wallet connects/changes
  useEffect(() => {
    if (walletAddress) {
      const storageKey = `claimedAmount_${walletAddress.toLowerCase()}`;
      const savedClaimed = localStorage.getItem(storageKey);
      if (savedClaimed !== null) {
        const parsedClaimed = parseFloat(savedClaimed);
        if (!isNaN(parsedClaimed)) {
          setTotalClaimedAmount(parsedClaimed);
          console.log(`[LocalStorage] Loaded claimed amount for ${walletAddress}: ${parsedClaimed}`);
        } else {
          setTotalClaimedAmount(0); // Reset state if stored value is invalid
          localStorage.removeItem(storageKey); // Clean up invalid entry
          console.log(`[LocalStorage] Invalid claimed amount found for ${walletAddress}, resetting.`);
        }
      } else {
        // No value found for this address, ensure state starts at 0
        setTotalClaimedAmount(0);
        console.log(`[LocalStorage] No claimed amount found for ${walletAddress}.`);
      }
    } else {
      // Reset claimed amount in state if wallet disconnects
      setTotalClaimedAmount(0);
    }
  }, [walletAddress]); // Run this effect only when walletAddress changes

  // **NEW**: Save claimed amount to localStorage whenever it changes for the connected wallet
  useEffect(() => {
    // Only save if a wallet is connected and the amount is a valid number
    if (walletAddress && typeof totalClaimedAmount === 'number' && !isNaN(totalClaimedAmount)) {
      const storageKey = `claimedAmount_${walletAddress.toLowerCase()}`;
      // Avoid saving if the state is just being initialized to 0 from no storage
      const currentStored = localStorage.getItem(storageKey);
      if (totalClaimedAmount.toString() !== currentStored) {
        localStorage.setItem(storageKey, totalClaimedAmount.toString());
        console.log(`[LocalStorage] Saved claimed amount for ${walletAddress}: ${totalClaimedAmount}`);
      }
    }
    // No need for else block - we don't save if no wallet is connected or amount is invalid
  }, [totalClaimedAmount, walletAddress]); // Run when claimed amount or wallet address changes


  // --- Calculate Max Requestable Amount for UI (Uses state hydrated from localStorage) ---
  const maxRequestableNow = Math.max(0, totalEarnableTokens - totalClaimedAmount);


  // --- Render ---
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 px-4 max-w-7xl mx-auto pb-12">

        {isLoading && (
          <div className="flex justify-center items-center my-16">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="ml-4 text-lg text-muted-foreground">Loading Dashboard...</p>
          </div>
        )}

        {!isLoading && (
          <>
            {/* --- Top Row Stats --- */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Level Progress Card */}
              <Card className="glass">
                <CardHeader><CardTitle>Level Progress</CardTitle><CardDescription>{contributionStats.title}</CardDescription></CardHeader>
                <CardContent>
                  <Progress value={contributionStats.nextLevelXps > 0 ? Math.min(100, (contributionStats.xps / contributionStats.nextLevelXps) * 100) : (contributionStats.level > 0 ? 100 : 0)} />
                  <p className="text-sm text-muted-foreground mt-2">Level: <span className="font-semibold">{contributionStats.level}</span> | XP: <span className="font-semibold">{contributionStats.xps}</span> / {contributionStats.nextLevelXps}</p>
                  {contributionStats.nextLevelXps > contributionStats.xps && contributionStats.nextLevelXps > 0 && (<p className="text-xs text-muted-foreground">{contributionStats.nextLevelXps - contributionStats.xps} XP to Level {contributionStats.level + 1}</p>)}
                </CardContent>
              </Card>

              {/* Contribution Overview Card */}
              <Card className="glass">
                <CardHeader><CardTitle>Contribution Overview</CardTitle><CardDescription>Summary of activity</CardDescription></CardHeader>
                <CardContent>
                  <p className="text-lg">Role: <Badge variant="secondary">{contributionStats.role}</Badge></p>
                  <p className="mt-2">Total Contributions: <span className="font-semibold">{contributionStats.totalContributions}</span></p>
                  <p className="mt-2">Total XPs: <span className="font-semibold">{contributionStats.xps}</span></p>
                  <p className="mt-1">Current Streak: <span className="font-semibold">{contributionStats.streak}</span> {contributionStats.streak === 1 ? 'day' : 'days'}</p>
                </CardContent>
              </Card>

              {/* --- UCoin Wallet & Rewards Card (UPDATED LABELS) --- */}
              {!isOwner && (
                <Card className="glass">
                  <CardHeader>
                    <CardTitle>UCoin Wallet & Rewards</CardTitle>
                    <CardDescription>Balance and level-based withdrawals</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* Balance */}
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground flex items-center gap-1"><Wallet className="h-4 w-4" /> Your Balance:</span>
                        <div className="text-right">
                          <span className="text-xl font-bold">{ucoinBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} UCoin</span>
                          <div>
                            <Button
                              variant="link"
                              size="sm"
                              onClick={addTokenToMetaMask}
                              className="text-xs text-primary hover:underline p-0 h-auto"
                            >
                              + Import to MetaMask
                            </Button>
                          </div>
                        </div>
                      </div>
                      {/* Level Limit Info */}
                      <div className="text-sm border-t pt-3 mt-3 space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground flex items-center gap-1"><Award className="h-4 w-4" /> Total Earnable (Level {contributionStats.level}):</span>
                          <span className="font-medium">{totalEarnableTokens.toLocaleString(undefined, { maximumFractionDigits: 4 })} UCoin</span>
                        </div>
                        <div className="flex justify-between items-center">
                          {/* **UPDATED LABEL** */}
                          <span className="text-muted-foreground">Total Claimed:</span>
                          <span className="font-medium">
                            {/* Displays state hydrated from localStorage */}
                            {totalClaimedAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} UCoin
                          </span>
                        </div>
                        <div className="flex justify-between items-center font-semibold text-green-600 dark:text-green-400">
                          <span>Available to Request:</span>
                          {/* Uses maxRequestableNow derived from localStorage-hydrated state */}
                          <span>{maxRequestableNow.toLocaleString(undefined, { maximumFractionDigits: 4 })} UCoin</span>
                        </div>
                      </div>
                      <hr />
                      {/* Withdrawal Status/Action */}
                      <div>
                        <Label className="flex items-center gap-1 mb-2"><CircleHelp className="h-4 w-4 text-muted-foreground" /> Withdrawal Status</Label>
                        {isCheckingStatus && (<div className="flex items-center text-sm text-muted-foreground"> <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking status... </div>)}
                        {!isCheckingStatus && isRequestPending && ( /* Pending Display */
                          <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-md text-yellow-800 dark:text-yellow-200">
                            <div className="flex items-center gap-2 font-medium"> <Clock className="h-5 w-5" /> Request Pending Owner Approval </div>
                            <p className="text-sm mt-1">Amount: <strong>{pendingAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} UCoin</strong></p>
                            <p className="text-xs mt-1">Owner approval needed.</p>
                          </div>
                        )}
                        {!isCheckingStatus && !isRequestPending && ( /* Request Button/Dialog */
                          <div className="space-y-3">
                            {maxRequestableNow <= 0 && contributionStats.level > 0 && (<p className="text-sm text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30 p-2 rounded border border-yellow-300 dark:border-yellow-700"> You have claimed all available tokens for Level {contributionStats.level}. Level up for more! </p>)}
                            {maxRequestableNow <= 0 && contributionStats.level === 0 && (<p className="text-sm text-muted-foreground">Reach Level 1 to start earning UCoin.</p>)}
                            {maxRequestableNow > 0 && (<p className="text-sm text-muted-foreground">You can request up to <span className="font-semibold">{maxRequestableNow.toFixed(4)}</span> more UCoin.</p>)}
                            <Dialog open={isRequestDialogOpen} onOpenChange={setIsRequestDialogOpen}>
                              {/* **FIX**: Added asChild prop here */}
                              <DialogTrigger asChild>
                                {/* Button disabled logic uses maxRequestableNow */}
                                <Button variant="default" disabled={!walletAddress || !contracts.rewardMechanism || isRequestPending || maxRequestableNow <= 0} className="w-full" > Request Withdrawal </Button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader> <DialogTitle>Request UCoin Withdrawal</DialogTitle> <DialogDescription> Enter amount up to your available limit. Requires owner approval. </DialogDescription> </DialogHeader>
                                <div className="grid gap-4 py-4">
                                  {/* Limits Display */}
                                  <div className="text-xs space-y-1 bg-muted p-3 rounded-md border">
                                    <p>Your Level: <span className="font-medium">{contributionStats.level}</span></p>
                                    <p>Total Earnable: <span className="font-medium">{totalEarnableTokens.toFixed(4)} UCoin</span></p>
                                    {/* **UPDATED LABEL** */}
                                    <p>Total Claimed: <span className="font-medium">{totalClaimedAmount.toFixed(4)} UCoin</span></p>
                                    <p>Max Requestable Now: <span className="font-semibold text-green-600 dark:text-green-400">{maxRequestableNow.toFixed(4)} UCoin</span></p>
                                  </div>
                                  {/* Input */}
                                  <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="request-amount" className="text-right">Amount</Label>
                                    <Input id="request-amount" type="number" min="0" step="any" value={withdrawRequestAmount} onChange={(e) => setWithdrawRequestAmount(e.target.value)} placeholder={`Max ${maxRequestableNow.toFixed(4)}`} disabled={isRequestingWithdrawal} className={`col-span-3 ${parseFloat(withdrawRequestAmount) > maxRequestableNow ? 'border-red-500 focus:border-red-500' : ''}`} />
                                  </div>
                                  {parseFloat(withdrawRequestAmount) > maxRequestableNow && (<p className="text-xs text-red-600 dark:text-red-400 col-start-2 col-span-3 -mt-2"> Amount exceeds limit. </p>)}
                                  <p className="text-xs text-muted-foreground col-start-2 col-span-3">Balance: {ucoinBalance.toFixed(4)} UCoin</p>
                                  <p className="text-xs text-muted-foreground col-span-4 px-1">Address: <code className="text-xs">{walletAddress}</code></p>
                                </div>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setIsRequestDialogOpen(false)} disabled={isRequestingWithdrawal}>Cancel</Button>
                                  <Button type="button" onClick={handleRequestWithdrawal} disabled={isRequestingWithdrawal || !withdrawRequestAmount || parseFloat(withdrawRequestAmount) <= 0 || parseFloat(withdrawRequestAmount) > maxRequestableNow} >
                                    {isRequestingWithdrawal ? (<span className="flex items-center"><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</span>) : ("Confirm Request")}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* --- Second Row: Wallet & GitHub Profile --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              {/* Wallet Card */}
              <Card className="glass">
                <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-6 w-6" /> Wallet</CardTitle></CardHeader>
                <CardContent>
                  {walletAddress ? ( /* Wallet Connected */
                    <div className="space-y-3">
                      <p className="text-sm font-mono break-all bg-muted p-2 rounded">{walletAddress}</p>
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(walletAddress); toast({ title: "Copied!" }); }}>Copy</Button>
                        <Button variant="outline" size="sm" onClick={() => { window.open(`https://sepolia.etherscan.io/address/${walletAddress}`, '_blank'); }}> View on Sepolia <ExternalLink className="h-3 w-3 ml-1" /> </Button>
                      </div>
                    </div>
                  ) : ( /* Wallet Not Connected */
                    <Button onClick={login} className="gap-2 w-full md:w-auto"><Wallet className="h-4 w-4" /> Connect Wallet</Button>
                  )}
                </CardContent>
              </Card>

              {/* GitHub Profile Card */}
              <Card className="glass">
                <CardHeader><CardTitle className="flex items-center gap-2"><Github className="h-6 w-6" /> GitHub Profile</CardTitle></CardHeader>
                <CardContent>
                  {userData ? ( /* GitHub Connected */
                    <div className="flex flex-col space-y-4">
                      <div className="flex items-start sm:items-center gap-4 flex-col sm:flex-row">
                        {userData.avatar_url && <img src={userData.avatar_url} className="w-16 h-16 rounded-full border" alt="Avatar" />}
                        <div className="flex-grow">
                          <h3 className="text-xl font-bold">{userData.name || userData.login}</h3>
                          {userData.login && <p className="text-sm text-muted-foreground">@{userData.login}</p>}
                          <p className="text-sm text-muted-foreground mt-1">{userData.bio || "No bio."}</p>
                          <div className="flex gap-2 mt-2 flex-wrap">
                            <Badge variant="secondary">{userData.public_repos || 0} repos</Badge>
                            <Badge variant="secondary">{userData.followers || 0} followers</Badge>
                            <Badge variant="secondary">{userData.following || 0} following</Badge>
                          </div>
                        </div>
                      </div>
                      {/* **FIX**: Added asChild prop here */}
                      <Button asChild variant="outline" className="w-full md:w-auto self-start">
                        <a href={userData.html_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2"> <ExternalLink className="h-4 w-4" /> View on GitHub </a>
                      </Button>
                    </div>
                  ) : ( /* GitHub Not Connected */
                    <div className="flex flex-col items-center justify-center h-24 gap-3 text-center">
                      <p className="text-muted-foreground">Connect GitHub to track stats & level up.</p>
                      <Button onClick={() => {
                        const token = prompt("Please enter your GitHub Personal Access Token (read:user, public_repo):");
                        if (token && token.trim().length > 0) {
                          localStorage.setItem("github_token", token.trim());
                          fetchGithubData(); // Refresh data immediately
                          toast({ title: "Token Saved", description: "GitHub data fetching..." });
                        }
                      }} className="gap-2">
                        <Github className="h-4 w-4" /> Connect GitHub
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* --- Repositories & Activity (Show only if GitHub connected) --- */}
            {userData && (
              <>
                {/* Repositories Card */}
                {repos.length > 0 && (
                  <div className="mt-6">
                    <Card className="glass">
                      <CardHeader><CardTitle>Recent Repositories</CardTitle><CardDescription>Last 3 updated</CardDescription></CardHeader>
                      <CardContent> <div className="space-y-4"> {repos.map(repo => ( /* Repo Item */ <div key={repo.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"> <div className="flex justify-between items-start gap-2"> <div className="flex-grow"> <h3 className="font-medium text-primary flex items-center gap-1 flex-wrap"> <a href={repo.html_url} target="_blank" rel="noopener noreferrer" className="hover:underline break-all"> {repo.owner.login}/{repo.name} <ExternalLink className="h-4 w-4 inline-block flex-shrink-0" /> </a> </h3> <p className="text-sm text-muted-foreground mt-1">{repo.description || 'No description.'}</p> </div> <Badge variant={repo.private ? 'outline' : 'secondary'} className="flex-shrink-0">{repo.private ? 'Private' : 'Public'}</Badge> </div> <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-3"> {repo.language && <div className="flex items-center gap-1"><Code className="h-3 w-3" /><span>{repo.language}</span></div>} <div className="flex items-center gap-1"><Star className="h-3 w-3" /><span>{repo.stargazers_count}</span></div> <div className="flex items-center gap-1"><GitFork className="h-3 w-3" /><span>{repo.forks_count}</span></div> <span>Updated: {new Date(repo.updated_at).toLocaleDateString()}</span> </div> </div>))} </div> </CardContent>
                    </Card>
                  </div>
                )}

                {/* Recent Activity Card */}
                <div className="mt-6">
                  <Card className="glass">
                    <CardHeader><CardTitle>Recent GitHub Activity</CardTitle><CardDescription>Latest public contributions found</CardDescription></CardHeader>
                    <CardContent>
                      {contributionStats.recentContributions.length > 0 ? (
                        <div className="space-y-3">
                          {contributionStats.recentContributions.map((activity, index) => (
                            <div key={index} className="flex items-start gap-3 text-sm">
                              <div className="flex-shrink-0 h-2 w-2 mt-[6px] rounded-full bg-primary" />
                              <div className="flex-grow">
                                {activity.url ? (<a href={activity.url} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary"> {activity.type} <ExternalLink className="h-3 w-3 inline-block ml-1" /> </a>) : (<span>{activity.type}</span>)}
                                <p className="text-xs text-muted-foreground">{new Date(activity.created_at).toLocaleString()}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (<p className="text-muted-foreground">No recent public activity found via GitHub API.</p>)}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}

            {/* --- Owner Dashboard --- */}
            {isOwner && (
              <div className="mt-6">
                <Card className="glass">
                  <CardHeader> <CardTitle>Owner Dashboard</CardTitle> <CardDescription>Manage Withdrawal Requests & View History</CardDescription> </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="pending">
                      <TabsList className="grid w-full grid-cols-2 md:w-[300px]"> <TabsTrigger value="pending">Pending Requests</TabsTrigger> <TabsTrigger value="history">Approval History</TabsTrigger> </TabsList>
                      {/* Pending Requests Tab */}
                      <TabsContent value="pending">
                        {pendingWithdrawalsLoading && <div className="flex justify-center items-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
                        {!pendingWithdrawalsLoading && pendingWithdrawals.length === 0 && (<p className="text-muted-foreground text-center py-6">No pending requests.</p>)}
                        {!pendingWithdrawalsLoading && pendingWithdrawals.length > 0 && (<div className="space-y-3 mt-4"> {pendingWithdrawals.map((request) => (<div key={request.user} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-3"> <div className="flex-grow"> <p className="font-mono text-sm break-all">{request.user}</p> <p className="font-semibold">{parseFloat(request.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} UCoin</p> {request.requestTimestamp && <p className="text-xs text-muted-foreground">Req: {new Date(request.requestTimestamp * 1000).toLocaleString()}</p>} </div> <Button onClick={() => approveWithdrawal(request.user)} disabled={isApproving} size="sm" className="w-full sm:w-auto flex-shrink-0"> {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"} </Button> </div>))} </div>)}
                      </TabsContent>
                      {/* Approval History Tab (Uses actual blockchain history state) */}
                      <TabsContent value="history">
                        <p className="text-xs text-muted-foreground mb-3">Shows actual completed withdrawals from blockchain events.</p>
                        <Table>
                          <TableHeader> <TableRow> <TableHead>User</TableHead> <TableHead>Amount</TableHead> <TableHead>Completion Date</TableHead> <TableHead>Transaction</TableHead> </TableRow> </TableHeader>
                          <TableBody>
                            {withdrawalHistory.length === 0 && (<TableRow><TableCell colSpan={4} className="text-center text-muted-foreground h-24">No completed withdrawals found or history loading.</TableCell></TableRow>)}
                            {/* Display actual history fetched for owner */}
                            {withdrawalHistory.map((item, index) => (
                              <TableRow key={item.txHash || index}>
                                <TableCell className="font-mono text-xs break-all">{item.user}</TableCell>
                                <TableCell>{parseFloat(item.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} UCoin</TableCell>
                                <TableCell>{new Date(item.timestamp).toLocaleString()}</TableCell>
                                <TableCell> <a href={`https://sepolia.etherscan.io/tx/${item.txHash}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs font-mono"> {item.txHash.substring(0, 10)}... <ExternalLink className="h-3 w-3 inline-block ml-1" /> </a> {item.error && <p className="text-red-500 text-xs">({item.error})</p>} </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </div>
            )}

          </>
        )}
      </main>
    </div>
  );
}

export default Dashboard;