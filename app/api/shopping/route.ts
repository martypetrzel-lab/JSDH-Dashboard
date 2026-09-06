import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { serializeShoppingItem, shoppingItemInputSchema } from "@/lib/shopping";

export const runtime = "nodejs";
const date = (value: string | null) => value ? new Date(`${value}T12:00:00Z`) : null;
export async function GET() { if (!(await requireAdminApi())) return NextResponse.json({ error: "Nepřihlášený přístup." }, { status: 401 }); const items = await getPrisma().shoppingItem.findMany({ orderBy: { createdAt: "desc" } }); return NextResponse.json({ items: items.map(serializeShoppingItem) }); }
export async function POST(request: Request) { if (!(await requireAdminApi())) return NextResponse.json({ error: "Nepřihlášený přístup." }, { status: 401 }); try { const input = shoppingItemInputSchema.parse(await request.json()), prisma = getPrisma(); const item = await prisma.$transaction(async (tx) => { const created = await tx.shoppingItem.create({ data: { name: input.name, estimatedPrice: input.estimatedPrice, purchaseDeadline: date(input.purchaseDeadline), store: input.store || null, url: input.url || null, note: input.note || null } }); await tx.auditLog.create({ data: { action: "SHOPPING_ITEM_CREATED", entity: "ShoppingItem", entityId: created.id, description: `Přidána položka ${created.name}, orientační cena ${created.estimatedPrice ?? "neuvedena"} Kč, termín ${input.purchaseDeadline ?? "neuveden"}.`, actor: "Administrátor" } }); return created; }); return NextResponse.json({ item: serializeShoppingItem(item) }, { status: 201 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Položku se nepodařilo přidat." }, { status: 400 }); } }
