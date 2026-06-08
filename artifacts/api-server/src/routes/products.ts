import { Router } from "express";
import { db, merchantProductsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

const ALL_PRODUCTS = ["dynamic_qr", "static_qr", "virtual_account", "payment_links", "payouts"];

// GET /api/products
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId: number = user.merchantId!;

  const existing = await db.select().from(merchantProductsTable).where(eq(merchantProductsTable.merchantId, merchantId));
  const existingMap = new Map(existing.map(p => [p.productType, p]));

  const products = ALL_PRODUCTS.map(pt => {
    const row = existingMap.get(pt);
    return row ?? { id: 0, merchantId, productType: pt, enabled: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  });

  res.json(products);
});

// PUT /api/products/:productType
router.put("/:productType", async (req, res) => {
  const user = (req as any).user;
  const merchantId: number = user.merchantId!;
  const { productType } = req.params;
  const { enabled } = req.body;

  if (!ALL_PRODUCTS.includes(productType)) {
    res.status(400).json({ error: "Invalid product type" });
    return;
  }

  const existing = await db.select().from(merchantProductsTable)
    .where(and(eq(merchantProductsTable.merchantId, merchantId), eq(merchantProductsTable.productType, productType)))
    .limit(1);

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantProductsTable)
      .set({ enabled: !!enabled })
      .where(and(eq(merchantProductsTable.merchantId, merchantId), eq(merchantProductsTable.productType, productType)))
      .returning();
  } else {
    [result] = await db.insert(merchantProductsTable)
      .values({ merchantId, productType, enabled: !!enabled })
      .returning();
  }

  res.json(result);
});

export default router;
