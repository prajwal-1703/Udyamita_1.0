const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (n) => ethers.parseUnits(String(n), 18);
const BUDGET = E(70_000_000);

async function deploy() {
  const [admin, attester, updater, dev, alice, bob, carol, mallory] = await ethers.getSigners();
  const db = await (await ethers.getContractFactory("UserDatabase")).deploy(admin.address, attester.address, updater.address, BUDGET);
  const rm = await (await ethers.getContractFactory("RewardMechanism")).deploy(await db.getAddress(), dev.address);
  const ucn = await ethers.getContractAt("UCoin", await rm.rewardToken());
  const net = await ethers.provider.getNetwork();
  const domain = { name: "Udyamita", version: "1.1", chainId: net.chainId, verifyingContract: await db.getAddress() };
  const types = { Bind: [
    { name: "wallet", type: "address" }, { name: "githubId", type: "uint64" },
    { name: "login", type: "string" }, { name: "deadline", type: "uint256" }] };
  const sign = (wallet, id, login, deadline, signer = attester) => signer.signTypedData(domain, types, { wallet, githubId: id, login, deadline });
  const deadline = async () => (await time.latest()) + 600;
  const register = async (user, id, login = `dev${id}`) => {
    const d = await deadline();
    return db.connect(user).register(id, login, d, await sign(user.address, id, login, d));
  };
  const sync = (user, count) => db.connect(updater).syncXP(user.address, count);
  return { db, rm, ucn, admin, attester, updater, dev, alice, bob, carol, mallory, sign, deadline, register, sync, domain, types };
}

const refReward = (L) => { let r = 5n * 10n ** 18n; for (let i = 0; i < L; i++) r = (r * 108n) / 100n; return r; };
const refSum = (a, b) => { let s = 0n; for (let L = a + 1; L <= b; L++) s += refReward(L); return s; };
const refLevel = (xp) => { let n = 0; while (n < 100 && 50 * (n + 1) * (n + 2) <= xp) n++; return n; };

describe("UCoin v1.1", () => {
  it("mints exactly 100M UCN", async () => {
    const { ucn } = await loadFixture(deploy);
    expect(await ucn.totalSupply()).to.equal(E(100_000_000));
  });
  it("funds the RewardMechanism treasury with 70M at deployment", async () => {
    const { ucn, rm } = await loadFixture(deploy);
    expect(await ucn.balanceOf(await rm.getAddress())).to.equal(E(70_000_000));
    expect(await rm.treasuryBalance()).to.equal(E(70_000_000));
  });
  it("sends 30M to the dev wallet", async () => {
    const { ucn, dev } = await loadFixture(deploy);
    expect(await ucn.balanceOf(dev.address)).to.equal(E(30_000_000));
  });
  it("treasury share equals the UserDatabase reward budget", async () => {
    const { ucn, db } = await loadFixture(deploy);
    expect(await ucn.TREASURY_SHARE()).to.equal(await db.rewardBudget());
  });
  it("has standard metadata and no mint function", async () => {
    const { ucn } = await loadFixture(deploy);
    expect(await ucn.name()).to.equal("UCoin");
    expect(await ucn.symbol()).to.equal("UCN");
    expect(await ucn.decimals()).to.equal(18n);
    expect(ucn.interface.fragments.find((f) => f.name === "mint")).to.equal(undefined);
  });
  it("rejects zero addresses", async () => {
    const U = await ethers.getContractFactory("UCoin");
    await expect(U.deploy(ethers.ZeroAddress, ethers.Wallet.createRandom().address)).to.be.revertedWith("UCoin: zero address");
  });
});

describe("Progression maths", () => {
  it("XP_n = 50 n (n+1)", async () => {
    const { db } = await loadFixture(deploy);
    for (let n = 1; n <= 100; n++) expect(await db.xpForLevel(n)).to.equal(BigInt(50 * n * (n + 1)));
  });
  it("levelForXp matches the reference at every threshold and threshold-1", async () => {
    const { db } = await loadFixture(deploy);
    for (let n = 1; n <= 100; n++) {
      const t = 50 * n * (n + 1);
      expect(await db.levelForXp(t)).to.equal(BigInt(refLevel(t)));
      expect(await db.levelForXp(t - 1)).to.equal(BigInt(refLevel(t - 1)));
    }
  });
  it("caps at level 100", async () => {
    const { db } = await loadFixture(deploy);
    expect(await db.levelForXp(2n ** 32n - 1n)).to.equal(100n);
  });
  it("Reviewer threshold is exactly level 20", async () => {
    const { db } = await loadFixture(deploy);
    expect(await db.REVIEWER_XP()).to.equal(await db.xpForLevel(20));
  });
  it("rewardForLevel equals 5*1.08^L with integer truncation", async () => {
    const { db } = await loadFixture(deploy);
    for (const L of [0, 1, 5, 20, 50, 100]) expect(await db.rewardForLevel(L)).to.equal(refReward(L));
  });
  it("matches the frontend's floating-point formula to 1e-12 relative", async () => {
    const { db } = await loadFixture(deploy);
    for (const L of [1, 33, 100]) {
      const on = Number(ethers.formatUnits(await db.rewardForLevel(L), 18));
      expect(Math.abs(on - 5 * 1.08 ** L) / (5 * 1.08 ** L)).to.be.lessThan(1e-12);
    }
  });
  it("rewardBetween sums the per-level rewards", async () => {
    const { db } = await loadFixture(deploy);
    expect(await db.rewardBetween(3, 17)).to.equal(refSum(3, 17));
    expect(await db.rewardBetween(9, 9)).to.equal(0n);
  });
});

describe("Registration and identity binding", () => {
  it("registers with a valid attestation and stores the login", async () => {
    const { db, alice, register } = await loadFixture(deploy);
    await expect(register(alice, 101, "prajwal-1703")).to.emit(db, "UserRegistered").withArgs(alice.address, 101, "prajwal-1703");
    expect(await db.walletOfGithubId(101)).to.equal(alice.address);
    expect(await db.loginOf(alice.address)).to.equal("prajwal-1703");
    expect(await db.getUserCount()).to.equal(1n);
  });
  it("blocks a second wallet for the same GitHub id (fixes v1.0 F3)", async () => {
    const { db, alice, mallory, register } = await loadFixture(deploy);
    await register(alice, 101);
    await expect(register(mallory, 101)).to.be.revertedWithCustomError(db, "GithubAlreadyLinked");
  });
  it("blocks a second GitHub id for the same wallet", async () => {
    const { db, alice, register } = await loadFixture(deploy);
    await register(alice, 101);
    await expect(register(alice, 102)).to.be.revertedWithCustomError(db, "AlreadyRegistered");
  });
  it("rejects a self-signed attestation", async () => {
    const { db, alice, sign, deadline } = await loadFixture(deploy);
    const d = await deadline();
    await expect(db.connect(alice).register(1, "x", d, await sign(alice.address, 1, "x", d, alice))).to.be.revertedWithCustomError(db, "InvalidAttestation");
  });
  it("rejects an attestation replayed from another wallet", async () => {
    const { db, alice, mallory, sign, deadline } = await loadFixture(deploy);
    const d = await deadline();
    const sig = await sign(alice.address, 1, "alice", d);
    await expect(db.connect(mallory).register(1, "alice", d, sig)).to.be.revertedWithCustomError(db, "InvalidAttestation");
  });
  it("rejects a login different from the attested one", async () => {
    const { db, alice, sign, deadline } = await loadFixture(deploy);
    const d = await deadline();
    const sig = await sign(alice.address, 1, "alice", d);
    await expect(db.connect(alice).register(1, "torvalds", d, sig)).to.be.revertedWithCustomError(db, "InvalidAttestation");
  });
  it("rejects expired attestations", async () => {
    const { db, alice, sign } = await loadFixture(deploy);
    const d = (await time.latest()) - 1;
    await expect(db.connect(alice).register(1, "a", d, await sign(alice.address, 1, "a", d))).to.be.revertedWithCustomError(db, "SignatureExpired");
  });
  it("rejects githubId 0", async () => {
    const { db, alice, sign, deadline } = await loadFixture(deploy);
    const d = await deadline();
    await expect(db.connect(alice).register(0, "a", d, await sign(alice.address, 0, "a", d))).to.be.revertedWithCustomError(db, "InvalidGithubId");
  });
  it("attestations from a revoked attester are refused", async () => {
    const { db, admin, attester, alice, sign, deadline } = await loadFixture(deploy);
    const d = await deadline();
    const sig = await sign(alice.address, 1, "a", d);
    await db.connect(admin).revokeRole(await db.ATTESTER_ROLE(), attester.address);
    await expect(db.connect(alice).register(1, "a", d, sig)).to.be.revertedWithCustomError(db, "InvalidAttestation");
  });
  it("on-chain digest equals the EIP-712 digest the backend signs", async () => {
    const { db, alice, domain, types } = await loadFixture(deploy);
    const off = ethers.TypedDataEncoder.hash(domain, types, { wallet: alice.address, githubId: 7, login: "x", deadline: 9 });
    expect(await db.bindDigest(alice.address, 7, "x", 9)).to.equal(off);
  });
  it("getUser reverts for unknown wallets", async () => {
    const { db, bob } = await loadFixture(deploy);
    await expect(db.getUser(bob.address)).to.be.revertedWithCustomError(db, "NotRegistered");
    expect(await db.isRegistered(bob.address)).to.equal(false);
  });
});

describe("XP synchronisation", () => {
  it("sets XP = 50 x contribution count and caches the level", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1);
    await expect(sync(alice, 12)).to.emit(db, "UserXPUpdated").withArgs(alice.address, 600, 3);
    const u = await db.getUser(alice.address);
    expect(u.xp).to.equal(600n); expect(u.level).to.equal(3n); // XP_3 = 600
  });
  it("only XP_UPDATER_ROLE can sync", async () => {
    const { db, alice, register } = await loadFixture(deploy);
    await register(alice, 1);
    await expect(db.connect(alice).syncXP(alice.address, 999)).to.be.revertedWithCustomError(db, "AccessControlUnauthorizedAccount");
  });
  it("is monotonic: a lower count is ignored (fixes v1.0 F4)", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1);
    await sync(alice, 100); await sync(alice, 3);
    expect((await db.getUser(alice.address)).xp).to.equal(5000n);
  });
  it("is idempotent: repeating the same count changes nothing and pays nothing", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1);
    await sync(alice, 100);
    const before = await db.getUser(alice.address);
    await expect(sync(alice, 100)).to.not.emit(db, "UserXPUpdated");
    expect((await db.getUser(alice.address)).earned).to.equal(before.earned);
  });
  it("pays every crossed level exactly once", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1);
    await sync(alice, 60);   // 3000 XP -> level 7
    await sync(alice, 110);  // 5500 XP -> level 10
    const u = await db.getUser(alice.address);
    expect(u.level).to.equal(10n);
    expect(u.earned).to.equal(refSum(0, 10));
  });
  it("one big sync and many small syncs reach the same state", async () => {
    const { db, alice, bob, register, sync } = await loadFixture(deploy);
    await register(alice, 1); await register(bob, 2);
    for (const c of [5, 17, 60, 61, 230]) await sync(alice, c);
    await sync(bob, 230);
    const a = await db.getUser(alice.address), b = await db.getUser(bob.address);
    expect(a.xp).to.equal(b.xp); expect(a.level).to.equal(b.level); expect(a.earned).to.equal(b.earned);
  });
  it("emits ReviewerPromoted once, at 21,000 XP", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1);
    await sync(alice, 419);
    expect(await db.isReviewer(alice.address)).to.equal(false);
    await expect(sync(alice, 420)).to.emit(db, "ReviewerPromoted").withArgs(alice.address, 21000);
    await expect(sync(alice, 500)).to.not.emit(db, "ReviewerPromoted");
    expect(await db.isReviewer(alice.address)).to.equal(true);
  });
  it("title index advances every five levels (21 titles)", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1);
    await sync(alice, 60); // level 7
    expect(await db.titleIndexOf(alice.address)).to.equal(1n);
    await sync(alice, 10100); // level 100
    expect(await db.titleIndexOf(alice.address)).to.equal(20n);
  });
  it("level 100 pays the full ladder; XP beyond it pays nothing", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1);
    await sync(alice, 10100);
    const full = (await db.getUser(alice.address)).earned;
    expect(full).to.equal(refSum(0, 100));
    await sync(alice, 20000);
    expect((await db.getUser(alice.address)).earned).to.equal(full);
  });
  it("syncXPBatch updates many users and rejects mismatched arrays", async () => {
    const { db, updater, alice, bob, register } = await loadFixture(deploy);
    await register(alice, 1); await register(bob, 2);
    await db.connect(updater).syncXPBatch([alice.address, bob.address], [2, 30]);
    expect((await db.getUser(bob.address)).level).to.equal(5n);
    await expect(db.connect(updater).syncXPBatch([alice.address], [1, 2])).to.be.revertedWithCustomError(db, "LengthMismatch");
  });
  it("sync of an unregistered wallet reverts", async () => {
    const { db, bob, sync } = await loadFixture(deploy);
    await expect(sync(bob, 1)).to.be.revertedWithCustomError(db, "NotRegistered");
  });
  it("profile occupies exactly one storage slot", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 0x1234); await sync(alice, 3);
    const addr = await db.getAddress();
    let found = false;
    for (let s = 0; s < 10; s++) {
      const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [alice.address, s]));
      const w = BigInt(await ethers.provider.getStorage(addr, key));
      if ((w & 0xffffffffffffffffn) === 0x1234n) {
        found = true;
        expect(BigInt(await ethers.provider.getStorage(addr, ethers.toBeHex(BigInt(key) + 1n, 32)))).to.equal(0n);
      }
    }
    expect(found).to.equal(true);
  });
});

describe("Suspension (replaces v1.0 removeUser, fixes F7)", () => {
  it("suspended users keep history but accrue nothing", async () => {
    const { db, admin, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1); await sync(alice, 30);
    await db.connect(admin).setSuspended(alice.address, true);
    await sync(alice, 300);
    const u = await db.getUser(alice.address);
    expect(u.xp).to.equal(1500n); expect(u.suspended).to.equal(true);
  });
  it("a suspended wallet cannot re-register to reset history", async () => {
    const { db, admin, alice, register } = await loadFixture(deploy);
    await register(alice, 1);
    await db.connect(admin).setSuspended(alice.address, true);
    await expect(register(alice, 1)).to.be.revertedWithCustomError(db, "AlreadyRegistered");
  });
  it("only admin can suspend", async () => {
    const { db, alice, mallory, register } = await loadFixture(deploy);
    await register(alice, 1);
    await expect(db.connect(mallory).setSuspended(alice.address, true)).to.be.revertedWithCustomError(db, "AccessControlUnauthorizedAccount");
  });
});

describe("Pagination (replaces v1.0 getAllUsers, fixes F8)", () => {
  it("returns pages and handles out-of-range offsets", async () => {
    const { db, register, alice, bob, carol } = await loadFixture(deploy);
    await register(alice, 1, "a"); await register(bob, 2, "b"); await register(carol, 3, "c");
    const [w1, , l1] = await db.getUsers(0, 2);
    expect(w1).to.deep.equal([alice.address, bob.address]); expect(l1).to.deep.equal(["a", "b"]);
    const [w2] = await db.getUsers(2, 2);
    expect(w2).to.deep.equal([carol.address]);
    const [w3] = await db.getUsers(10, 5);
    expect(w3.length).to.equal(0);
  });
});

describe("Withdrawals", () => {
  async function earned() {
    const f = await deploy();
    await f.register(f.alice, 1);
    await f.sync(f.alice, 30); // level 5
    return f;
  }
  it("available = earned when nothing is claimed", async () => {
    const { rm, alice } = await loadFixture(earned);
    expect(await rm.available(alice.address)).to.equal(refSum(0, 5));
  });
  it("cannot request more than earned (fixes v1.0 F2)", async () => {
    const { rm, alice } = await loadFixture(earned);
    await expect(rm.connect(alice).requestWithdrawal(E(1_000_000))).to.be.revertedWithCustomError(rm, "RM_ExceedsEarned");
  });
  it("unregistered wallets cannot request anything", async () => {
    const { rm, mallory } = await loadFixture(earned);
    await expect(rm.connect(mallory).requestWithdrawal(1)).to.be.revertedWithCustomError(rm, "RM_InactiveUser");
  });
  it("request then owner approval transfers and records the claim", async () => {
    const { rm, ucn, admin, alice } = await loadFixture(earned);
    await expect(rm.connect(alice).requestWithdrawal(E(10))).to.emit(rm, "WithdrawalRequested");
    expect(await rm.available(alice.address)).to.equal(refSum(0, 5) - E(10));
    await expect(rm.connect(admin).approveWithdrawal(alice.address)).to.changeTokenBalances(ucn, [alice, rm], [E(10), -E(10)]);
    expect(await rm.claimed(alice.address)).to.equal(E(10));
  });
  it("claimed amounts cannot be withdrawn twice (fixes v1.0 F6)", async () => {
    const { rm, admin, alice } = await loadFixture(earned);
    const all = await rm.available(alice.address);
    await rm.connect(alice).requestWithdrawal(all);
    await rm.connect(admin).approveWithdrawal(alice.address);
    await expect(rm.connect(alice).requestWithdrawal(1)).to.be.revertedWithCustomError(rm, "RM_ExceedsEarned");
  });
  it("one pending request per user", async () => {
    const { rm, alice } = await loadFixture(earned);
    await rm.connect(alice).requestWithdrawal(E(1));
    await expect(rm.connect(alice).requestWithdrawal(E(1))).to.be.revertedWithCustomError(rm, "RM_RequestAlreadyPending");
  });
  it("zero requests are rejected", async () => {
    const { rm, alice } = await loadFixture(earned);
    await expect(rm.connect(alice).requestWithdrawal(0)).to.be.revertedWithCustomError(rm, "RM_AmountMustBePositive");
  });
  it("rejection releases the amount", async () => {
    const { rm, admin, alice } = await loadFixture(earned);
    await rm.connect(alice).requestWithdrawal(E(10));
    await rm.connect(admin).rejectWithdrawal(alice.address);
    expect(await rm.available(alice.address)).to.equal(refSum(0, 5));
  });
  it("the user can cancel a pending request", async () => {
    const { rm, alice } = await loadFixture(earned);
    await rm.connect(alice).requestWithdrawal(E(10));
    await expect(rm.connect(alice).cancelWithdrawal()).to.emit(rm, "WithdrawalCancelled");
    await expect(rm.connect(alice).cancelWithdrawal()).to.be.revertedWithCustomError(rm, "RM_NoPendingRequest");
  });
  it("only the owner approves or rejects", async () => {
    const { rm, alice } = await loadFixture(earned);
    await rm.connect(alice).requestWithdrawal(E(1));
    await expect(rm.connect(alice).approveWithdrawal(alice.address)).to.be.revertedWithCustomError(rm, "OwnableUnauthorizedAccount");
    await expect(rm.connect(alice).rejectWithdrawal(alice.address)).to.be.revertedWithCustomError(rm, "OwnableUnauthorizedAccount");
  });
  it("approve/reject without a pending request revert", async () => {
    const { rm, admin, alice } = await loadFixture(earned);
    await expect(rm.connect(admin).approveWithdrawal(alice.address)).to.be.revertedWithCustomError(rm, "RM_NoPendingRequest");
    await expect(rm.connect(admin).rejectWithdrawal(alice.address)).to.be.revertedWithCustomError(rm, "RM_NoPendingRequest");
  });
  it("requests within instantLimit are paid immediately", async () => {
    const { rm, ucn, admin, alice } = await loadFixture(earned);
    await rm.connect(admin).setInstantLimit(E(20));
    await expect(rm.connect(alice).requestWithdrawal(E(15))).to.changeTokenBalance(ucn, alice, E(15));
    const [pending] = await rm.getPendingRequest(alice.address);
    expect(pending).to.equal(false);
  });
  it("requests above instantLimit still wait for review", async () => {
    const { rm, admin, alice } = await loadFixture(earned);
    await rm.connect(admin).setInstantLimit(E(1));
    await rm.connect(alice).requestWithdrawal(E(15));
    const [pending, amount] = await rm.getPendingRequest(alice.address);
    expect(pending).to.equal(true); expect(amount).to.equal(E(15));
  });
  it("a user suspended after requesting cannot be paid", async () => {
    const { db, rm, admin, alice } = await loadFixture(earned);
    await rm.connect(alice).requestWithdrawal(E(5));
    await db.connect(admin).setSuspended(alice.address, true);
    await expect(rm.connect(admin).approveWithdrawal(alice.address)).to.be.revertedWithCustomError(rm, "RM_InactiveUser");
  });
  it("the reward token cannot be rescued; other tokens can", async () => {
    const { rm, ucn, admin, dev } = await loadFixture(earned);
    await expect(rm.connect(admin).rescueERC20(await ucn.getAddress(), admin.address, 1)).to.be.revertedWithCustomError(rm, "RM_CannotRescueRewardToken");
    const other = await (await ethers.getContractFactory("UCoin")).deploy(await rm.getAddress(), dev.address);
    await rm.connect(admin).rescueERC20(await other.getAddress(), admin.address, E(1));
    expect(await other.balanceOf(admin.address)).to.equal(E(1));
  });
  it("ownership transfer is two-step", async () => {
    const { rm, admin, bob } = await loadFixture(earned);
    await rm.connect(admin).transferOwnership(bob.address);
    expect(await rm.owner()).to.equal(admin.address);
    await rm.connect(bob).acceptOwnership();
    expect(await rm.owner()).to.equal(bob.address);
  });
});

describe("Solvency", () => {
  it("total earned never exceeds the budget; payouts never exceed the treasury", async () => {
    // small budget to make exhaustion cheap to test
    const [admin, attester, updater, dev] = await ethers.getSigners();
    const db = await (await ethers.getContractFactory("UserDatabase")).deploy(admin.address, attester.address, updater.address, E(300));
    const net = await ethers.provider.getNetwork();
    const domain = { name: "Udyamita", version: "1.1", chainId: net.chainId, verifyingContract: await db.getAddress() };
    const types = { Bind: [{ name: "wallet", type: "address" }, { name: "githubId", type: "uint64" }, { name: "login", type: "string" }, { name: "deadline", type: "uint256" }] };
    const users = [];
    for (let i = 0; i < 3; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      await admin.sendTransaction({ to: w.address, value: E("0.1") });
      const d = (await time.latest()) + 600;
      await db.connect(w).register(i + 1, `u${i}`, d, await attester.signTypedData(domain, types, { wallet: w.address, githubId: i + 1, login: `u${i}`, deadline: d }));
      await db.connect(updater).syncXP(w.address, 420); // level 20 = 247 UCN each
      users.push(w);
    }
    expect(await db.totalEarned()).to.equal(E(300));
    // 247.1 UCN each at level 20: the first is paid in full, the second gets the remainder, the third nothing
    expect((await db.getUser(users[0].address)).earned).to.equal(refSum(0, 20));
    expect((await db.getUser(users[1].address)).earned).to.equal(E(300) - refSum(0, 20));
    expect((await db.getUser(users[2].address)).earned).to.equal(0n);
  });
});

describe("Guards and edge cases", () => {
  it("constructors reject zero addresses", async () => {
    const [a] = await ethers.getSigners();
    const DB = await ethers.getContractFactory("UserDatabase");
    await expect(DB.deploy(ethers.ZeroAddress, a.address, a.address, 1)).to.be.revertedWith("UD: zero address");
    const RM = await ethers.getContractFactory("RewardMechanism");
    await expect(RM.deploy(ethers.ZeroAddress, a.address)).to.be.revertedWithCustomError(RM, "RM_ZeroAddress");
    await expect(RM.deploy(a.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(RM, "RM_ZeroAddress");
  });
  it("a contribution count that would overflow uint32 XP reverts", async () => {
    const { db, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1);
    await expect(sync(alice, 100_000_000)).to.be.revertedWith("UD: xp overflow");
  });
  it("available() is zero once everything earned is claimed", async () => {
    const { rm, admin, alice, register, sync } = await loadFixture(deploy);
    await register(alice, 1); await sync(alice, 6);
    await rm.connect(alice).requestWithdrawal(await rm.available(alice.address));
    expect(await rm.available(alice.address)).to.equal(0n);
    await rm.connect(admin).approveWithdrawal(alice.address);
    expect(await rm.available(alice.address)).to.equal(0n);
  });
  it("owner-only and role-only functions reject other callers", async () => {
    const { db, rm, alice, mallory, register } = await loadFixture(deploy);
    await register(alice, 1);
    await expect(rm.connect(mallory).setInstantLimit(1)).to.be.revertedWithCustomError(rm, "OwnableUnauthorizedAccount");
    await expect(rm.connect(mallory).rescueERC20(alice.address, mallory.address, 1)).to.be.revertedWithCustomError(rm, "OwnableUnauthorizedAccount");
    await expect(db.connect(mallory).syncXPBatch([alice.address], [1])).to.be.revertedWithCustomError(db, "AccessControlUnauthorizedAccount");
  });
  it("rescue to the zero address and suspension of unknown wallets revert", async () => {
    const { db, rm, admin, bob } = await loadFixture(deploy);
    await expect(rm.connect(admin).rescueERC20(bob.address, ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(rm, "RM_ZeroAddress");
    await expect(db.connect(admin).setSuspended(bob.address, true)).to.be.revertedWithCustomError(db, "NotRegistered");
  });
});
