import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { fromLocalDateTimeInput } from "@/lib/service";
import { INTEGRATION_API_VERSION, INTEGRATION_TIMEZONE, integrationAuthorized } from "@/lib/integration-core";

export * from "@/lib/integration-core";

export const integrationServiceInclude = {
  assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] },
  replacements: { include: { originalMember: true, replacementMember: true }, orderBy: { from: "asc" } },
  temporaryAssignments: { include: { member: true }, orderBy: [{ from: "asc" }, { role: "asc" }, { slot: "asc" }] },
} satisfies Prisma.WeeklyServiceInclude;

export function integrationUnauthorized() { return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } }); }
export function integrationResponse(data: Record<string, unknown>, now = new Date()) { return NextResponse.json({ apiVersion: INTEGRATION_API_VERSION, generatedAt: now.toISOString(), timezone: INTEGRATION_TIMEZONE, ...data }, { headers: { "Cache-Control": "no-store" } }); }
export function integrationError(message: string, status = 400) { return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } }); }
export function requireIntegrationApi(request: Request) { return integrationAuthorized(request) ? null : integrationUnauthorized(); }
export function parseIntegrationRangeValue(value: string | null, fallback: Date) {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = fromLocalDateTimeInput(`${value}T00:00`, INTEGRATION_TIMEZONE);
    if (!parsed) throw new Error("Invalid date range");
    return parsed;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid date range");
  return parsed;
}
