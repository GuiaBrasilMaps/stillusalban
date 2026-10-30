export interface IntegrationDiagnostics {
  melhorEnvio: {
    originCepConfigured: boolean;
    originCep: string;
    tokenConfigured: boolean;
    status: 'PRONTO_PARA_COTACAO' | 'PENDENTE_TOKEN';
  };
  infinitePay: {
    handleConfigured: boolean;
    webhookSecretConfigured: boolean;
    status: 'PRONTO' | 'PENDENTE_INFINITETAG';
  };
  mercadoPago: {
    publicKeyConfigured: boolean;
    accessTokenConfigured: boolean;
    isSandbox: boolean;
    status: 'PRONTO_PRODUCAO' | 'PRONTO_TESTE' | 'PENDENTE_CREDENCIAIS';
  };
  whatsapp: {
    numberConfigured: boolean;
    status: 'PRONTO' | 'PENDENTE_NUMERO';
  };
}

export function getIntegrationDiagnostics(settings?: {
  originCep?: string;
  whatsappNumber?: string;
}): IntegrationDiagnostics {
  const originCep = (settings?.originCep || process.env.STORE_ORIGIN_CEP || '29260-000').trim();
  const melhorEnvioToken = (process.env.MELHOR_ENVIO_TOKEN || '').trim();
  const infinitePayHandle = (process.env.INFINITEPAY_HANDLE || '').trim();
  const infinitePayWebhookSecret = (process.env.INFINITEPAY_WEBHOOK_SECRET || '').trim();
  const mpPublicKey = (process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY || '').trim();
  const mpAccessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  const isMpSandbox = mpAccessToken.startsWith('TEST-');
  const mpStatus =
    mpPublicKey.length > 10 && mpAccessToken.length > 15
      ? isMpSandbox
        ? 'PRONTO_TESTE'
        : 'PRONTO_PRODUCAO'
      : 'PENDENTE_CREDENCIAIS';
  const whatsappNumber = (settings?.whatsappNumber || process.env.STORE_WHATSAPP_NUMBER || '').trim();

  return {
    melhorEnvio: {
      originCepConfigured: /^\d{5}-?\d{3}$/.test(originCep),
      originCep,
      tokenConfigured: melhorEnvioToken.length > 10,
      status: melhorEnvioToken.length > 10 ? 'PRONTO_PARA_COTACAO' : 'PENDENTE_TOKEN',
    },
    infinitePay: {
      handleConfigured: infinitePayHandle.length > 0,
      webhookSecretConfigured: infinitePayWebhookSecret.length > 0,
      status: infinitePayHandle.length > 0 ? 'PRONTO' : 'PENDENTE_INFINITETAG',
    },
    mercadoPago: {
      publicKeyConfigured: mpPublicKey.length > 10,
      accessTokenConfigured: mpAccessToken.length > 15,
      isSandbox: isMpSandbox,
      status: mpStatus,
    },
    whatsapp: {
      numberConfigured: whatsappNumber.replace(/\D/g, '').length >= 10,
      status: whatsappNumber.replace(/\D/g, '').length >= 10 ? 'PRONTO' : 'PENDENTE_NUMERO',
    },
  };
}
