// End-to-end: the Backend's EIP-712 attestation and sync code against the real v1.1 contracts.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const path = require("path");
const { signBinding } = require(path.join(__dirname, "../../Backend/src/chain.js"));
const { syncOne, syncAll } = require(path.join(__dirname, "../../Backend/src/sync.js"));

describe("Backend <-> contracts integration", () => {
  it("attestation from the backend registers a wallet; syncs credit XP, levels and rewards", async () => {
    const [admin, attester, updater, dev, alice, bob] = await ethers.getSigners();
    const db = await (await ethers.getContractFactory("UserDatabase")).deploy(admin.address, attester.address, updater.address, ethers.parseUnits("70000000", 18));
    const rm = await (await ethers.getContractFactory("RewardMechanism")).deploy(await db.getAddress(), dev.address);
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const block = await ethers.provider.getBlock("latest");

    for (const [user, id, login] of [[alice, 4242, "prajwal-1703"], [bob, 777, "teammate"]]) {
      const att = await signBinding({ attester, chainId, userDatabase: await db.getAddress(), wallet: user.address, githubId: id, login, ttlSeconds: 600, now: block.timestamp * 1000 });
      await db.connect(user).register(att.githubId, att.login, att.deadline, att.signature);
    }

    const counts = { 4242: 150, 777: 30 };
    const github = { contributionCount: async (id) => ({ total: counts[Number(id)] }) };
    const chain = { db: db.connect(updater) };

    const one = await syncOne({ chain, github, wallet: alice.address });
    expect(one.changed).to.equal(true);
    const again = await syncOne({ chain, github, wallet: alice.address });
    expect(again.changed).to.equal(false); // idempotent

    counts[4242] = 160;
    const all = await syncAll({ chain, github });
    expect(all.updated).to.equal(2);
    const a = await db.getUser(alice.address);
    expect(a.xp).to.equal(8000n);
    expect(a.level).to.equal(12n); // 50*12*13 = 7800 <= 8000 < 9100
    expect(await rm.available(alice.address)).to.equal(a.earned);
  });
});
