import { NextRequest, NextResponse } from 'next/server';
import { requireServerAdminRole } from '@/lib/admin-session';
import { calculateSalePriceFromMarkup } from '@/lib/purchasing-strategy';
import { formatCurrencyBRL } from '@/lib/storefront';

export interface AiCatalogSuggestion {
  providerMode: 'OPENAI_VISION' | 'LOCAL_SMART_COPYWRITER';
  categorySlug: 'bolsas' | 'calcados' | 'acessorios';
  suggestedName: string;
  slug: string;
  shortDescription: string;
  fullDescription: string;
  material: string;
  careInstructions: string;
  detectedColorName: string;
  detectedColorHex: string;
  suggestedSizes: string[];
  supplyMode: 'IN_STOCK' | 'MADE_TO_ORDER_CONFIRMED_LEAD';
  prepDays: number;
  initialStockOnHand: number;
  costPriceCents: number;
  suggestedSalePriceCents: number;
  socialCaption: string;
}

const COLOR_MAP: Array<{ keywords: string[]; name: string; hex: string }> = [
  { keywords: ['dourad', 'ouro', 'gold', 'champagne', 'aurum'], name: 'Dourado Champagne', hex: '#D4AF37' },
  { keywords: ['pret', 'black', 'onix', 'nocturne'], name: 'Preto Ônix', hex: '#18181B' },
  { keywords: ['nude', 'rose', 'rosé', 'bege', 'areia'], name: 'Nude Rosé', hex: '#C89D88' },
  { keywords: ['caramelo', 'marrom', 'cafe', 'camel', 'toscano'], name: 'Caramelo Toscano', hex: '#8B5A2B' },
  { keywords: ['vinho', 'borgonha', 'marsala', 'vermelh', 'rubi'], name: 'Vinho Borgonha', hex: '#5C1A24' },
  { keywords: ['branc', 'off-white', 'perola', 'pérola', 'marfim'], name: 'Off-White Pérola', hex: '#F5F5F0' },
  { keywords: ['prata', 'silver', 'metalizad'], name: 'Prata Espelhado', hex: '#C0C0C0' },
];

function slugifyText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildLocalSmartCatalogSuggestion(params: {
  rawNotes: string;
  markupPercent: number;
  pixDiscountPercent?: number;
}): AiCatalogSuggestion {
  const raw = params.rawNotes.trim();
  const lower = raw.toLowerCase();
  const markupPercent = Number(params.markupPercent || 120);
  const pixDiscountPercent = Number(params.pixDiscountPercent ?? 10);

  // 1. Detecta Categoria
  let categorySlug: 'bolsas' | 'calcados' | 'acessorios' = 'bolsas';
  if (
    lower.includes('sandal') ||
    lower.includes('sandál') ||
    lower.includes('scarpin') ||
    lower.includes('sapato') ||
    lower.includes('bota') ||
    lower.includes('tam 3') ||
    lower.includes('35') ||
    lower.includes('36') ||
    lower.includes('37') ||
    lower.includes('38')
  ) {
    categorySlug = 'calcados';
  } else if (
    lower.includes('carteira') ||
    lower.includes('cinto') ||
    lower.includes('porta-cart') ||
    lower.includes('acessor')
  ) {
    categorySlug = 'acessorios';
  }

  // 2. Detecta Cor e Hex
  let detectedColorName = 'Preto Ônix';
  let detectedColorHex = '#18181B';
  for (const c of COLOR_MAP) {
    if (c.keywords.some((kw) => lower.includes(kw))) {
      detectedColorName = c.name;
      detectedColorHex = c.hex;
      break;
    }
  }

  // 3. Detecta Custo e/ou Preço de Venda nas anotações
  let costPriceCents = 0;
  let explicitSaleCents = 0;

  const costMatch = raw.match(/custo\s*(?:de)?\s*(?:r\$)?\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (costMatch) {
    costPriceCents = Math.round(Number(costMatch[1].replace(',', '.')) * 100);
  }

  const saleMatch = raw.match(/venda\s*(?:de|por)?\s*(?:r\$)?\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (saleMatch) {
    explicitSaleCents = Math.round(Number(saleMatch[1].replace(',', '.')) * 100);
  }

  if (!costPriceCents && !explicitSaleCents) {
    const anyMoneyMatch = raw.match(/r\$\s*(\d+(?:[.,]\d{1,2})?)/i);
    if (anyMoneyMatch) {
      costPriceCents = Math.round(Number(anyMoneyMatch[1].replace(',', '.')) * 100);
    } else {
      costPriceCents = categorySlug === 'bolsas' ? 16500 : categorySlug === 'calcados' ? 13500 : 8500;
    }
  }

  const suggestedSalePriceCents =
    explicitSaleCents > 0
      ? explicitSaleCents
      : calculateSalePriceFromMarkup(costPriceCents, markupPercent);

  // 4. Detecta Numerações / Tamanhos
  const suggestedSizes: string[] = [];
  if (lower.includes('35 ao 39') || lower.includes('35 a 39')) {
    suggestedSizes.push('35', '36', '37', '38', '39');
  } else if (lower.includes('35 ao 38') || lower.includes('35 a 38')) {
    suggestedSizes.push('35', '36', '37', '38');
  } else {
    for (const sz of ['34', '35', '36', '37', '38', '39', '40']) {
      if (new RegExp(`\\b${sz}\\b`).test(lower)) {
        suggestedSizes.push(sz);
      }
    }
  }

  if (suggestedSizes.length === 0) {
    if (categorySlug === 'calcados') {
      suggestedSizes.push('35', '36', '37', '38');
    } else if (categorySlug === 'bolsas') {
      if (lower.includes('pequen') || lower.includes('clutch') || lower.includes('tiracolo')) {
        suggestedSizes.push('Único');
      } else {
        suggestedSizes.push('M', 'G');
      }
    } else {
      suggestedSizes.push('Único');
    }
  }

  // 5. Detecta Disponibilidade (Pronta Entrega vs Encomenda)
  const isMadeToOrder = lower.includes('encomenda');
  const prepMatch = raw.match(/(\d+)\s*dias?/i);
  const prepDays = isMadeToOrder ? (prepMatch ? Number(prepMatch[1]) : 5) : 0;

  // 6. Cria Nome Editorial e Copy Persuasiva de Boutique
  let baseModelType = 'Bolsa Estruturada';
  if (lower.includes('sandal') || lower.includes('sandál')) baseModelType = 'Sandália Salto Bloco';
  else if (lower.includes('scarpin')) baseModelType = 'Scarpin Slingback';
  else if (lower.includes('clutch')) baseModelType = 'Clutch Tiracolo';
  else if (lower.includes('tote')) baseModelType = 'Bolsa Tote Matelassê';
  else if (lower.includes('tiracolo')) baseModelType = 'Bolsa Tiracolo';
  else if (lower.includes('carteira')) baseModelType = 'Carteira Monogram';

  const luxuryLineNames = ['Aurum', 'Imperial', 'Nocturne', 'Royal', 'Sovereign', 'Lumière'];
  const pickedLuxuryLine =
    luxuryLineNames[Math.abs(raw.length + costPriceCents) % luxuryLineNames.length];

  const suggestedName = `${baseModelType} Stillus ${pickedLuxuryLine} — ${detectedColorName.split(' ')[0]}`;
  const slug = `${slugifyText(suggestedName)}-${Math.floor(100 + Math.random() * 899)}`;

  const material =
    lower.includes('couro')
      ? 'Couro legítimo selecionado e ferragens com banho dourado de alta resistência'
      : categorySlug === 'calcados'
      ? 'Acabamento premium de alta maciez, palmilha confort acolchoada e solado estável'
      : 'Acabamento estruturado de alto padrão com forro acetinado e metais em banho ouro';

  const shortDescription = `${baseModelType} na tonalidade ${detectedColorName} com design autoral, acabamento impecável e presença marcante para composições elegantes.`;

  const fullDescription = `A ${suggestedName} foi selecionada pela curadoria STILLUS ALBAN para mulheres que valorizam sofisticação atemporal e conforto absoluto. Seu acabamento em ${detectedColorName.toLowerCase()} harmoniza perfeitamente com produções diurnas ou noturnas em Domingos Martins e região. Conta com estrutura durável, toque macio e detalhes refinados que elevam qualquer look.`;

  const careInstructions =
    'Limpar delicadamente com pano macio e seco. Guardar na embalagem protetora ao abrigo de luz solar direta e umidade.';

  const pixPriceCents = Math.round(suggestedSalePriceCents * (1 - pixDiscountPercent / 100));
  const socialCaption = `✨ NOVIDADE NO SHOWROOM | ${suggestedName} ✨\n\n${shortDescription}\n\n🔸 Cor: ${detectedColorName}\n🔸 Numeração disponível: ${suggestedSizes.join(', ')}\n🔸 ${
    isMadeToOrder ? `Sob encomenda (${prepDays} dias úteis)` : 'Pronta entrega em estoque próprio!'
  }\n\n💎 Por ${formatCurrencyBRL(suggestedSalePriceCents)} em até 12x ou *${formatCurrencyBRL(
    pixPriceCents
  )} no PIX (${pixDiscountPercent}% OFF)*!\n\n📲 Garanta a sua pelo nosso Catálogo Online ou chame no WhatsApp da bio!`;

  return {
    providerMode: 'LOCAL_SMART_COPYWRITER',
    categorySlug,
    suggestedName,
    slug,
    shortDescription,
    fullDescription,
    material,
    careInstructions,
    detectedColorName,
    detectedColorHex,
    suggestedSizes,
    supplyMode: isMadeToOrder ? 'MADE_TO_ORDER_CONFIRMED_LEAD' : 'IN_STOCK',
    prepDays,
    initialStockOnHand: isMadeToOrder ? 0 : 3,
    costPriceCents,
    suggestedSalePriceCents,
    socialCaption,
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);
    const body = await req.json();

    const rawNotes = String(body.rawNotes || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();
    const markupPercent = Number(body.markupPercent ?? 120);

    if (!rawNotes && !imageUrl) {
      return NextResponse.json(
        { error: 'Informe ao menos um resumo do modelo ou envie uma foto para análise.' },
        { status: 400 }
      );
    }

    const fallbackSuggestion = buildLocalSmartCatalogSuggestion({
      rawNotes: rawNotes || 'Bolsa de luxo preta pronta entrega',
      markupPercent,
    });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({
        suggestion: fallbackSuggestion,
        notice: '',
      });
    }

    try {
      const promptText = `Você é o Diretor Criativo e Copywriter de Moda de Luxo da boutique STILLUS ALBAN (Bolsas, Calçados e Acessórios em Domingos Martins - ES).
Analise os dados brutos enviados pelo administrador: "${rawNotes}".
Markup padrão configurado da loja: ${markupPercent}%.
Gere um JSON estrito com os campos:
- categorySlug ("bolsas" | "calcados" | "acessorios")
- suggestedName (nome sofisticado e persuasivo em português)
- shortDescription (1 frase persuasiva de até 160 caracteres destacando acabamento e desejo)
- fullDescription (parágrafo completo detalhando design, conforto, ocasião de uso e exclusividade)
- material (descrição técnica elegante do material e ferragens)
- careInstructions (cuidados de conservação)
- detectedColorName (nome comercial sofisticado da cor em português, ex: "Preto Ônix", "Dourado Champagne", "Nude Rosé")
- detectedColorHex (código hexadecimal #RRGGBB correspondente à cor)
- suggestedSizes (array de strings com os tamanhos citados ou recomendados, ex: ["35","36","37","38"] ou ["M","G"] ou ["Único"])
- costPriceCents (valor de custo em centavos extraído do texto, ou ${fallbackSuggestion.costPriceCents} se não informado)
- socialCaption (legenda pronta e persuasiva com emojis elegantes para Instagram e Status do WhatsApp da loja)`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Responda exclusivamente com um objeto JSON válido contendo os campos solicitados em português do Brasil.',
            },
            {
              role: 'user',
              content: promptText,
            },
          ],
          temperature: 0.6,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          const parsedAi = JSON.parse(content);
          const aiCostCents =
            typeof parsedAi.costPriceCents === 'number' && parsedAi.costPriceCents > 0
              ? parsedAi.costPriceCents
              : fallbackSuggestion.costPriceCents;
          const aiSaleCents = calculateSalePriceFromMarkup(aiCostCents, markupPercent);

          const merged: AiCatalogSuggestion = {
            ...fallbackSuggestion,
            providerMode: 'OPENAI_VISION',
            categorySlug:
              parsedAi.categorySlug === 'calcados' ||
              parsedAi.categorySlug === 'acessorios' ||
              parsedAi.categorySlug === 'bolsas'
                ? parsedAi.categorySlug
                : fallbackSuggestion.categorySlug,
            suggestedName: parsedAi.suggestedName || fallbackSuggestion.suggestedName,
            slug: `${slugifyText(parsedAi.suggestedName || fallbackSuggestion.suggestedName)}-${Math.floor(
              100 + Math.random() * 899
            )}`,
            shortDescription: parsedAi.shortDescription || fallbackSuggestion.shortDescription,
            fullDescription: parsedAi.fullDescription || fallbackSuggestion.fullDescription,
            material: parsedAi.material || fallbackSuggestion.material,
            careInstructions: parsedAi.careInstructions || fallbackSuggestion.careInstructions,
            detectedColorName: parsedAi.detectedColorName || fallbackSuggestion.detectedColorName,
            detectedColorHex:
              typeof parsedAi.detectedColorHex === 'string' &&
              /^#[0-9A-Fa-f]{6}$/.test(parsedAi.detectedColorHex)
                ? parsedAi.detectedColorHex
                : fallbackSuggestion.detectedColorHex,
            suggestedSizes:
              Array.isArray(parsedAi.suggestedSizes) && parsedAi.suggestedSizes.length > 0
                ? parsedAi.suggestedSizes.map(String)
                : fallbackSuggestion.suggestedSizes,
            costPriceCents: aiCostCents,
            suggestedSalePriceCents: aiSaleCents,
            socialCaption: parsedAi.socialCaption || fallbackSuggestion.socialCaption,
          };

          return NextResponse.json({
            suggestion: merged,
            notice: 'Cadastro estruturado gerado via OpenAI (gpt-4o-mini).',
          });
        }
      }
    } catch {
      // Fallback silencioso e resiliente para o motor local caso a chave OpenAI falhe ou esteja sem rede
    }

    return NextResponse.json({
      suggestion: fallbackSuggestion,
      notice: 'Ficha gerada pelo Assistente Inteligente STILLUS ALBAN.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar sugestão com IA.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
