import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { integrationResponseHeaders } from "@/lib/integration-cors";
import { fromLocalDateTimeInput } from "@/lib/service";
import { INTEGRATION_API_VERSION, INTEGRATION_TIMEZONE, integrationAuthorized } from "@/lib/integration-core";

export * from "@/lib/integration-core";
export { integrationOptions } from "@/lib/integration-cors";

export const integrationServiceInclude = {
  assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] },
  replacements: { include: { originalMember: true, replacementMember: true }, orderBy: { from: "asc" } },
} satisfies Prisma.WeeklyServiceInclude;

export function integrationUnauthorized(request: Request) { return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: integrationResponseHeaders(request) }); }
export function integrationResponse(request: Request, data: Record<string, unknown>, now = new Date()) { return NextResponse.json({ apiVersion: INTEGRATION_API_VERSION, generatedAt: now.toISOString(), timezone: INTEGRATION_TIMEZONE, ...data }, { headers: integrationResponseHeaders(request) }); }
export function integrationError(request: Request, message: string, status = 400) { return NextResponse.json({ error: message }, { status, headers: integrationResponseHeaders(request) }); }
export function requireIntegrationApi(request: Request) { return integrationAuthorized(request) ? null : integrationUnauthorized(request); }
export function integrationRoute(handler: (request: Request) => Response | Promise<Response>) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch {
      return integrationError(request, "Internal server error", 500);
    }
  };
}
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
