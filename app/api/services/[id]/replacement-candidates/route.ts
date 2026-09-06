import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { prepareEmergencyReplacement } from "@/lib/emergency-replacement-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate" };

const query = z.object({ assignmentId: z.string().min(1), from: z.iso.datetime(), to: z.iso.datetime(), ignoreReplacementId: z.string().min(1).optional() });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "Nepřihlášený přístup." }, { status: 401, headers: noStoreHeaders });
  try {
    const { id } = await context.params, url = new URL(request.url), input = query.parse({ assignmentId: url.searchParams.get("assignmentId"), from: url.searchParams.get("from"), to: url.searchParams.get("to"), ignoreReplacementId: url.searchParams.get("ignoreReplacementId") ?? undefined });
    const result = await prepareEmergencyReplacement(id, input.assignmentId, new Date(input.from), new Date(input.to), input.ignoreReplacementId);
    return NextResponse.json({ candidates: result.candidates }, { headers: noStoreHeaders });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Kandidáty se nepodařilo načíst." }, { status: 400, headers: noStoreHeaders }); }
}
