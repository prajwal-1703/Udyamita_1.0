// Re-executes the v1.0 user flow locally and prints gas, to compare with Sepolia receipts.
const { ethers } = require("hardhat");
const fs = require("fs");
const g = async (p) => Number((await (await p).wait()).gasUsed);
async function main() {
  const [owner, holder, dev, backend, a, b] = await ethers.getSigners();
  const ucoin = await (await ethers.getContractFactory("UCoinV1")).deploy(holder.address, dev.address);
  const rm = await (await ethers.getContractFactory("RewardMechanismV1")).deploy(await ucoin.getAddress());
  await ucoin.connect(holder).transfer(await rm.getAddress(), await ucoin.balanceOf(holder.address));
  const db = await (await ethers.getContractFactory("UserDatabaseV1")).deploy(backend.address, backend.address);
  const out = {
    deploy: {
      ucoin: Number((await ucoin.deploymentTransaction().wait()).gasUsed),
      rewardMechanism: Number((await rm.deploymentTransaction().wait()).gasUsed),
      userDatabase: Number((await db.deploymentTransaction().wait()).gasUsed),
    },
  };
  out.setUser_first = await g(db.connect(a).setUser("prajwal-1703"));
  out.setUser_second = await g(db.connect(b).setUser("another-dev"));
  try { await db.connect(a).setUser.estimateGas("x"); } catch { out.setUser_duplicate_reverts = true; }
  const failed = await a.sendTransaction({ to: await db.getAddress(), data: db.interface.encodeFunctionData("setUser", ["prajwal-1703"]), gasLimit: 200000 }).then((t) => t.wait()).catch((e) => e.receipt);
  out.setUser_duplicate_gas = failed ? Number(failed.gasUsed) : null;
  out.updateUserXP = await g(db.connect(backend).updateUserXP(a.address, 5000));
  out.request_first = await g(rm.connect(a).requestWithdrawal(ethers.parseUnits("5.4", 18)));
  out.approve_new_holder = await g(rm.connect(owner).approveWithdrawal(a.address));
  out.request_again = await g(rm.connect(a).requestWithdrawal(ethers.parseUnits("5.832", 18)));
  out.approve_existing_holder = await g(rm.connect(owner).approveWithdrawal(a.address));
  out.reject = (await g(rm.connect(a).requestWithdrawal(1n)), await g(rm.connect(owner).rejectWithdrawal(a.address)));
  fs.mkdirSync("results", { recursive: true });
  fs.writeFileSync("results/legacy_gas.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
