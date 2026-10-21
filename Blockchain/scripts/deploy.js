const hre = require("hardhat");
// Ensure environment variables are loaded from .env file
require("dotenv").config();

async function main() {
  // --- Signer Setup ---
  const signers = await hre.ethers.getSigners();

  // Define roles clearly for comments and logic
  console.log("\n--- Signer & Wallet Roles ---");
  if (signers.length < 3) {
    console.warn("************************************************************");
    console.warn("WARN: Ideally, use 3 separate accounts for deployment roles:");
    console.warn("  1. Deployer (Owner of Ownable contracts like RewardMechanism)");
    console.warn("  2. Initial Reward Holder (Receives 70% UCoin initially, then transfers to RewardMechanism contract)");
    console.warn("  3. Backend Server (Needs specific roles granted in UserDatabase)");
    console.warn(`Found only ${signers.length} signers. Using fallback assignments:`);
    console.warn("  - If 1 signer: Deployer acts as ALL roles.");
    console.warn("  - If 2 signers: Deployer also acts as Backend Server.");
    console.warn("Ensure this is acceptable for your testing/deployment environment.");
    console.warn("************************************************************\n");
  }

  // Assign signers to roles based on availability
  const deployer = signers[0];
  const initialRewardHolder = signers[1] || deployer; // Fallback to deployer if only 1 signer
  const backendServer = signers[2] || (signers.length === 2 ? deployer : deployer); // Fallback logic

  // --- Get Dev Wallet Address from Environment Variable ---
  const devWalletAddress = process.env.DEV_WALLET; // Read from .env

  // --- VALIDATION for Dev Wallet Address ---
  if (!devWalletAddress) {
      console.error("************************************************************");
      console.error("ERROR: DEV_WALLET_ADDRESS not found in your .env file!");
      console.error("Please add DEV_WALLET_ADDRESS=0xYourAddress to the .env file.");
      console.error("************************************************************");
      process.exit(1); // Exit script if the address is missing
  }
  // Use Hardhat Runtime Environment's ethers utility for address validation
  if (!hre.ethers.isAddress(devWalletAddress)) {
       console.error("************************************************************");
       console.error(`ERROR: Invalid Ethereum address format for DEV_WALLET_ADDRESS: ${devWalletAddress}`);
       console.error("Please check the address in the .env file.");
       console.error("************************************************************");
       process.exit(1); // Exit script if the address format is wrong
  }
  // --- END VALIDATION ---

  // Log the final configuration being used
  console.log("Deployer Account:", deployer.address);
  console.log("Initial Reward Holder Account:", initialRewardHolder.address);
  console.log("Dev Wallet Address (from .env):", devWalletAddress); // Log the specific address being used
  console.log("Backend Server Account (for UserDatabase roles):", backendServer.address);
  console.log("----------------------------------------------------");


  // --- Deployment Steps ---

  // 1. Deploy UCoin Contract
  console.log("1. Deploying UCoin...");
  const UCoin = await hre.ethers.getContractFactory("UCoin", deployer); // Use deployer to deploy
  console.log(`   Sending 70% initial supply to Initial Reward Holder: ${initialRewardHolder.address}`);
  console.log(`   Sending 30% initial supply to Dev Wallet: ${devWalletAddress}`); // Log the target dev wallet
  const ucoin = await UCoin.deploy(
    initialRewardHolder.address, // _rewardTreasury argument for constructor
    devWalletAddress           // _devWallet argument - PASSING THE SPECIFIC ADDRESS FROM .env
  );
  await ucoin.waitForDeployment(); // Wait for the contract to be mined
  const ucoinAddress = await ucoin.getAddress(); // Get the deployed address
  console.log(`✅ UCoin deployed to: ${ucoinAddress}`);
  const totalSupply = await ucoin.totalSupply(); // Verify total supply
  console.log(`   Total Supply: ${hre.ethers.formatUnits(totalSupply, 18)} UCN`);
  console.log("----------------------------------------------------");

  // 2. Deploy RewardMechanism Contract
  console.log("2. Deploying RewardMechanism...");
  const RewardMechanism = await hre.ethers.getContractFactory("RewardMechanism", deployer);
  console.log(`   Configuring RewardMechanism to use UCoin at: ${ucoinAddress}`);
  const rewardMechanism = await RewardMechanism.deploy(
    ucoinAddress // _rewardTokenAddress argument for constructor
  );
  await rewardMechanism.waitForDeployment();
  const rewardMechanismAddress = await rewardMechanism.getAddress();
  console.log(`✅ RewardMechanism deployed to: ${rewardMechanismAddress}`);
  const rewardMechanismOwner = await rewardMechanism.owner(); // Verify owner
  console.log(`   RewardMechanism Owner: ${rewardMechanismOwner} (should be Deployer: ${deployer.address})`);
  console.log("----------------------------------------------------");

  // 3. Fund the RewardMechanism Contract
  console.log("3. Funding RewardMechanism Contract...");
  console.log(`   Transferring UCoin from Initial Holder (${initialRewardHolder.address}) to RewardMechanism (${rewardMechanismAddress})...`);

  const initialHolderBalance = await ucoin.balanceOf(initialRewardHolder.address);
  console.log(`   Initial Holder's UCoin balance: ${hre.ethers.formatUnits(initialHolderBalance, 18)} UCN`);

  const rewardSupplyAmount = initialHolderBalance; // Amount to transfer

  if (rewardSupplyAmount > 0n) { // Use BigInt comparison (0n)
    console.log(`   Attempting to transfer ${hre.ethers.formatUnits(rewardSupplyAmount, 18)} UCN...`);
    // Connect to UCoin contract *as the initialRewardHolder* to authorize the transfer
    const transferTx = await ucoin
      .connect(initialRewardHolder) // Sign the transaction with the holder's account
      .transfer(rewardMechanismAddress, rewardSupplyAmount);
    console.log(`   Transfer transaction sent: ${transferTx.hash}`);
    await transferTx.wait(); // Wait for the transaction to be mined
    console.log(`✅ Successfully transferred UCoin to RewardMechanism.`);

    // Verify final balances post-transfer
    const finalHolderBalance = await ucoin.balanceOf(initialRewardHolder.address);
    const rmBalance = await ucoin.balanceOf(rewardMechanismAddress);
    console.log(`   Initial Holder final balance: ${hre.ethers.formatUnits(finalHolderBalance, 18)} UCN`);
    console.log(`   RewardMechanism final balance: ${hre.ethers.formatUnits(rmBalance, 18)} UCN`);
  } else {
    console.log("   Skipping transfer: Initial Holder balance is zero or negative.");
  }
  console.log("----------------------------------------------------");

  // 4. Deploy UserDatabase Contract
  console.log("4. Deploying UserDatabase...");
  const UserDatabase = await hre.ethers.getContractFactory("UserDatabase", deployer);
  console.log(`   Granting initial XP_UPDATER_ROLE to: ${backendServer.address}`);
  console.log(`   Granting initial REWARD_SYNC_ROLE to: ${backendServer.address}`); // Adjust role name if needed
  const userDatabase = await UserDatabase.deploy(
    backendServer.address, // _initialUpdaterAddress
    backendServer.address  // _initialRewardSyncAddress (Adjust if role name changed)
  );
  await userDatabase.waitForDeployment();
  const userDatabaseAddress = await userDatabase.getAddress();
  console.log(`✅ UserDatabase deployed to: ${userDatabaseAddress}`);

  // Optional: Verify roles in UserDatabase
  try {
      const xpUpdaterRole = await userDatabase.XP_UPDATER_ROLE();
      const rewardSyncRole = await userDatabase.REWARD_SYNC_ROLE(); // Adjust role name if needed in your contract
      const hasXpRole = await userDatabase.hasRole(xpUpdaterRole, backendServer.address);
      const hasSyncRole = await userDatabase.hasRole(rewardSyncRole, backendServer.address); // Adjust role name if needed
      console.log(`   Verification - Backend has XP_UPDATER_ROLE: ${hasXpRole}`);
      console.log(`   Verification - Backend has REWARD_SYNC_ROLE: ${hasSyncRole}`); // Adjust role name if needed
      if (!hasXpRole || !hasSyncRole) { // Adjust check if roles changed
          console.error("   *** ROLE VERIFICATION FAILED! Check UserDatabase roles and script logic. ***");
      }
  } catch (verifyError) {
      console.error("   Error verifying UserDatabase roles:", verifyError.message);
  }
  console.log("----------------------------------------------------");

  // --- Deployment Summary ---
  console.log("\n--- Deployment Summary ---");
  console.log("  UCoin Contract:", ucoinAddress);
  console.log("  RewardMechanism Contract:", rewardMechanismAddress);
  console.log("  UserDatabase Contract:", userDatabaseAddress);
  console.log("--------------------------");
  console.log("  Deployer (Owner):", deployer.address);
  console.log("  Initial Reward Holder:", initialRewardHolder.address);
  console.log("  Dev Wallet (from .env):", devWalletAddress); // Show the specific address used
  console.log("  Backend Server (UserDatabase Roles):", backendServer.address);
  console.log("----------------------------------------------------");
  console.log("Deployment Script Finished Successfully!");
}

module.exports = [
  "0xcB38627b4462F4Edfb06C6CF3D0318078Fceb286" // UCoin address (rewardToken)
];

// Standard Hardhat script execution boilerplate
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment script failed:", error);
    process.exit(1);
  });