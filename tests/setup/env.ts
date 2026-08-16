// Runs before every test file. Points PrismaClient at a dedicated test
// database (never the dev/demo dev.db) — set here, before any test imports
// lib/db, so PrismaClient's own dotenv side effect (see CLAUDE.md) doesn't
// override it with the real DATABASE_URL from .env.
process.env.DATABASE_URL = "file:./test.db";
