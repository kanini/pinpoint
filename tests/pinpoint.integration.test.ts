import { describe, it, expect } from "bun:test";
import { spawnSync } from "bun";
import path from "path";

describe("pinpoint.ts integration test", () => {
  it("processes the sample CSV without error", () => {
    const fs = require("fs");

    const scriptPath = path.join(import.meta.dir, "..", "pinpoint.ts");
    const csvPath = path.join(import.meta.dir, "address-list.csv");
    const sqlFile = csvPath + ".sql";
    const geojsonFile = csvPath + ".geojson";

    // Remove old output files if they exist
    try {
      fs.unlinkSync(sqlFile);
    } catch {}
    try {
      fs.unlinkSync(geojsonFile);
    } catch {}

    // Spawn the script, passing the CSV path as the argument and auto-confirming "Y"
    const result = spawnSync(["bun", "run", scriptPath, csvPath], {
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
      input: "y\n", // auto-confirm
      encoding: "utf-8",
    });

    // Check for success
    expect(result.exitCode).toBe(0);
    expect(result.stderr?.toString()).toBe("");
    // We expect row 1 is processed
    expect(result.stdout?.toString()).toContain("-- Processing row 1:");
  }, 30_000);
});
