import { ethers } from "ethers";
import UserDatabaseABI from "@/abis/UserDatabase.json";
import RewardMechanismABI from "@/abis/RewardMechanism.json";
import UCoinABI from "@/abis/UCoin.json";
import { CONTRACTS, CHAIN_ID, CHAIN_NAME, READ_RPC_URL, EXPLORER_URL } from "@/config";

export function readProvider() {
  if (READ_RPC_URL) return new ethers.JsonRpcProvider(READ_RPC_URL, CHAIN_ID);
  if (window.ethereum) return new ethers.BrowserProvider(window.ethereum);
  throw new Error("No RPC available: install MetaMask or set VITE_READ_RPC_URL.");
}

export function contracts(runner) {
  return {
    userDatabase: new ethers.Contract(CONTRACTS.userDatabase, UserDatabaseABI.abi, runner),
    rewardMechanism: new ethers.Contract(CONTRACTS.rewardMechanism, RewardMechanismABI.abi, runner),
    ucoin: new ethers.Contract(CONTRACTS.ucoin, UCoinABI.abi, runner),
  };
}

/** Ask the wallet to switch to the configured chain; v1.0 silently sent transactions to whatever chain was selected. */
export async function ensureChain() {
  const hex = "0x" + CHAIN_ID.toString(16);
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (current.toLowerCase() === hex) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    throw new Error(`Please switch your wallet to ${CHAIN_NAME} (chain id ${CHAIN_ID}).`);
  }
}

export async function signerContracts() {
  if (!window.ethereum) throw new Error("MetaMask not found.");
  await ensureChain();
  const provider = new ethers.BrowserProvider(window.ethereum);
  return contracts(await provider.getSigner());
}

/** Turns custom-error reverts into readable messages. */
export function revertReason(error, iface) {
  const data = error?.data || error?.info?.error?.data || error?.error?.data;
  if (data && iface) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return parsed.name + (parsed.args.length ? `(${parsed.args.map(String).join(", ")})` : "");
    } catch { /* fall through */ }
  }
  return error?.shortMessage || error?.reason || error?.message || "Transaction failed";
}

export const txUrl = (hash) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (a) => `${EXPLORER_URL}/address/${a}`;
