import { reconcileApplication } from "../server/_automation.js";
import { closeDatabase } from "../server/_db.js";

try {
  const result = await reconcileApplication(100);
  console.log(JSON.stringify({ ...result, timestamp: new Date().toISOString() }));
  if (result.errors.length) process.exitCode = 1;
} finally { await closeDatabase(); }
