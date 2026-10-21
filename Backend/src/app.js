// HTTP API. Replaces v1.0's Frontend/server.js, which hard-coded the OAuth client secret,
// requested the `repo` scope (full private-repository access), had no OAuth `state` check,
// and returned the user's access token to the browser in a URL query string.
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const cookieSession = require("cookie-session");
const { ethers } = require("ethers");
const { signBinding } = require("./chain");
const { syncOne } = require("./sync");

function createApp({ config, github, chain, now = () => Date.now() }) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieSession({
    name: "udy_session",
    keys: [config.sessionSecret],
    httpOnly: true,
    sameSite: "lax",
    secure: config.clientUrl.startsWith("https://"),
    maxAge: 24 * 60 * 60 * 1000,
  }));

  const lastManualSync = new Map(); // githubId -> ms timestamp

  app.get("/health", (req, res) => res.json({ ok: true }));

  // 1. Start OAuth: read:user is enough to learn the account id; no repository access is requested.
  app.get("/auth/github", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", config.github.clientId);
    url.searchParams.set("scope", "read:user");
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  // 2. Callback: verify state, learn {id, login}, discard the token, keep identity in the session cookie.
  app.get("/auth/github/callback", async (req, res) => {
    const { code, state } = req.query;
    const expected = req.session.oauthState;
    req.session.oauthState = undefined;
    if (!code || !state || !expected || state !== expected) {
      return res.redirect(`${config.clientUrl}/?error=oauth_state`);
    }
    try {
      const id = await github.identityFromOAuthCode({ clientId: config.github.clientId, clientSecret: config.github.clientSecret, code });
      req.session.github = { id: id.githubId, login: id.login, avatarUrl: id.avatarUrl };
      res.redirect(`${config.clientUrl}/dashboard?github=linked`);
    } catch (e) {
      res.redirect(`${config.clientUrl}/?error=oauth_failed`);
    }
  });

  app.post("/auth/logout", (req, res) => { req.session = null; res.json({ ok: true }); });

  const requireGithub = (req, res, next) => {
    if (!req.session || !req.session.github) return res.status(401).json({ error: "GitHub not connected" });
    next();
  };

  app.get("/api/me", requireGithub, async (req, res) => {
    const g = req.session.github;
    const wallet = await chain.db.walletOfGithubId(g.id);
    res.json({ githubId: g.id, login: g.login, avatarUrl: g.avatarUrl, wallet: wallet === ethers.ZeroAddress ? null : wallet });
  });

  // 3. Attestation for UserDatabase.register(): binds this GitHub session to the wallet the user names.
  app.post("/api/attest", requireGithub, async (req, res) => {
    const { wallet } = req.body || {};
    if (!wallet || !ethers.isAddress(wallet)) return res.status(400).json({ error: "invalid wallet" });
    const g = req.session.github;
    const bound = await chain.db.walletOfGithubId(g.id);
    if (bound !== ethers.ZeroAddress) return res.status(409).json({ error: "GitHub account already linked", wallet: bound });
    const att = await signBinding({
      attester: chain.attester, chainId: chain.chainId, userDatabase: chain.userDatabase,
      wallet, githubId: g.id, login: g.login, ttlSeconds: config.attestationTtlSeconds, now: now(),
    });
    res.json(att);
  });

  // 4. On-demand sync for the signed-in user, rate limited.
  app.post("/api/sync", requireGithub, async (req, res) => {
    const g = req.session.github;
    const last = lastManualSync.get(g.id) || 0;
    const waitMs = last + config.manualSyncCooldownSeconds * 1000 - now();
    if (waitMs > 0) return res.status(429).json({ error: "sync cooldown", retryAfterSeconds: Math.ceil(waitMs / 1000) });
    const wallet = await chain.db.walletOfGithubId(g.id);
    if (wallet === ethers.ZeroAddress) return res.status(409).json({ error: "register on chain first" });
    lastManualSync.set(g.id, now());
    try {
      res.json(await syncOne({ chain, github, wallet }));
    } catch (e) {
      lastManualSync.delete(g.id);
      res.status(502).json({ error: e.message });
    }
  });

  return app;
}

module.exports = { createApp };
