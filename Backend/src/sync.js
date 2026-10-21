// XP synchronisation: GitHub all-time public contribution count -> UserDatabase.syncXP(Batch).
// Counts are monotonic on chain, so re-sending a count is harmless (idempotent) and a count that
// went down (e.g. a deleted repository) is ignored rather than reducing a user's XP.

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const k = i++;
      try { out[k] = { ok: true, value: await fn(items[k], k) }; }
      catch (e) { out[k] = { ok: false, error: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Sync one user on demand (dashboard "Sync now"). Returns what happened. */
async function syncOne({ chain, github, wallet, xpPerContribution = 50 }) {
  const profile = await chain.db.getUser(wallet);
  const { total } = await github.contributionCount(profile.githubId);
  const onChainXp = Number(profile.xp);
  if (total * xpPerContribution <= onChainXp) return { wallet, count: total, changed: false };
  const tx = await chain.db.syncXP(wallet, total);
  return { wallet, count: total, changed: true, txHash: tx.hash };
}

/** Periodic job: page through all users, collect increases, submit batches. */
async function syncAll({ chain, github, batchSize = 100, pageSize = 200, concurrency = 4, xpPerContribution = 50, log = () => {} }) {
  const n = Number(await chain.db.getUserCount());
  const pending = [];
  let failures = 0;
  for (let offset = 0; offset < n; offset += pageSize) {
    const [wallets, profiles] = await chain.db.getUsers(offset, pageSize);
    const active = wallets.map((w, i) => ({ wallet: w, p: profiles[i] })).filter((x) => !x.p.suspended);
    const results = await mapLimit(active, concurrency, async (x) => {
      const { total } = await github.contributionCount(x.p.githubId);
      return { wallet: x.wallet, total, xp: Number(x.p.xp) };
    });
    for (const r of results) {
      if (!r.ok) { failures++; continue; }
      if (r.value.total * xpPerContribution > r.value.xp) pending.push(r.value);
    }
  }
  const txHashes = [];
  for (let i = 0; i < pending.length; i += batchSize) {
    const chunk = pending.slice(i, i + batchSize);
    const tx = await chain.db.syncXPBatch(chunk.map((c) => c.wallet), chunk.map((c) => c.total));
    txHashes.push(tx.hash);
    log(`syncXPBatch(${chunk.length}) -> ${tx.hash}`);
  }
  return { users: n, updated: pending.length, failures, txHashes };
}

module.exports = { syncOne, syncAll, mapLimit };
