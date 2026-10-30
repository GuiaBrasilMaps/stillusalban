import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerAdminSession } from '@/lib/admin-session';
import AdminCatalogManager from '@/components/admin/AdminCatalogManager';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getServerAdminSession();
  if (!session) {
    redirect('/admin/login');
  }

  const [categories, products, recentMovements, storeSettings, purchaseLists] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.product.findMany({
      include: {
        category: true,
        variants: {
          orderBy: [{ colorName: 'asc' }, { sizeLabel: 'asc' }],
        },
        images: {
          orderBy: [{ colorName: 'asc' }, { displayOrder: 'asc' }],
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.inventoryMovement.findMany({
      include: {
        variant: {
          include: {
            product: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.storeSettings.findUnique({ where: { id: 'default' } }),
    prisma.supplierPurchaseList.findMany({
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const serializedMovements = recentMovements.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }));

  const serializedPurchaseLists = purchaseLists.map((list) => ({
    ...list,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    items: list.items.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
    })),
  }));

  return (
    <AdminCatalogManager
      adminEmail={session.email}
      adminRole={session.role}
      categories={categories}
      initialProducts={products}
      recentMovements={serializedMovements}
      initialDefaultMarkupPercent={storeSettings?.defaultMarkupPercent ?? 120.0}
      initialPixDiscountPercent={storeSettings?.pixDiscountPercent ?? 10.0}
      initialGatewayPixFeePercent={storeSettings?.gatewayPixFeePercent ?? 0.99}
      initialGatewayCardFeePercent={storeSettings?.gatewayCardFeePercent ?? 3.99}
      initialPurchaseLists={serializedPurchaseLists}
    />
  );
}
