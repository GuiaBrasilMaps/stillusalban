import React from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerAdminSession } from '@/lib/admin-session';
import { releaseExpiredOrderReservations } from '@/lib/orders';
import AdminOrdersManager, { AdminOrderDTO } from '@/components/admin/AdminOrdersManager';

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage() {
  const session = await getServerAdminSession();
  if (!session) {
    redirect('/admin/login');
  }

  await releaseExpiredOrderReservations();

  const orders = await prisma.order.findMany({
    include: {
      customer: true,
      items: true,
      shipping: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const serialized: AdminOrderDTO[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    channel: o.channel,
    orderStatus: o.orderStatus,
    paymentStatus: o.paymentStatus,
    paymentMethodChosen: o.paymentMethodChosen,
    installments: o.installments,
    hasMadeToOrderItems: o.hasMadeToOrderItems,
    maxPrepDays: o.maxPrepDays,
    subtotalCents: o.subtotalCents,
    discountCents: o.discountCents,
    shippingCents: o.shippingCents,
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    customer: {
      fullName: o.customer.fullName,
      cpf: o.customer.cpf,
      email: o.customer.email,
      phoneWhatsapp: o.customer.phoneWhatsapp,
    },
    items: o.items.map((i) => ({
      id: i.id,
      snapshotProductName: i.snapshotProductName,
      snapshotSkuCode: i.snapshotSkuCode,
      snapshotColorName: i.snapshotColorName,
      snapshotModelName: i.snapshotModelName,
      snapshotSizeLabel: i.snapshotSizeLabel,
      snapshotSupplyMode: i.snapshotSupplyMode,
      snapshotPrepDays: i.snapshotPrepDays,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      lineTotalCents: i.lineTotalCents,
    })),
    shipping: o.shipping
      ? {
          shippingMode: o.shipping.shippingMode,
          carrierName: o.shipping.carrierName,
          serviceName: o.shipping.serviceName,
          cep: o.shipping.cep,
          street: o.shipping.street,
          number: o.shipping.number,
          neighborhood: o.shipping.neighborhood,
          city: o.shipping.city,
          state: o.shipping.state,
          trackingCode: o.shipping.trackingCode,
        }
      : null,
  }));

  return (
    <AdminOrdersManager
      adminEmail={session.email}
      adminRole={session.role}
      initialOrders={serialized}
    />
  );
}
