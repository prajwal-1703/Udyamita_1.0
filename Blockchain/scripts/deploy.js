// Deploys BlockSource v1.1: UserDatabase, then RewardMechanism (which deploys and funds UCoin).
// Writes deployments/<network>.json and copies ABIs into Frontend/src/abis.
//
// Environment (.env):
//   DEV_WALLET            receives 30% of UCN
//   ATTESTER_ADDRESS      backend key that signs GitHub<->wallet bindings
//   XP_UPDATER_ADDRESS    backend key that submits XP syncs (needs ETH for gas)
//   ADMIN_ADDRESS         optional; defaults to the deployer (holds DEFAULT_ADMIN_ROLE / owner)
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

function addr(name, fallback) {
  const v = process.env[name] || fallback;
  if (!v || !hre.ethers.isAddress(v)) throw new Error(`${name} must be set to a valid address`);
  return hre.ethers.getAddress(v);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const local = hre.network.name === "hardhat" || hre.network.name === "localhost";
  const signers = await hre.ethers.getSigners();
  const admin = addr("ADMIN_ADDRESS", deployer.address);
  const dev = addr("DEV_WALLET", local ? signers[1].address : undefined);
  const attester = addr("ATTESTER_ADDRESS", local ? signers[2].address : undefined);
  const updater = addr("XP_UPDATER_ADDRESS", local ? signers[3].address : undefined);

  const treasury = hre.ethers.parseUnits("70000000", 18);
  console.log(`network=${hre.network.name} deployer=${deployer.address}`);

  const db = await (await hre.ethers.getContractFactory("UserDatabase")).deploy(admin, attester, updater, treasury);
  await db.waitForDeployment();
  const rm = await (await hre.ethers.getContractFactory("RewardMechanism")).deploy(await db.getAddress(), dev);
  await rm.waitForDeployment();
  const ucoin = await rm.rewardToken();

  if (admin !== deployer.address) {
    await (await rm.transferOwnership(admin)).wait(); // admin must call acceptOwnership()
  }

  const ucn = await hre.ethers.getContractAt("UCoin", ucoin);
  if ((await ucn.TREASURY_SHARE()) !== (await db.rewardBudget())) throw new Error("budget/treasury mismatch");

  const out = {
    network: hre.network.name, chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    userDatabase: await db.getAddress(), rewardMechanism: await rm.getAddress(), ucoin,
    admin, attester, updater, devWallet: dev, deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(__dirname, "../deployments"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, `../deployments/${hre.network.name}.json`), JSON.stringify(out, null, 2));

  const abiDir = path.join(__dirname, "../../Frontend/src/abis");
  for (const name of ["UserDatabase", "RewardMechanism", "UCoin"]) {
    const art = await hre.artifacts.readArtifact(name);
    fs.writeFileSync(path.join(abiDir, `${name}.json`), JSON.stringify({ abi: art.abi }, null, 2));
  }
  console.log(JSON.stringify(out, null, 2));
  console.log("Set these in Frontend/.env (VITE_*) and Backend/.env (USER_DATABASE_ADDRESS).");
}

main().catch((e) => { console.error(e); process.exit(1); });
