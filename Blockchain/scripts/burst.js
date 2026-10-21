// 500 users have new contributions at the same time; compare per-user syncXP vs syncXPBatch(100)
// under 30M / 36M / 60M block gas limits. Writes results/burst_v1_1.json.
const { ethers, network } = require("hardhat");
const fs = require("fs");
const E = (n) => ethers.parseUnits(String(n), 18);

async function setup(N) {
  const [admin, attester, updater, dev] = await ethers.getSigners();
  const db = await (await ethers.getContractFactory("UserDatabase")).deploy(admin.address, attester.address, updater.address, E(70_000_000));
  const net = await ethers.provider.getNetwork();
  const domain = { name: "BlockSource", version: "1.1", chainId: net.chainId, verifyingContract: await db.getAddress() };
  const types = { Bind: [{ name: "wallet", type: "address" }, { name: "githubId", type: "uint64" }, { name: "login", type: "string" }, { name: "deadline", type: "uint256" }] };
  const users = [];
  for (let i = 0; i < N; i++) {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await admin.sendTransaction({ to: w.address, value: E("0.05") });
    const sig = await attester.signTypedData(domain, types, { wallet: w.address, githubId: i + 1, login: `u${i}`, deadline: 2n ** 40n });
    await db.connect(w).register(i + 1, `u${i}`, 2n ** 40n, sig);
    users.push(w.address);
  }
  // Give everyone some history first (level 3), then the burst raises each by 5 contributions.
  for (let i = 0; i < N; i += 100) await db.connect(updater).syncXPBatch(users.slice(i, i + 100), users.slice(i, i + 100).map(() => 12));
  return { db, updater, users };
}

async function drain(db, updater, datas, gasLimit) {
  await network.provider.send("evm_setAutomine", [false]);
  await network.provider.send("evm_setBlockGasLimit", ["0x" + gasLimit.toString(16)]);
  let nonce = await ethers.provider.getTransactionCount(updater.address, "pending");
  for (const data of datas) await updater.sendTransaction({ to: await db.getAddress(), data, nonce: nonce++, gasLimit: 3_000_000 });
  const blocks = [];
  for (let i = 0; i < 100; i++) {
    await network.provider.send("evm_mine", []);
    const b = await ethers.provider.getBlock("latest");
    if (b.transactions.length === 0) break;
    blocks.push({ txs: b.transactions.length, gasUsed: Number(b.gasUsed) });
  }
  await network.provider.send("evm_setAutomine", [true]);
  return blocks;
}

async function main() {
  const N = 500, res = {};
  for (const gasLimit of [30_000_000, 36_000_000, 60_000_000]) {
    for (const mode of ["per-user", "batch-100"]) {
      await network.provider.send("hardhat_reset", []);
      const { db, updater, users } = await setup(N);
      const iface = db.interface;
      const datas = mode === "per-user"
        ? users.map((u) => iface.encodeFunctionData("syncXP", [u, 17]))
        : Array.from({ length: N / 100 }, (_, k) => iface.encodeFunctionData("syncXPBatch", [users.slice(k * 100, k * 100 + 100), users.slice(k * 100, k * 100 + 100).map(() => 17)]));
      const blocks = await drain(db, updater, datas, gasLimit);
      const total = blocks.reduce((s, b) => s + b.gasUsed, 0);
      const u0 = await db.getUser(users[0]);
      res[`${gasLimit}/${mode}`] = { gasLimit, mode, txs: datas.length, blocks: blocks.length, perBlock: blocks.map((b) => b.txs),
        totalGas: total, gasPerUser: Math.round(total / N), checkXp: Number(u0.xp), checkLevel: Number(u0.level) };
      console.log(JSON.stringify(res[`${gasLimit}/${mode}`]));
    }
  }
  fs.mkdirSync("results", { recursive: true });
  fs.writeFileSync("results/burst_v1_1.json", JSON.stringify(res, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
