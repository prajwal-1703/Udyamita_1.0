const { loadConfig } = require("./config");
const { makeClient } = require("./github");
const { makeChain } = require("./chain");
const { createApp } = require("./app");
const { syncAll } = require("./sync");

const config = loadConfig();
const github = makeClient({ token: config.github.apiToken });
const chain = makeChain({ ...config.chain });
const app = createApp({ config, github, chain });

app.listen(config.port, () => console.log(`BlockSource backend on :${config.port}`));

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const r = await syncAll({ chain, github, batchSize: config.syncBatchSize, log: console.log });
    console.log(`[sync] users=${r.users} updated=${r.updated} failures=${r.failures}`);
  } catch (e) {
    console.error("[sync] failed:", e.message);
  } finally {
    running = false;
  }
}
if (config.syncIntervalMinutes > 0) {
  setInterval(tick, config.syncIntervalMinutes * 60 * 1000);
  tick();
}
