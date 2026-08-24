// Runs before every test file. Points PrismaClient at a dedicated test
// database (never the dev/demo dev.db) — set here, before any test imports
// lib/db, so PrismaClient's own dotenv side effect (see CLAUDE.md) doesn't
// override it with the real DATABASE_URL from .env.
process.env.DATABASE_URL = "file:./test.db";

// tests/integration/webhook.test.ts's general test cases assume
// TWILIO_AUTH_TOKEN starts unset (its signature-validation describe block
// explicitly sets/unsets a fake token around only its own tests — see the
// comment there). That assumption breaks the moment a real token exists in
// the developer's own .env, since PrismaClient's dotenv side effect above
// loads the whole file into process.env, not just DATABASE_URL — the real
// token would otherwise enforce signature validation against every plain
// test request in this file, none of which carry a valid signature.
process.env.TWILIO_AUTH_TOKEN = "";
