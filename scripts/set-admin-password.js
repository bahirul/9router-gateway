import process from "node:process";
import { DecisionStore } from "../src/decision-store.js";
import { RuntimeConfigManager } from "../src/config.js";

const password = process.argv[2] || process.env.SMART_ROUTER_ADMIN_PASSWORD;

if (!password) {
  console.error("Usage: npm run admin:set-password -- <new-password>");
  process.exit(1);
}

const configPath = process.env.SMART_ROUTER_CONFIG || "./config.yaml";
const config = new RuntimeConfigManager(configPath).get();

const store = new DecisionStore({
  directory: process.env.SMART_ROUTER_DATA_DIR || config.logging.directory,
  logger: console,
});

await store.init();
if (!store.ready) {
  console.error(store.lastError?.message || "Failed to open router.sqlite");
  process.exit(1);
}

store.setAdminPassword(password);
console.log("Admin password updated");
store.close();
