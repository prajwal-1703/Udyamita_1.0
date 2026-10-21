// Reads and validates configuration from the environment. Nothing secret is hard-coded:
// v1.0 shipped a GitHub OAuth client secret in Frontend/server.js; that secret must be revoked.
require("dotenv").config();

function required(name, env) {
  const v = env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required environment variable ${name}`);
  return String(v).trim();
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 5000),
    clientUrl: env.CLIENT_URL || "http://localhost:8080",
    sessionSecret: required("SESSION_SECRET", env),
    github: {
      clientId: required("GITHUB_CLIENT_ID", env),
      clientSecret: required("GITHUB_CLIENT_SECRET", env),
      // Server-side token used only to read PUBLIC contribution counts (no user tokens are stored).
      apiToken: required("GITHUB_API_TOKEN", env),
    },
    chain: {
      rpcUrl: required("RPC_URL", env),
      chainId: Number(env.CHAIN_ID || 11155111),
      userDatabase: required("USER_DATABASE_ADDRESS", env),
      attesterKey: required("ATTESTER_PRIVATE_KEY", env),
      updaterKey: required("XP_UPDATER_PRIVATE_KEY", env),
    },
    attestationTtlSeconds: Number(env.ATTESTATION_TTL_SECONDS || 600),
    syncIntervalMinutes: Number(env.SYNC_INTERVAL_MINUTES || 360),
    manualSyncCooldownSeconds: Number(env.MANUAL_SYNC_COOLDOWN_SECONDS || 600),
    syncBatchSize: Number(env.SYNC_BATCH_SIZE || 100),
  };
}

module.exports = { loadConfig };
