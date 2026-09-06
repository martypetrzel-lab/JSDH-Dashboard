CREATE TYPE "ShoppingItemStatus" AS ENUM ('PLANNED', 'PURCHASED');

CREATE TABLE "ShoppingItem" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "estimatedPrice" INTEGER,
  "purchaseDeadline" DATE,
  "store" TEXT,
  "url" TEXT,
  "note" TEXT,
  "status" "ShoppingItemStatus" NOT NULL DEFAULT 'PLANNED',
  "purchasedAt" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShoppingItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShoppingItem_status_purchaseDeadline_idx" ON "ShoppingItem"("status", "purchaseDeadline");
