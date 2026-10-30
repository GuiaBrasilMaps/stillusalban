export interface MercadoPagoPaymentResult {
  success: boolean;
  paymentId?: string;
  status?: string;
  statusDetail?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  error?: string;
}

export interface MercadoPagoPreferenceResult {
  success: boolean;
  preferenceId?: string;
  initPoint?: string;
  sandboxInitPoint?: string;
  error?: string;
}

export function getMercadoPagoAccessToken(): string {
  return (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
}

export function getMercadoPagoPublicKey(): string {
  return (
    process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ||
    process.env.MERCADOPAGO_PUBLIC_KEY ||
    ''
  ).trim();
}

export function isMercadoPagoConfigured(): boolean {
  return getMercadoPagoAccessToken().length > 10;
}

export function isMercadoPagoTestMode(): boolean {
  const token = getMercadoPagoAccessToken();
  return token.startsWith('TEST-');
}

/**
 * Cria cobrança PIX via API oficial do Mercado Pago (POST /v1/payments).
 * Retorna os dados para renderização do QR Code Base64 e Copia e Cola na própria página.
 */
export async function createMercadoPagoPixPayment(params: {
  orderNumber: string;
  totalCents: number;
  customerName: string;
  customerEmail: string;
  customerCpf: string;
  notificationUrl?: string;
  idempotencyKey?: string;
  customFetch?: typeof fetch;
}): Promise<MercadoPagoPaymentResult> {
  const token = getMercadoPagoAccessToken();
  if (!token) {
    return {
      success: false,
      error: 'MERCADOPAGO_NAO_CONFIGURADO: Access Token ausente no ambiente.',
    };
  }

  const fetcher = params.customFetch ?? fetch;
  const transactionAmount = Number((params.totalCents / 100).toFixed(2));
  const cleanCpf = params.customerCpf.replace(/\D/g, '');
  const nameParts = params.customerName.trim().split(' ');
  const firstName = nameParts[0] || 'Cliente';
  const lastName = nameParts.slice(1).join(' ') || 'Stillus';

  const payload: Record<string, unknown> = {
    transaction_amount: transactionAmount,
    description: `STILLUS ALBAN — Pedido #${params.orderNumber}`,
    payment_method_id: 'pix',
    payer: {
      email: params.customerEmail,
      first_name: firstName,
      last_name: lastName,
      identification: {
        type: 'CPF',
        number: cleanCpf,
      },
    },
    external_reference: params.orderNumber,
  };

  if (params.notificationUrl) {
    payload.notification_url = params.notificationUrl;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  if (params.idempotencyKey) {
    headers['X-Idempotency-Key'] = params.idempotencyKey;
  }

  try {
    const res = await fetcher('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg =
        data.message ||
        data.cause?.[0]?.description ||
        'Falha ao gerar cobrança PIX no Mercado Pago.';
      return { success: false, error: errMsg };
    }

    const txData = data.point_of_interaction?.transaction_data;
    return {
      success: true,
      paymentId: String(data.id),
      status: data.status,
      statusDetail: data.status_detail,
      qrCode: txData?.qr_code,
      qrCodeBase64: txData?.qr_code_base64,
      ticketUrl: txData?.ticket_url,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao comunicar com a API do Mercado Pago.';
    return { success: false, error: msg };
  }
}

/**
 * Cria Preferência de Pagamento para o Checkout Pro Mercado Pago (Cartão até 12x, PIX, etc.)
 */
export async function createMercadoPagoPreference(params: {
  orderNumber: string;
  items: Array<{
    title: string;
    unitPriceCents: number;
    quantity: number;
  }>;
  shippingCents: number;
  discountCents?: number;
  customerName: string;
  customerEmail: string;
  customerCpf: string;
  maxInstallments?: number;
  notificationUrl?: string;
  appBaseUrl?: string;
  customFetch?: typeof fetch;
}): Promise<MercadoPagoPreferenceResult> {
  const token = getMercadoPagoAccessToken();
  if (!token) {
    return {
      success: false,
      error: 'MERCADOPAGO_NAO_CONFIGURADO: Access Token ausente no ambiente.',
    };
  }

  const fetcher = params.customFetch ?? fetch;
  const baseUrl = params.appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3006';

  const cleanCpf = params.customerCpf.replace(/\D/g, '');
  const nameParts = params.customerName.trim().split(' ');
  const firstName = nameParts[0] || 'Cliente';
  const lastName = nameParts.slice(1).join(' ') || 'Stillus';

  const mpItems = params.items.map((i) => ({
    title: i.title,
    unit_price: Number((i.unitPriceCents / 100).toFixed(2)),
    quantity: i.quantity,
    currency_id: 'BRL',
  }));

  // Se houver desconto (ex. desconto PIX se preferência for usada), inclui como item dedutivo ou calcula no unit_price
  if (params.discountCents && params.discountCents > 0) {
    mpItems.push({
      title: 'Desconto Comercial Aplicado',
      unit_price: -Number((params.discountCents / 100).toFixed(2)),
      quantity: 1,
      currency_id: 'BRL',
    });
  }

  const payload: Record<string, unknown> = {
    items: mpItems,
    payer: {
      name: firstName,
      surname: lastName,
      email: params.customerEmail,
      identification: {
        type: 'CPF',
        number: cleanCpf,
      },
    },
    payment_methods: {
      installments: params.maxInstallments || 12,
    },
    shipments: {
      cost: Number(((params.shippingCents || 0) / 100).toFixed(2)),
      mode: 'not_specified',
    },
    external_reference: params.orderNumber,
    back_urls: {
      success: `${baseUrl}/pedido/${params.orderNumber}`,
      pending: `${baseUrl}/pedido/${params.orderNumber}`,
      failure: `${baseUrl}/pedido/${params.orderNumber}`,
    },
    auto_return: 'approved',
  };

  if (params.notificationUrl) {
    payload.notification_url = params.notificationUrl;
  }

  try {
    const res = await fetcher('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg =
        data.message ||
        data.cause?.[0]?.description ||
        'Falha ao gerar preferência no Mercado Pago.';
      return { success: false, error: errMsg };
    }

    return {
      success: true,
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao comunicar com o Mercado Pago.';
    return { success: false, error: msg };
  }
}

/**
 * Consulta o status oficial de um pagamento na API do Mercado Pago (GET /v1/payments/{id}).
 */
export async function fetchMercadoPagoPayment(
  paymentId: string | number,
  customFetch?: typeof fetch
): Promise<{
  success: boolean;
  payment?: {
    id: number;
    status: string;
    statusDetail: string;
    transactionAmount: number;
    paidAmountCents: number;
    externalReference: string;
    paymentMethodId: string;
    dateApproved: string | null;
  };
  error?: string;
}> {
  const token = getMercadoPagoAccessToken();
  if (!token) {
    return { success: false, error: 'MERCADOPAGO_NAO_CONFIGURADO' };
  }

  const fetcher = customFetch ?? fetch;
  try {
    const res = await fetcher(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.message || 'Pagamento não encontrado no Mercado Pago.' };
    }

    return {
      success: true,
      payment: {
        id: data.id,
        status: data.status,
        statusDetail: data.status_detail,
        transactionAmount: data.transaction_amount,
        paidAmountCents: Math.round(data.transaction_amount * 100),
        externalReference: data.external_reference || '',
        paymentMethodId: data.payment_method_id,
        dateApproved: data.date_approved || null,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao consultar pagamento.';
    return { success: false, error: msg };
  }
}
