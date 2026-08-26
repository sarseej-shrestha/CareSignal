import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetDb, seedTestPatient } from "../helpers/db";
import { POST } from "@/app/api/alerts/[id]/status/route";

function statusRequest(status: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/alerts/x/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  await resetDb();
});

describe("POST /api/alerts/[id]/status", () => {
  it("updates status from OPEN to ACKNOWLEDGED", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "LOGISTICAL", reasons: "[]", status: "OPEN" },
    });

    const res = await POST(statusRequest("ACKNOWLEDGED"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("ACKNOWLEDGED");
  });

  it("updates status to RESOLVED", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "EMOTIONAL", reasons: "[]", status: "ACKNOWLEDGED" },
    });

    const res = await POST(statusRequest("RESOLVED"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  it("rejects an invalid status value", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "LOGISTICAL", reasons: "[]", status: "OPEN" },
    });

    const res = await POST(statusRequest("DELETED_FOREVER"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(400);
    const unchanged = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(unchanged?.status).toBe("OPEN");
  });

  it("returns 404 for a nonexistent alert id", async () => {
    const res = await POST(statusRequest("RESOLVED"), { params: Promise.resolve({ id: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });
});
