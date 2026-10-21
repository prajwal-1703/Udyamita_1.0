// On-chain side of the backend: EIP-712 binding attestations and XP synchronisation.
const { ethers } = require("ethers");

const USER_DATABASE_ABI = [
  "function walletOfGithubId(uint64) view returns (address)",
  "function getUser(address) view returns (tuple(uint64 githubId,uint32 xp,uint8 level,uint96 earned,uint40 lastSync,bool suspended))",
  "function getUserCount() view returns (uint256)",
  "function getUsers(uint256 offset,uint256 limit) view returns (address[] wallets, tuple(uint64 githubId,uint32 xp,uint8 level,uint96 earned,uint40 lastSync,bool suspended)[] profiles, string[] logins)",
  "function syncXP(address user,uint32 contributionCount)",
  "function syncXPBatch(address[] users,uint32[] counts)",
  "function XP_PER_CONTRIBUTION() view returns (uint32)",
];

const BIND_TYPES = {
  Bind: [
    { name: "wallet", type: "address" },
    { name: "githubId", type: "uint64" },
    { name: "login", type: "string" },
    { name: "deadline", type: "uint256" },
  ],
};

function bindDomain(chainId, userDatabase) {
  return { name: "Udyamita", version: "1.1", chainId, verifyingContract: userDatabase };
}

/** Signs Bind(wallet, githubId, login, deadline) with the attester key. */
async function signBinding({ attester, chainId, userDatabase, wallet, githubId, login, ttlSeconds, now = Date.now() }) {
  if (!ethers.isAddress(wallet)) throw new Error("invalid wallet address");
  const deadline = Math.floor(now / 1000) + ttlSeconds;
  const value = { wallet: ethers.getAddress(wallet), githubId: BigInt(githubId), login, deadline: BigInt(deadline) };
  const signature = await attester.signTypedData(bindDomain(chainId, userDatabase), BIND_TYPES, value);
  return { wallet: value.wallet, githubId: String(githubId), login, deadline, signature };
}

function makeChain({ rpcUrl, provider, chainId, userDatabase, attesterKey, updaterKey }) {
  const p = provider || new ethers.JsonRpcProvider(rpcUrl, chainId);
  const attester = new ethers.Wallet(attesterKey, p);
  const updater = new ethers.NonceManager(new ethers.Wallet(updaterKey, p)); // serialises nonces across concurrent syncs
  const db = new ethers.Contract(userDatabase, USER_DATABASE_ABI, updater);
  return { provider: p, attester, updater, db, chainId, userDatabase };
}

module.exports = { USER_DATABASE_ABI, BIND_TYPES, bindDomain, signBinding, makeChain };
