import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerAdminSession } from '@/lib/admin-session';
import AdminShippingManager from '@/components/admin/AdminShippingManager';

export const dynamic = 'force-dynamic';

export default async function AdminShippingPage() {
  const session = await getServerAdminSession();
  if (!session) {
    redirect('/admin/login');
  }

  const [settings, municipalities] = await Promise.all([
    prisma.storeSettings.findUnique({ where: { id: 'default' } }),
    prisma.nearbyMunicipality.findMany({
      orderBy: [{ isActive: 'desc' }, { cityName: 'asc' }],
    }),
  ]);

  return (
    <AdminShippingManager
      adminEmail={session.email}
      adminRole={session.role}
      settings={{
        originCep: settings?.originCep ?? '29260-000',
        pixDiscountPercent: settings?.pixDiscountPercent ?? 10,
        maxInstallments: settings?.maxInstallments ?? 12,
        whatsappNumber: settings?.whatsappNumber ?? '',
      }}
      municipalities={municipalities}
    />
  );
}
