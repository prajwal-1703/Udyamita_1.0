// Deployment-specific settings come from Vite env variables (Frontend/.env), not from source code.
const env = import.meta.env;

export const CONTRACTS = {
  userDatabase: env.VITE_USER_DATABASE_ADDRESS || "",
  rewardMechanism: env.VITE_REWARD_MECHANISM_ADDRESS || "",
  ucoin: env.VITE_UCOIN_ADDRESS || "",
};
export const CHAIN_ID = Number(env.VITE_CHAIN_ID || 11155111);
export const CHAIN_NAME = env.VITE_CHAIN_NAME || "Sepolia";
export const EXPLORER_URL = env.VITE_EXPLORER_URL || "https://sepolia.etherscan.io";
// Optional public RPC so the leaderboard works without MetaMask.
export const READ_RPC_URL = env.VITE_READ_RPC_URL || "";
// Block the contracts were deployed in; bounds event queries for the owner view.
export const DEPLOY_BLOCK = Number(env.VITE_DEPLOY_BLOCK || 0);
// Backend base URL; empty = same origin (the Vite dev server proxies /auth and /api).
export const BACKEND_URL = env.VITE_BACKEND_URL || "";
export const UCOIN_DECIMALS = 18;

export function contractsConfigured() {
  return Object.values(CONTRACTS).every((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
}
