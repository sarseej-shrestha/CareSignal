// Runs once before the whole test run (not per file) — pushes the Prisma
// schema to the dedicated test database so integration tests have real
// tables to write to. Does not touch dev.db.
import { execSync } from "node:child_process";

export default function setup() {
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "inherit",
  });
}
