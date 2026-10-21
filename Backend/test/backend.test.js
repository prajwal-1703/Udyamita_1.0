const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const { makeClient } = require("../src/github");
const { signBinding, bindDomain, BIND_TYPES } = require("../src/chain");
const { createApp } = require("../src/app");
const { syncAll } = require("../src/sync");

// ---------------------------------------------------------------- fake GitHub
function fakeGithubFetch({ id = 42, login = "octo-dev", createdAt = "2023-03-01T00:00:00Z", perYear = { 2023: [5, 1, 2, 0], 2024: [40, 3, 9, 4], 2025: [10, 0, 1, 2], 2026: [7, 0, 0, 1] } } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (url.endsWith(`/user/${id}`)) return json({ id, login, created_at: createdAt });
    if (url.endsWith("/graphql")) {
      const body = JSON.parse(opts.body);
      const user = { databaseId: id };
      for (const m of body.query.matchAll(/y(\d{4}): contributionsCollection/g)) {
        const [c, i, p, r] = perYear[m[1]] || [0, 0, 0, 0];
        user[`y${m[1]}`] = { totalCommitContributions: c, totalIssueContributions: i, totalPullRequestContributions: p, totalPullRequestReviewContributions: r };
      }
      return json({ data: { user } });
    }
    if (url.includes("login/oauth/access_token")) return json({ access_token: "gho_test" });
    if (url.endsWith("/user")) return json({ id, login, avatar_url: "https://avatars.example/x" });
    return json({ message: "not found" }, 404);
  };
  return { fetchImpl, calls };
}

test("contributionCount sums four contribution kinds over every year since account creation", async () => {
  const { fetchImpl } = fakeGithubFetch();
  const gh = makeClient({ token: "t", fetchImpl });
  const r = await gh.contributionCount(42, new Date("2026-10-22T00:00:00Z"));
  assert.equal(r.total, 8 + 56 + 13 + 8);
  assert.deepEqual(Object.keys(r.byYear), ["2023", "2024", "2025", "2026"]);
});

test("the login travels as a GraphQL variable, never inside the query text", async () => {
  const { fetchImpl, calls } = fakeGithubFetch({ login: 'evil") { x } #' });
  const gh = makeClient({ token: "t", fetchImpl });
  await gh.contributionCount(42, new Date("2026-01-02T00:00:00Z"));
  const q = calls.find((c) => c.url.endsWith("/graphql"));
  const body = JSON.parse(q.opts.body);
  assert.ok(!body.query.includes("evil"));
  assert.equal(body.variables.login, 'evil") { x } #');
});

test("a renamed or mismatched account is rejected", async () => {
  const { fetchImpl } = fakeGithubFetch({ id: 7 });
  const gh = makeClient({ token: "t", fetchImpl });
  await assert.rejects(gh.contributionCount(42), /404|mismatch|failed/);
});

test("signBinding produces a signature that recovers to the attester", async () => {
  const attester = ethers.Wallet.createRandom();
  const wallet = ethers.Wallet.createRandom().address;
  const db = ethers.Wallet.createRandom().address;
  const a = await signBinding({ attester, chainId: 11155111, userDatabase: db, wallet, githubId: 42, login: "octo-dev", ttlSeconds: 600, now: 1_700_000_000_000 });
  assert.equal(a.deadline, 1_700_000_600);
  const rec = ethers.verifyTypedData(bindDomain(11155111, db), BIND_TYPES, { wallet, githubId: 42n, login: "octo-dev", deadline: BigInt(a.deadline) }, a.signature);
  assert.equal(rec, attester.address);
});

// ---------------------------------------------------------------- HTTP API
function fakeChain(bound = {}) {
  const attester = ethers.Wallet.createRandom();
  const synced = [];
  return {
    attester, chainId: 11155111, userDatabase: ethers.Wallet.createRandom().address, synced,
    db: {
      walletOfGithubId: async (id) => bound[Number(id)] || ethers.ZeroAddress,
      getUser: async (w) => ({ githubId: 42n, xp: 0n, suspended: false }),
      syncXP: async (w, c) => { synced.push([w, c]); return { hash: "0xabc" }; },
    },
  };
}

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

const config = {
  clientUrl: "http://localhost:8080", sessionSecret: "s".repeat(32),
  github: { clientId: "cid", clientSecret: "csecret" },
  attestationTtlSeconds: 600, manualSyncCooldownSeconds: 600,
};

async function login(base) {
  const start = await fetch(`${base}/auth/github`, { redirect: "manual" });
  const loc = new URL(start.headers.get("location"));
  assert.equal(loc.searchParams.get("scope"), "read:user");
  const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const cb = await fetch(`${base}/auth/github/callback?code=abc&state=${loc.searchParams.get("state")}`, { redirect: "manual", headers: { cookie } });
  assert.match(cb.headers.get("location"), /dashboard\?github=linked$/);
  assert.ok(!cb.headers.get("location").includes("gho_"), "token must not appear in redirect");
  return cb.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

test("OAuth callback with a wrong state is refused", async () => {
  const { fetchImpl } = fakeGithubFetch();
  const app = createApp({ config, github: makeClient({ token: "t", fetchImpl }), chain: fakeChain() });
  await withServer(app, async (base) => {
    const start = await fetch(`${base}/auth/github`, { redirect: "manual" });
    const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const cb = await fetch(`${base}/auth/github/callback?code=abc&state=forged`, { redirect: "manual", headers: { cookie } });
    assert.match(cb.headers.get("location"), /error=oauth_state/);
  });
});

test("attestation requires a GitHub session and a valid wallet", async () => {
  const { fetchImpl } = fakeGithubFetch();
  const chain = fakeChain();
  const app = createApp({ config, github: makeClient({ token: "t", fetchImpl }), chain });
  await withServer(app, async (base) => {
    const anon = await fetch(`${base}/api/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: ethers.ZeroAddress }) });
    assert.equal(anon.status, 401);
    const cookie = await login(base);
    const bad = await fetch(`${base}/api/attest`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ wallet: "0x123" }) });
    assert.equal(bad.status, 400);
    const wallet = ethers.Wallet.createRandom().address;
    const ok = await fetch(`${base}/api/attest`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ wallet }) });
    const att = await ok.json();
    assert.equal(att.githubId, "42"); assert.equal(att.login, "octo-dev");
    const rec = ethers.verifyTypedData(bindDomain(chain.chainId, chain.userDatabase), BIND_TYPES, { wallet, githubId: 42n, login: "octo-dev", deadline: BigInt(att.deadline) }, att.signature);
    assert.equal(rec, chain.attester.address);
  });
});

test("an already-linked GitHub account gets no new attestation", async () => {
  const { fetchImpl } = fakeGithubFetch();
  const linked = ethers.Wallet.createRandom().address;
  const app = createApp({ config, github: makeClient({ token: "t", fetchImpl }), chain: fakeChain({ 42: linked }) });
  await withServer(app, async (base) => {
    const cookie = await login(base);
    const r = await fetch(`${base}/api/attest`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ wallet: ethers.Wallet.createRandom().address }) });
    assert.equal(r.status, 409);
  });
});

test("manual sync submits the all-time count once and then enforces the cooldown", async () => {
  const { fetchImpl } = fakeGithubFetch();
  const wallet = ethers.Wallet.createRandom().address;
  const chain = fakeChain({ 42: wallet });
  const app = createApp({ config, github: makeClient({ token: "t", fetchImpl }), chain });
  await withServer(app, async (base) => {
    const cookie = await login(base);
    const r1 = await (await fetch(`${base}/api/sync`, { method: "POST", headers: { cookie } })).json();
    assert.equal(r1.changed, true); assert.equal(r1.count, 85);
    assert.deepEqual(chain.synced, [[wallet, 85]]);
    const r2 = await fetch(`${base}/api/sync`, { method: "POST", headers: { cookie } });
    assert.equal(r2.status, 429);
  });
});

test("syncAll batches only users whose count increased and skips suspended users", async () => {
  const wallets = Array.from({ length: 5 }, () => ethers.Wallet.createRandom().address);
  const profiles = [
    { githubId: 1n, xp: 0n, suspended: false },
    { githubId: 2n, xp: 5000n, suspended: false },   // already at 100 contributions
    { githubId: 3n, xp: 0n, suspended: true },
    { githubId: 4n, xp: 100n, suspended: false },
    { githubId: 5n, xp: 0n, suspended: false },
  ];
  const batches = [];
  const chain = { db: {
    getUserCount: async () => 5n,
    getUsers: async (o, l) => [wallets.slice(o, o + l), profiles.slice(o, o + l), []],
    syncXPBatch: async (ws, cs) => { batches.push([ws, cs]); return { hash: "0x" + batches.length }; },
  } };
  const counts = { 1: 10, 2: 100, 3: 999, 4: 2, 5: 7 };
  const github = { contributionCount: async (id) => { if (Number(id) === 5) throw new Error("rate limited"); return { total: counts[Number(id)] }; } };
  const r = await syncAll({ chain, github, batchSize: 100 });
  assert.equal(r.updated, 1);   // only user 1 increased (user 4: 2*50 = 100 = current XP)
  assert.equal(r.failures, 1);  // user 5 failed and is retried next run
  assert.deepEqual(batches, [[[wallets[0]], [10]]]);
});
