import { NearbyMunicipality, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from './prisma';

export function normalizeCep(rawCep: string): string {
  return (rawCep || '').replace(/\D/g, '');
}

export function isValidCepFormat(rawCep: string): boolean {
  const digits = normalizeCep(rawCep);
  return /^\d{8}$/.test(digits);
}

export interface ShippingPackageItem {
  id: string;
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  quantity: number;
  insuranceValueReais: number;
}

export interface ShippingQuoteOption {
  id: string;
  shippingMode: 'MELHOR_ENVIO' | 'MUNICIPIO_PROXIMO_A_COMBINAR';
  carrierName: string;
  serviceName: string;
  shippingCostCents: number;
  isCostToBeArranged: boolean;
  carrierDeliveryDays: number | null;
  prepDaysIncluded: number;
  hasTbdPrepDays: boolean;
  totalEstimatedBusinessDays: number | null;
  scheduleDescription: string;
}

export interface ShippingQuoteResult {
  originCep: string;
  destinationCep: string;
  matchedNearbyMunicipality: NearbyMunicipality | null;
  melhorEnvioStatus: 'COTADO_API' | 'PENDENTE_TOKEN' | 'ERRO_API';
  melhorEnvioMessage: string | null;
  singleShipmentRuleApplied: boolean;
  maxPrepDays: number;
  hasTbdPrepDays: boolean;
  options: ShippingQuoteOption[];
}

/**
 * Verifica se o CEP informado pertence a algum município próximo ativo na tabela editável NearbyMunicipality.
 */
export function findMatchingNearbyMunicipality(
  destinationCep: string,
  municipalities: NearbyMunicipality[]
): NearbyMunicipality | null {
  const cleanDest = normalizeCep(destinationCep);
  if (cleanDest.length !== 8) return null;
  const destNum = Number(cleanDest);

  for (const mun of municipalities) {
    if (!mun.isActive || !mun.allowArrangedDelivery) continue;
    const startNum = Number(normalizeCep(mun.cepStart));
    const endNum = Number(normalizeCep(mun.cepEnd));
    if (!Number.isNaN(startNum) && !Number.isNaN(endNum)) {
      if (destNum >= startNum && destNum <= endNum) {
        return mun;
      }
    }
  }
  return null;
}

/**
 * Monta a descrição transparente de prazo respeitando a regra confirmada de REMESSA ÚNICA
 * (aguardando o item sob encomenda ficar pronto antes do envio).
 */
export function formatDeliveryScheduleDescription(params: {
  carrierDeliveryDays: number | null;
  maxPrepDays: number;
  hasTbdPrepDays: boolean;
  isArrangedLocal: boolean;
  localNotes?: string;
}): { totalEstimatedBusinessDays: number | null; scheduleDescription: string } {
  if (params.isArrangedLocal) {
    if (params.hasTbdPrepDays) {
      return {
        totalEstimatedBusinessDays: null,
        scheduleDescription: `${
          params.localNotes || 'Entrega local a combinar.'
        } (Envio único após confirmação e preparação do item sob encomenda).`,
      };
    }
    if (params.maxPrepDays > 0) {
      return {
        totalEstimatedBusinessDays: params.maxPrepDays,
        scheduleDescription: `${
          params.localNotes || 'Entrega local a combinar'
        } • Preparação sob encomenda: ${params.maxPrepDays} dia(s) útil(is) (remessa única).`,
      };
    }
    return {
      totalEstimatedBusinessDays: null,
      scheduleDescription: `${
        params.localNotes || 'Entrega local a combinar com a loja após confirmação do pedido.'
      }`,
    };
  }

  // Modalidade transportadora (Melhor Envio)
  const carrierDays = params.carrierDeliveryDays ?? 0;
  if (params.hasTbdPrepDays) {
    return {
      totalEstimatedBusinessDays: null,
      scheduleDescription: `Transporte estimado em ${carrierDays} dia(s) útil(is) + prazo de preparação sob encomenda a confirmar (remessa única).`,
    };
  }

  const totalDays = params.maxPrepDays + carrierDays;
  if (params.maxPrepDays > 0) {
    return {
      totalEstimatedBusinessDays: totalDays,
      scheduleDescription: `Até ${totalDays} dia(s) útil(is) em remessa única (${params.maxPrepDays}d de preparação sob encomenda + ${carrierDays}d de transporte).`,
    };
  }

  return {
    totalEstimatedBusinessDays: carrierDays,
    scheduleDescription: `Entrega estimada em até ${carrierDays} dia(s) útil(is) após postagem.`,
  };
}

/**
 * Calcula opções de entrega combinando:
 * 1) Regra editável de Município Próximo ("Entrega a Combinar") para Domingos Martins, Marechal Floriano, Venda Nova do Imigrante, etc.
 * 2) Cotação via API Melhor Envio (quando MELHOR_ENVIO_TOKEN estiver configurado no servidor).
 * Nunca inventa tarifas ou prazos fictícios quando o token não estiver configurado.
 */
export async function calculateShippingOptions(
  params: {
    destinationCep: string;
    packages: ShippingPackageItem[];
    maxPrepDays: number;
    hasMadeToOrderItems: boolean;
    hasTbdPrepDays: boolean;
    customFetch?: typeof fetch;
  },
  client: PrismaClient = defaultPrisma
): Promise<ShippingQuoteResult> {
  if (!isValidCepFormat(params.destinationCep)) {
    throw new Error('CEP_INVALIDO: Informe um CEP válido de 8 dígitos.');
  }

  if (params.packages.length === 0) {
    throw new Error('CARRINHO_VAZIO: Adicione ao menos um produto para calcular a entrega.');
  }

  const [settings, activeMunicipalities] = await Promise.all([
    client.storeSettings.findUnique({ where: { id: 'default' } }),
    client.nearbyMunicipality.findMany({
      where: { isActive: true },
      orderBy: { cityName: 'asc' },
    }),
  ]);

  const originCep = normalizeCep(settings?.originCep || process.env.STORE_ORIGIN_CEP || '29260-000');
  const destinationCep = normalizeCep(params.destinationCep);

  const options: ShippingQuoteOption[] = [];

  // 1. Verifica se o CEP pertence a um município próximo habilitado para Entrega a Combinar
  const matchedNearby = findMatchingNearbyMunicipality(destinationCep, activeMunicipalities);
  if (matchedNearby) {
    const schedule = formatDeliveryScheduleDescription({
      carrierDeliveryDays: null,
      maxPrepDays: params.maxPrepDays,
      hasTbdPrepDays: params.hasTbdPrepDays,
      isArrangedLocal: true,
      localNotes: matchedNearby.deliveryNotes,
    });

    options.push({
      id: `local-${matchedNearby.id}`,
      shippingMode: 'MUNICIPIO_PROXIMO_A_COMBINAR',
      carrierName: 'STILLUS ALBAN • Entrega Regional',
      serviceName: `Entrega a Combinar (${matchedNearby.cityName} - ${matchedNearby.stateUf})`,
      shippingCostCents: matchedNearby.fixedFeeCents ?? 0,
      isCostToBeArranged: matchedNearby.fixedFeeCents === null,
      carrierDeliveryDays: null,
      prepDaysIncluded: params.maxPrepDays,
      hasTbdPrepDays: params.hasTbdPrepDays,
      totalEstimatedBusinessDays: schedule.totalEstimatedBusinessDays,
      scheduleDescription: schedule.scheduleDescription,
    });
  }

  // 2. Cotação via API Melhor Envio (somente se MELHOR_ENVIO_TOKEN estiver configurado)
  const token = (process.env.MELHOR_ENVIO_TOKEN || '').trim();
  const apiUrl = (
    process.env.MELHOR_ENVIO_API_URL || 'https://sandbox.melhorenvio.com.br/api/v2'
  ).replace(/\/$/, '');

  let melhorEnvioStatus: ShippingQuoteResult['melhorEnvioStatus'] = 'PENDENTE_TOKEN';
  let melhorEnvioMessage: string | null = null;

  if (token.length <= 10) {
    melhorEnvioStatus = 'PENDENTE_TOKEN';
    melhorEnvioMessage = matchedNearby
      ? 'A cotação automática de transportadoras (Melhor Envio) aguarda configuração do token da loja. A opção de Entrega a Combinar para seu município já está disponível abaixo.'
      : 'A cotação automática via Melhor Envio aguarda configuração do token de API da loja.';
  } else {
    try {
      const fetchFn = params.customFetch ?? fetch;
      const response = await fetchFn(`${apiUrl}/me/shipment/calculate`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': process.env.MELHOR_ENVIO_USER_AGENT || 'StillusAlbanEcommerce/1.0',
        },
        body: JSON.stringify({
          from: { postal_code: originCep },
          to: { postal_code: destinationCep },
          products: params.packages.map((p) => ({
            id: p.id,
            width: p.widthCm,
            height: p.heightCm,
            length: p.lengthCm,
            weight: p.weightKg,
            insurance_value: p.insuranceValueReais,
            quantity: p.quantity,
          })),
        }),
      });

      if (!response.ok) {
        melhorEnvioStatus = 'ERRO_API';
        melhorEnvioMessage = `API do Melhor Envio retornou status HTTP ${response.status}.`;
      } else {
        const rawServices = (await response.json()) as Array<{
          id?: number | string;
          name?: string;
          price?: string | number;
          custom_price?: string | number;
          delivery_time?: number;
          custom_delivery_time?: number;
          error?: string;
          company?: { name?: string };
        }>;

        const validServices = Array.isArray(rawServices)
          ? rawServices.filter((s) => !s.error && (s.custom_price || s.price))
          : [];

        for (const svc of validServices) {
          const priceFloat = Number(svc.custom_price ?? svc.price ?? 0);
          const shippingCostCents = Math.round(priceFloat * 100);
          const carrierDays = Number(svc.custom_delivery_time ?? svc.delivery_time ?? 0);

          const schedule = formatDeliveryScheduleDescription({
            carrierDeliveryDays: carrierDays,
            maxPrepDays: params.maxPrepDays,
            hasTbdPrepDays: params.hasTbdPrepDays,
            isArrangedLocal: false,
          });

          options.push({
            id: `me-${svc.id}`,
            shippingMode: 'MELHOR_ENVIO',
            carrierName: svc.company?.name || 'Transportadora',
            serviceName: svc.name || 'Envio Padrão',
            shippingCostCents,
            isCostToBeArranged: false,
            carrierDeliveryDays: carrierDays,
            prepDaysIncluded: params.maxPrepDays,
            hasTbdPrepDays: params.hasTbdPrepDays,
            totalEstimatedBusinessDays: schedule.totalEstimatedBusinessDays,
            scheduleDescription: schedule.scheduleDescription,
          });
        }

        melhorEnvioStatus = 'COTADO_API';
      }
    } catch (err: unknown) {
      melhorEnvioStatus = 'ERRO_API';
      melhorEnvioMessage =
        err instanceof Error
          ? `Falha ao comunicar com a API do Melhor Envio: ${err.message}`
          : 'Erro de conexão com o Melhor Envio.';
    }
  }

  return {
    originCep,
    destinationCep,
    matchedNearbyMunicipality: matchedNearby,
    melhorEnvioStatus,
    melhorEnvioMessage,
    singleShipmentRuleApplied: params.hasMadeToOrderItems,
    maxPrepDays: params.maxPrepDays,
    hasTbdPrepDays: params.hasTbdPrepDays,
    options,
  };
}

export const UpsertMunicipalitySchema = z.object({
  id: z.string().optional(),
  cityName: z.string().min(2, 'Nome do município é obrigatório.'),
  stateUf: z.string().length(2).default('ES'),
  cepStart: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length === 8, 'CEP inicial deve conter 8 dígitos.'),
  cepEnd: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length === 8, 'CEP final deve conter 8 dígitos.'),
  allowArrangedDelivery: z.boolean().default(true),
  fixedFeeCents: z.number().int().nonnegative().nullable().optional(),
  deliveryNotes: z.string().min(3, 'Informe as condições de entrega para o município.'),
  isActive: z.boolean().default(true),
});
