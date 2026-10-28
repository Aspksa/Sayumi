/* Runs every suite and reports once. Exit code is non zero if anything failed. */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const suites = [
  { name: "модули", file: "unit.js" },
  { name: "браузер", file: "browser.js" }
];

let failed = 0;
for (const suite of suites) {
  console.log("\n=== " + suite.name + " ===");
  const res = spawnSync(process.execPath, [path.join(__dirname, suite.file)], { stdio: "inherit" });
  if (res.status !== 0) failed++;
}

console.log("\n" + (failed ? failed + " набор(ов) не прошли" : "всё зелено"));
process.exit(failed ? 1 : 0);
