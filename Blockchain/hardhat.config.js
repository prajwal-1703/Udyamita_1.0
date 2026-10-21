require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Offline builds: set SOLC_FROM_NPM=1 to use the solc-js builds from node_modules
// instead of downloading native compilers from binaries.soliditylang.org.
if (process.env.SOLC_FROM_NPM === "1") {
  const local = {
    "0.8.26": { pkg: "solc", long: "0.8.26+commit.8a97fa7a" },
    "0.8.20": { pkg: "solc-0820", long: "0.8.20+commit.a1b79de6" },
  };
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
    const l = local[args.solcVersion];
    if (!l) return runSuper();
    return {
      compilerPath: path.join(__dirname, "node_modules", l.pkg, "soljson.js"),
      isSolcJs: true, version: args.solcVersion, longVersion: l.long,
    };
  });
}

// v1.0 contracts are compiled exactly as they were deployed to Sepolia in April 2025
// (solc 0.8.20, optimizer off) so that local gas figures can be checked against on-chain receipts.
const legacy = { version: "0.8.20", settings: { optimizer: { enabled: false } } };

const networks = { hardhat: { hardfork: "cancun" } };
if (process.env.SEPOLIA_RPC_URL && process.env.PRIVATE_KEY) {
  networks.sepolia = { url: process.env.SEPOLIA_RPC_URL, accounts: [process.env.PRIVATE_KEY] };
}

module.exports = {
  solidity: {
    compilers: [{ version: "0.8.26", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } }],
    overrides: {
      "contracts/legacy/UCoinV1.sol": legacy,
      "contracts/legacy/UserDatabaseV1.sol": legacy,
      "contracts/legacy/RewardMechanismV1.sol": legacy,
    },
  },
  networks,
  mocha: { timeout: 900000 },
};
