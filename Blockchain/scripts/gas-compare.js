// Measures gas for the v1.1 contracts and writes results/gas_v1_1.json.
// Run legacy-gas.js for the v1.0 numbers (results/legacy_gas.json).
const { ethers } = require("hardhat");
const fs = require("fs");

const g = async (p) => Number((await (await p).wait()).gasUsed);
const E = (n) => ethers.parseUnits(String(n), 18);

async function main() {
  const [admin, attester, updater, dev] = await ethers.getSigners();
  const DB = await ethers.getContractFactory("UserDatabase");
  const db = await DB.deploy(admin.address, attester.address, updater.address, E(70_000_000));
  const rm = await (await ethers.getContractFactory("RewardMechanism")).deploy(await db.getAddress(), dev.address);
  const out = { deploy: {
    userDatabase: Number((await db.deploymentTransaction().wait()).gasUsed),
    rewardMechanismWithUCoin: Number((await rm.deploymentTransaction().wait()).gasUsed),
  } };
  const net = await ethers.provider.getNetwork();
  const domain = { name: "Udyamita", version: "1.1", chainId: net.chainId, verifyingContract: await db.getAddress() };
  const types = { Bind: [{ name: "wallet", type: "address" }, { name: "githubId", type: "uint64" }, { name: "login", type: "string" }, { name: "deadline", type: "uint256" }] };
  let nextId = 1000;
  const newUser = async () => {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await admin.sendTransaction({ to: w.address, value: E("1") });
    const id = nextId++, login = `dev-${id}-padded`, d = 2n ** 40n;
    const sig = await attester.signTypedData(domain, types, { wallet: w.address, githubId: id, login, deadline: d });
    const gas = await g(db.connect(w).register(id, login, d, sig));
    return { w, gas };
  };
  const sync = (u, c) => g(db.connect(updater).syncXP(u.address, c));

  const a = await newUser(); out.register_first = a.gas;
  const b = await newUser(); out.register = b.gas;
  out.sync_no_levelup = await sync(a.w, 1);                 // 50 XP, level 0
  out.sync_levelup_first_in_system = await sync(a.w, 2);    // level 1, initialises totalEarned
  out.sync_levelup_typical = await sync(b.w, 6);            // level 0 -> 2
  out.sync_same_count_noop = await sync(b.w, 6);
  out.sync_19_to_20_reviewer = (await sync(b.w, 419), await sync(b.w, 420));
  const c = await newUser();
  out.sync_0_to_100 = await sync(c.w, 10100);
  out.sync_99_to_100 = (await sync(a.w, 10099), await sync(a.w, 10100));

  // batched sync: n users per transaction, each crossing one level
  out.batch = {};
  for (const n of [1, 10, 50, 100, 200]) {
    const ws = [];
    for (let i = 0; i < n; i++) ws.push((await newUser()).w);
    for (const w of ws) await sync(w, 2); // warm: everyone at level 1
    const gas = await g(db.connect(updater).syncXPBatch(ws.map((w) => w.address), ws.map(() => 6)));
    out.batch[n] = { total: gas, perUser: Math.round(gas / n) };
  }

  // withdrawals (user c is at level 100)
  out.request_pending = await g(rm.connect(c.w).requestWithdrawal(E(5.4)));
  out.approve_new_holder = await g(rm.connect(admin).approveWithdrawal(c.w.address));
  out.request_again = await g(rm.connect(c.w).requestWithdrawal(E(5.832)));
  out.approve_existing_holder = await g(rm.connect(admin).approveWithdrawal(c.w.address));
  await rm.connect(c.w).requestWithdrawal(E(1));
  out.reject = await g(rm.connect(admin).rejectWithdrawal(c.w.address));
  await rm.connect(c.w).requestWithdrawal(E(1));
  out.cancel = await g(rm.connect(c.w).cancelWithdrawal());
  await rm.connect(admin).setInstantLimit(E(10));
  out.request_instant_paid = await g(rm.connect(c.w).requestWithdrawal(E(2)));

  // read path
  out.getUsers_page100_estimate = Number(await db.getUsers.estimateGas(0, 100));
  out.userCount = Number(await db.getUserCount());
  out.codeSize = {
    userDatabase: (await ethers.provider.getCode(await db.getAddress())).length / 2 - 1,
    rewardMechanism: (await ethers.provider.getCode(await rm.getAddress())).length / 2 - 1,
    ucoin: (await ethers.provider.getCode(await rm.rewardToken())).length / 2 - 1,
  };
  fs.mkdirSync("results", { recursive: true });
  fs.writeFileSync("results/gas_v1_1.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
