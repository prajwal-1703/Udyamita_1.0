// Reproduces the behaviour of the v1.0 contracts deployed on Sepolia (April 2025)
// and documents the weaknesses that motivated v1.1. These tests are expected to PASS:
// each one demonstrates that the weakness exists in v1.0.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const E = (n) => ethers.parseUnits(String(n), 18);

async function deployV1() {
  const [owner, holder, dev, backend, alice, bob, mallory] = await ethers.getSigners();
  const ucoin = await (await ethers.getContractFactory("UCoinV1")).deploy(holder.address, dev.address);
  const rm = await (await ethers.getContractFactory("RewardMechanismV1")).deploy(await ucoin.getAddress());
  await ucoin.connect(holder).transfer(await rm.getAddress(), await ucoin.balanceOf(holder.address));
  const db = await (await ethers.getContractFactory("UserDatabaseV1")).deploy(backend.address, backend.address);
  return { ucoin, rm, db, owner, holder, dev, backend, alice, bob, mallory };
}

describe("v1.0 audit (legacy contracts)", () => {
  it("F1: total supply is 1,000,001 UCN, 700,000.7 UCN in the treasury", async () => {
    const { ucoin, rm } = await loadFixture(deployV1);
    expect(await ucoin.totalSupply()).to.equal(E("1000001"));
    expect(await ucoin.balanceOf(await rm.getAddress())).to.equal(E("700000.7"));
  });

  it("F2: any wallet can request the entire treasury; the contract checks no entitlement", async () => {
    const { rm, ucoin, owner, mallory } = await loadFixture(deployV1);
    const all = await ucoin.balanceOf(await rm.getAddress());
    await rm.connect(mallory).requestWithdrawal(all);          // never registered, zero XP
    await rm.connect(owner).approveWithdrawal(mallory.address); // only human judgement stands in the way
    expect(await ucoin.balanceOf(mallory.address)).to.equal(all);
  });

  it("F3: a GitHub login can be claimed by any wallet (no identity binding)", async () => {
    const { db, alice, mallory } = await loadFixture(deployV1);
    await db.connect(alice).setUser("prajwal-1703");
    await db.connect(mallory).setUser("prajwal-1703");          // same login, different wallet
    const users = await db.getAllUsers();
    expect(users.filter((u) => u.username === "prajwal-1703").length).to.equal(2);
  });

  it("F4: XP is overwritten, so it can go down", async () => {
    const { db, backend, alice } = await loadFixture(deployV1);
    await db.connect(alice).setUser("alice");
    await db.connect(backend).updateUserXP(alice.address, 5000);
    await db.connect(backend).updateUserXP(alice.address, 100);
    expect((await db.getUser(alice.address)).xp).to.equal(100n);
  });

  it("F5: on-chain XP stays 0 unless a backend calls updateUserXP (no code path does)", async () => {
    const { db, alice } = await loadFixture(deployV1);
    await db.connect(alice).setUser("alice");
    expect((await db.getUser(alice.address)).xp).to.equal(0n);
    expect((await db.getUser(alice.address)).lastRewardedLevel).to.equal(0n);
  });

  it("F6: withdrawal accounting is not tied to XP or level at all", async () => {
    const { db, rm, owner, alice } = await loadFixture(deployV1);
    await db.connect(alice).setUser("alice");                      // level 0, 0 XP
    await rm.connect(alice).requestWithdrawal(E(1000));
    await rm.connect(owner).approveWithdrawal(alice.address);
    await rm.connect(alice).requestWithdrawal(E(1000));            // and again: nothing records 'claimed'
    await rm.connect(owner).approveWithdrawal(alice.address);
  });

  it("F7: a removed user can re-register and start over", async () => {
    const { db, owner, backend, alice } = await loadFixture(deployV1);
    await db.connect(alice).setUser("alice");
    await db.connect(backend).updateUserXP(alice.address, 900);
    await db.connect(owner).removeUser(alice.address);
    await db.connect(alice).setUser("alice");
    expect((await db.getUser(alice.address)).xp).to.equal(0n);
  });

  it("F8: getAllUsers cost grows linearly with the user count", async () => {
    const { db } = await loadFixture(deployV1);
    const points = [];
    let registered = 0;
    for (const target of [50, 200, 400]) {
      for (; registered < target; registered++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await (await ethers.getSigners())[0].sendTransaction({ to: w.address, value: E("0.01") });
        await db.connect(w).setUser(`user-${registered}-padded-login`);
      }
      points.push([target, Number(await db.getAllUsers.estimateGas())]);
    }
    const slope = (points[2][1] - points[0][1]) / (points[2][0] - points[0][0]);
    // record for the paper
    require("fs").mkdirSync("results", { recursive: true });
    require("fs").writeFileSync("results/legacy_getAllUsers.json", JSON.stringify({ points, gasPerUser: slope }, null, 2));
    expect(slope).to.be.greaterThan(5000);
  });
});
