'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  calculatePixPriceCents,
  formatCurrencyBRL,
  ProductWithRelations,
  resolveProductVariationSelection,
} from '@/lib/storefront';
import { CART_STORAGE_KEY } from './StoreHeader';

export interface InterestItemSnapshot {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  skuCode: string;
  colorName: string;
  modelName: string;
  sizeLabel: string;
  badgeLabel: string;
  unitPriceCents: number;
  pixPriceCents: number;
  imageUrl: string | null;
}

interface ShowroomBoutiqueCatalogProps {
  products: ProductWithRelations[];
  categories: Array<{ id: string; name: string; slug: string; description?: string | null }>;
  pixDiscountPercent: number;
  maxInstallments: number;
  whatsappNumber: string;
  initialCategorySlug?: string;
  initialAvailability?: 'ALL' | 'IN_STOCK' | 'MADE_TO_ORDER';
  initialSearchQuery?: string;
}

function buildSingleModelWhatsAppUrl(params: {
  whatsappNumber: string;
  productName: string;
  skuCode: string;
  colorName: string;
  modelName: string;
  sizeLabel: string;
  badgeLabel: string;
  unitPriceCents: number;
  pixPriceCents: number;
  pixDiscountPercent: number;
}): string {
  const digits = (params.whatsappNumber || '5527996929005').replace(/\D/g, '') || '5527996929005';
  const lines = [
    `Olá, *STILLUS ALBAN*! Vi este modelo no Catálogo Online e tenho interesse:`,
    ``,
    `• *Modelo:* ${params.productName}`,
    `• *Ref/SKU:* ${params.skuCode}`,
    `• *Cor:* ${params.colorName}${params.modelName && params.modelName !== 'Padrão' ? ` (${params.modelName})` : ''}`,
    `• *Tamanho/Numeração:* ${params.sizeLabel}`,
    `• *Disponibilidade:* ${params.badgeLabel}`,
    `• *Valor no Catálogo:* ${formatCurrencyBRL(params.pixPriceCents)} no PIX (${params.pixDiscountPercent}% OFF) ou ${formatCurrencyBRL(params.unitPriceCents)} no cartão`,
    ``,
    `Poderia me atender com mais informações?`,
  ];

  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

function buildInterestListWhatsAppUrl(params: {
  whatsappNumber: string;
  items: InterestItemSnapshot[];
  pixDiscountPercent: number;
}): string {
  const digits = (params.whatsappNumber || '5527996929005').replace(/\D/g, '') || '5527996929005';
  const totalCardCents = params.items.reduce((acc, i) => acc + i.unitPriceCents, 0);
  const totalPixCents = params.items.reduce((acc, i) => acc + i.pixPriceCents, 0);

  const lines = [
    `Olá, *STILLUS ALBAN*! Selecionei ${params.items.length} modelo(s) na minha *Lista de Interesse* do Catálogo Online:`,
    ``,
  ];

  params.items.forEach((item, idx) => {
    lines.push(
      `${idx + 1}. *${item.productName}* | Cor: *${item.colorName}* | Tam: *${item.sizeLabel}* | Ref: ${item.skuCode} [${item.badgeLabel}] — ${formatCurrencyBRL(item.pixPriceCents)} no PIX`
    );
  });

  lines.push(``);
  lines.push(
    `*Total Estimado da Seleção:* ${formatCurrencyBRL(totalPixCents)} no PIX (${params.pixDiscountPercent}% OFF) ou ${formatCurrencyBRL(totalCardCents)} no cartão.`
  );
  lines.push(`Podemos combinar o atendimento e a entrega?`);

  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

export default function ShowroomBoutiqueCatalog({
  products,
  categories,
  pixDiscountPercent,
  maxInstallments,
  whatsappNumber,
  initialCategorySlug = '',
  initialAvailability = 'ALL',
  initialSearchQuery = '',
}: ShowroomBoutiqueCatalogProps) {
  // Filtros Interativos Instantâneos + Ordenação
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategorySlug);
  const [selectedAvailability, setSelectedAvailability] = useState<
    'ALL' | 'IN_STOCK' | 'MADE_TO_ORDER'
  >(initialAvailability);
  const [selectedSizeFilter, setSelectedSizeFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'destaques' | 'menor_preco' | 'maior_preco'>('destaques');
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Estado de seleção de Cor e Tamanho por Card (productId -> { colorName, modelName, sizeLabel })
  const [selectionByProduct, setSelectionByProduct] = useState<
    Record<string, { colorName?: string; modelName?: string; sizeLabel?: string }>
  >({});

  // Lista de Interesse (persiste no localStorage para barra flutuante dourada)
  const [interestList, setInterestList] = useState<InterestItemSnapshot[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Modal Rápido Interativo de Detalhes (Quick-View Luxury Drawer)
  const [quickModalProductId, setQuickModalProductId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setInterestList(parsed);
        }
      }
    } catch {
      setInterestList([]);
    }

    function onOpenDrawer() {
      setDrawerOpen(true);
    }
    window.addEventListener('stillus-open-interest-drawer', onOpenDrawer);
    return () => window.removeEventListener('stillus-open-interest-drawer', onOpenDrawer);
  }, []);

  function saveInterestList(nextList: InterestItemSnapshot[]) {
    setInterestList(nextList);
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextList));
      window.dispatchEvent(new Event('stillus-cart-updated'));
    } catch {
      // ignore storage quota errors
    }
  }

  function handleToggleInterestItem(item: InterestItemSnapshot) {
    const exists = interestList.some((i) => i.variantId === item.variantId);
    if (exists) {
      saveInterestList(interestList.filter((i) => i.variantId !== item.variantId));
    } else {
      saveInterestList([...interestList, item]);
    }
  }

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = products.filter((prod) => {
      if (prod.status !== 'ACTIVE') return false;
      const activeVariants = prod.variants.filter((v) => v.isActive);
      if (activeVariants.length === 0) return false;

      if (
        selectedCategory &&
        prod.category.slug.toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        return false;
      }

      if (selectedAvailability === 'IN_STOCK') {
        const hasStock = activeVariants.some(
          (v) => v.supplyMode === 'IN_STOCK' && v.stockOnHand - v.stockReserved > 0
        );
        if (!hasStock) return false;
      } else if (selectedAvailability === 'MADE_TO_ORDER') {
        const hasMadeToOrder = activeVariants.some(
          (v) =>
            v.supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' ||
            v.supplyMode === 'MADE_TO_ORDER_TBD_LEAD'
        );
        if (!hasMadeToOrder) return false;
      }

      if (selectedSizeFilter) {
        const hasSize = activeVariants.some(
          (v) => v.sizeLabel.trim().toLowerCase() === selectedSizeFilter.trim().toLowerCase()
        );
        if (!hasSize) return false;
      }

      if (q) {
        const haystack = [
          prod.name,
          prod.shortDescription,
          prod.material || '',
          prod.category.name,
          ...activeVariants.map((v) => `${v.skuCode} ${v.colorName} ${v.modelName} ${v.sizeLabel}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    return [...list].sort((a, b) => {
      const priceA = a.promotionalPriceCents ?? a.basePriceCents;
      const priceB = b.promotionalPriceCents ?? b.basePriceCents;
      if (sortBy === 'menor_preco') return priceA - priceB;
      if (sortBy === 'maior_preco') return priceB - priceA;
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;
      return 0;
    });
  }, [products, selectedCategory, selectedAvailability, selectedSizeFilter, searchQuery, sortBy]);

  const allAvailableSizes = useMemo(() => {
    const set = new Set<string>();
    for (const prod of products) {
      if (prod.status !== 'ACTIVE') continue;
      for (const v of prod.variants) {
        if (v.isActive && v.sizeLabel) {
          set.add(v.sizeLabel.trim());
        }
      }
    }
    return Array.from(set);
  }, [products]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const prod of products) {
      if (prod.status !== 'ACTIVE') continue;
      const slug = prod.category.slug.toLowerCase();
      map[slug] = (map[slug] || 0) + 1;
    }
    return map;
  }, [products]);

  function handleShareProduct(product: ProductWithRelations) {
    const url = `${window.location.origin}/produto/${product.slug}`;
    if (navigator.share) {
      navigator
        .share({
          title: `${product.name} | STILLUS ALBAN`,
          text: product.shortDescription,
          url,
        })
        .catch(() => {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
      setCopiedSlug(product.slug);
      setTimeout(() => setCopiedSlug(null), 2500);
    }
  }

  const quickModalProduct = useMemo(
    () => products.find((p) => p.id === quickModalProductId) || null,
    [products, quickModalProductId]
  );

  return (
    <div className="space-y-8 pb-32">
      {/* Hero Editorial Luxury Noir */}
      <section className="relative overflow-hidden rounded-3xl border border-[#D4AF37]/35 bg-gradient-to-br from-[#191610] via-[#0F0F0F] to-[#080808] px-6 py-8 sm:px-10 sm:py-10 shadow-[0_20px_50px_rgba(0,0,0,0.75)] flex flex-col lg:flex-row lg:items-center justify-between gap-8">
        <div className="space-y-3 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37] text-[11px] uppercase tracking-[0.22em] font-semibold">
            <span>✦ Coleção Exclusiva • Domingos Martins - ES</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-serif text-[#F5F5F4] leading-[1.15] tracking-tight">
            Coleção <span className="text-[#D4AF37]">STILLUS ALBAN</span>
          </h1>
          <p className="text-sm sm:text-base text-[#A8A29E] leading-relaxed">
            Bolsas clássicas, calçados elegantes e acessórios selecionados para valorizar o seu estilo em pronta entrega e sob encomenda.
          </p>
        </div>

        {/* Selos de Confiança e Condições Comerciais */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3 gap-3 shrink-0">
          <div className="rounded-2xl border border-[#10B981]/30 bg-[#0A0A0A]/90 px-4 py-3.5 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#A8A29E] block">
              Pagamento à Vista
            </span>
            <strong className="text-base text-[#10B981] font-bold block tabular-nums">
              {pixDiscountPercent}% OFF no PIX
            </strong>
            <span className="text-[11px] text-[#A8A29E] block">Desconto imediato</span>
          </div>

          <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#0A0A0A]/90 px-4 py-3.5 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#A8A29E] block">
              No Cartão
            </span>
            <strong className="text-base text-[#D4AF37] font-bold block tabular-nums">
              Até {maxInstallments}x
            </strong>
            <span className="text-[11px] text-[#A8A29E] block">Parcelamento facilitado</span>
          </div>

          <div className="col-span-2 sm:col-span-1 rounded-2xl border border-[#262626] bg-[#0A0A0A]/90 px-4 py-3.5 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#A8A29E] block">
              Logística Regional
            </span>
            <strong className="text-sm text-[#F5F5F4] font-semibold block">
              Entrega a Combinar
            </strong>
            <span className="text-[11px] text-[#C5A059] block">
              Domingos Martins, Marechal e Venda Nova
            </span>
          </div>
        </div>
      </section>

      {/* Barra Sticky de Filtros Inteligentes, Numeração Rápida e Ordenação */}
      <section
        aria-label="Filtros rápidos do catálogo"
        className="sticky top-[102px] z-30 rounded-2xl border border-[#D4AF37]/30 bg-[#121212]/95 backdrop-blur-xl p-4 shadow-[0_12px_32px_rgba(0,0,0,0.75)] space-y-3.5"
      >
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Pílulas de Categoria com Contadores + Disponibilidade */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 xl:pb-0">
            <button
              type="button"
              onClick={() => setSelectedCategory('')}
              className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                selectedCategory === ''
                  ? 'bg-[#D4AF37] text-[#0A0A0A] shadow-md font-bold'
                  : 'border border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] hover:border-[#D4AF37]'
              }`}
            >
              Todos os Produtos ({products.length})
            </button>

            {categories.map((cat) => {
              const isSelected = selectedCategory.toLowerCase() === cat.slug.toLowerCase();
              const count = categoryCounts[cat.slug.toLowerCase()] || 0;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(isSelected ? '' : cat.slug)}
                  className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                    isSelected
                      ? 'bg-[#D4AF37] text-[#0A0A0A] shadow-md font-bold'
                      : 'border border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] hover:border-[#D4AF37]'
                  }`}
                >
                  {cat.name} ({count})
                </button>
              );
            })}

            <span className="h-5 w-[1px] bg-[#262626] mx-1 hidden sm:inline-block" />

            <button
              type="button"
              onClick={() =>
                setSelectedAvailability(selectedAvailability === 'IN_STOCK' ? 'ALL' : 'IN_STOCK')
              }
              className={`min-h-[40px] px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                selectedAvailability === 'IN_STOCK'
                  ? 'bg-[#10B981] text-[#0A0A0A] font-bold shadow'
                  : 'border border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20'
              }`}
            >
              ● Pronta Entrega
            </button>

            <button
              type="button"
              onClick={() =>
                setSelectedAvailability(
                  selectedAvailability === 'MADE_TO_ORDER' ? 'ALL' : 'MADE_TO_ORDER'
                )
              }
              className={`min-h-[40px] px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                selectedAvailability === 'MADE_TO_ORDER'
                  ? 'bg-[#D4AF37] text-[#0A0A0A] font-bold shadow'
                  : 'border border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37] hover:bg-[#D4AF37]/20'
              }`}
            >
              ◆ Sob Encomenda
            </button>
          </div>

          {/* Busca Instantânea + Seletor de Ordenação */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar modelo, cor, tamanho..."
                aria-label="Buscar modelo no catálogo"
                className="w-full min-h-[40px] rounded-full border border-[#262626] bg-[#0A0A0A] px-4 py-2 text-xs text-[#F5F5F4] placeholder:text-[#A8A29E] focus:border-[#D4AF37] outline-none"
              />
            </div>

            <select
              aria-label="Ordenar modelos do catálogo"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="min-h-[40px] rounded-full border border-[#262626] bg-[#0A0A0A] px-4 py-2 text-xs text-[#F5F5F4] focus:border-[#D4AF37] outline-none cursor-pointer"
            >
              <option value="destaques">Ordenar: Destaques da Coleção</option>
              <option value="menor_preco">Menor Valor Primeiro</option>
              <option value="maior_preco">Maior Valor Primeiro</option>
            </select>
          </div>
        </div>

        {/* Barra Rápida "Qual a sua numeração?" */}
        {allAvailableSizes.length > 0 && (
          <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-[#262626]/80 overflow-x-auto">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#C5A059] font-semibold uppercase tracking-wider whitespace-nowrap">
                Qual a sua numeração / tamanho?
              </span>
              <button
                type="button"
                onClick={() => setSelectedSizeFilter('')}
                className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  selectedSizeFilter === ''
                    ? 'bg-[#D4AF37]/20 border border-[#D4AF37] text-[#D4AF37]'
                    : 'border border-[#262626] bg-[#0A0A0A] text-[#A8A29E] hover:border-[#D4AF37]'
                }`}
              >
                Todos
              </button>
              {allAvailableSizes.map((sz) => {
                const active = selectedSizeFilter.toLowerCase() === sz.toLowerCase();
                return (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setSelectedSizeFilter(active ? '' : sz)}
                    className={`min-w-[36px] min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      active
                        ? 'bg-[#D4AF37] text-[#0A0A0A] shadow'
                        : 'border border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] hover:border-[#D4AF37]'
                    }`}
                  >
                    {sz}
                  </button>
                );
              })}
            </div>

            <span className="text-[11px] text-[#A8A29E] whitespace-nowrap hidden md:inline">
              Exibindo <strong className="text-[#D4AF37]">{filteredProducts.length}</strong>{' '}
              {filteredProducts.length === 1 ? 'produto' : 'produtos'}
            </span>
          </div>
        )}
      </section>

      {/* Grade de Produtos */}
      {filteredProducts.length === 0 ? (
        <section className="rounded-3xl border border-[#262626] bg-[#141414] p-12 text-center space-y-4">
          <h2 className="text-2xl font-serif text-[#D4AF37]">
            {products.length === 0
              ? 'Nova Coleção em Preparação'
              : 'Nenhum produto encontrado para esta combinação de filtros'}
          </h2>
          <p className="text-xs sm:text-sm text-[#A8A29E] max-w-lg mx-auto">
            {products.length === 0
              ? 'Nossa equipe está preparando novos lançamentos. Solicite atendimento direto pelo nosso WhatsApp Oficial.'
              : 'Limpe os filtros selecionados para visualizar toda a coleção disponível.'}
          </p>
          {products.length === 0 ? (
            <a
              href={`https://wa.me/${(whatsappNumber || '5527996929005').replace(/\D/g, '') || '5527996929005'}?text=${encodeURIComponent(
                'Olá, STILLUS ALBAN! Gostaria de receber informações sobre os produtos disponíveis.'
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] inline-flex items-center px-6 py-2.5 rounded-full bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] text-xs sm:text-sm font-bold transition"
            >
              Atendimento pelo WhatsApp
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('');
                setSelectedAvailability('ALL');
                setSelectedSizeFilter('');
                setSearchQuery('');
              }}
              className="min-h-[44px] inline-flex items-center px-6 py-2.5 rounded-full bg-[#D4AF37] text-[#0A0A0A] text-xs font-bold cursor-pointer"
            >
              Limpar Filtros e Mostrar Todos ({products.length})
            </button>
          )}
        </section>
      ) : (
        <section
          aria-label="Produtos da loja"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7"
        >
          {filteredProducts.map((product) => {
            const currentSel = selectionByProduct[product.id] || {};
            const resolved = resolveProductVariationSelection({
              product,
              variants: product.variants,
              images: product.images,
              selectedColorName: currentSel.colorName,
              selectedModelName: currentSel.modelName,
              selectedSizeLabel: currentSel.sizeLabel,
              pixDiscountPercent,
            });

            const unitPriceCents =
              resolved.commercialState?.unitPriceCents ??
              product.promotionalPriceCents ??
              product.basePriceCents;
            const pixPriceCents =
              resolved.pixPriceCents ?? calculatePixPriceCents(unitPriceCents, pixDiscountPercent);
            const pixSavingsCents = Math.max(0, unitPriceCents - pixPriceCents);
            const installmentValueCents = Math.ceil(unitPriceCents / maxInstallments);

            const primaryImg = resolved.galleryResolution.primaryImage;
            const badgeLabel = resolved.commercialState?.badgeLabel || 'Sob Consulta';
            const isInStock =
              resolved.selectedVariant?.supplyMode === 'IN_STOCK' &&
              resolved.commercialState?.canPurchase;

            const variantId = resolved.selectedVariant?.id || `${product.id}-default`;
            const skuCode = resolved.selectedVariant?.skuCode || product.slug.toUpperCase();
            const isAddedToList = interestList.some((i) => i.variantId === variantId);

            const singleWaUrl = buildSingleModelWhatsAppUrl({
              whatsappNumber,
              productName: product.name,
              skuCode,
              colorName: resolved.selectedColorName || 'Padrão',
              modelName: resolved.selectedModelName || 'Padrão',
              sizeLabel: resolved.selectedSizeLabel || 'Único',
              badgeLabel,
              unitPriceCents,
              pixPriceCents,
              pixDiscountPercent,
            });

            const snapshotForList: InterestItemSnapshot = {
              variantId,
              productId: product.id,
              productSlug: product.slug,
              productName: product.name,
              skuCode,
              colorName: resolved.selectedColorName || 'Padrão',
              modelName: resolved.selectedModelName || 'Padrão',
              sizeLabel: resolved.selectedSizeLabel || 'Único',
              badgeLabel,
              unitPriceCents,
              pixPriceCents,
              imageUrl: primaryImg?.url || null,
            };

            return (
              <article
                key={product.id}
                className="group rounded-3xl border border-[#262626] hover:border-[#D4AF37]/80 bg-gradient-to-b from-[#151515] to-[#0D0D0D] transition-all duration-300 flex flex-col overflow-hidden shadow-[0_12px_35px_rgba(0,0,0,0.65)] hover:shadow-[0_16px_45px_rgba(212,175,55,0.14)]"
              >
                {/* Área Visual da Foto Sincronizada por Cor */}
                <div
                  onClick={() => setQuickModalProductId(product.id)}
                  className="relative aspect-square w-full bg-[#0A0A0A] border-b border-[#262626] overflow-hidden cursor-pointer"
                >
                  {primaryImg ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={primaryImg.url}
                      alt={primaryImg.altText || `${product.name} - ${resolved.selectedColorName}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-[#C5A059]">
                        {product.category.name} • Cor {resolved.selectedColorName}
                      </span>
                      <p className="text-xs text-[#A8A29E] max-w-xs">
                        {resolved.galleryResolution.missingImageNotice ||
                          'Imagem específica desta cor em atualização.'}
                      </p>
                    </div>
                  )}

                  {/* Selo de Disponibilidade e Ações Rápidas na Foto */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-3.5 left-3.5 right-3.5 flex items-center justify-between gap-2"
                  >
                    <span
                      className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-wide border backdrop-blur-md shadow ${
                        isInStock
                          ? 'border-[#10B981]/60 bg-[#0A0A0A]/90 text-[#10B981]'
                          : 'border-[#D4AF37]/60 bg-[#0A0A0A]/90 text-[#D4AF37]'
                      }`}
                    >
                      {isInStock ? `● ${badgeLabel}` : `◆ ${badgeLabel}`}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleShareProduct(product)}
                        className="min-h-[30px] px-2.5 py-1 rounded-full border border-[#262626] bg-[#0A0A0A]/90 hover:border-[#D4AF37] text-[11px] text-[#C5A059] cursor-pointer transition"
                      >
                        {copiedSlug === product.slug ? '✓ Copiado' : 'Compartilhar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickModalProductId(product.id)}
                        className="min-h-[30px] px-2.5 py-1 rounded-full border border-[#262626] bg-[#0A0A0A]/90 hover:border-[#D4AF37] text-[11px] text-[#F5F5F4] cursor-pointer transition"
                      >
                        Ver Ficha
                      </button>
                    </div>
                  </div>
                </div>

                {/* Corpo Interativo do Card */}
                <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between space-y-5">
                  <div className="space-y-4">
                    {/* Categoria, Título, Descrição e Selo de Material */}
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-[#A8A29E] mb-1">
                        <span className="uppercase tracking-[0.18em] text-[#C5A059] font-semibold">
                          {product.category.name}
                        </span>
                        <span className="font-mono text-[10px] text-[#A8A29E]/80">
                          Ref: {skuCode}
                        </span>
                      </div>

                      <h2
                        onClick={() => setQuickModalProductId(product.id)}
                        className="text-xl font-serif text-[#F5F5F4] group-hover:text-[#D4AF37] font-semibold leading-snug transition cursor-pointer"
                      >
                        {product.name}
                      </h2>

                      <p className="text-xs text-[#A8A29E] line-clamp-2 mt-1.5 leading-relaxed">
                        {product.shortDescription}
                      </p>

                      {product.material && (
                        <span className="inline-block mt-2 px-2.5 py-1 rounded-md border border-[#262626] bg-[#0A0A0A] text-[11px] text-[#C5A059]">
                          ✦ {product.material}
                        </span>
                      )}
                    </div>

                    {/* Seletor Rápido de Cores com Anel de Foco Dourado */}
                    {resolved.availableColors.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs text-[#A8A29E] block">
                          Cor:{' '}
                          <strong className="text-[#F5F5F4] font-semibold">
                            {resolved.selectedColorName}
                          </strong>
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {resolved.availableColors.map((c) => {
                            const isColorActive =
                              c.colorName.toLowerCase() ===
                              resolved.selectedColorName.toLowerCase();
                            return (
                              <button
                                key={c.colorName}
                                type="button"
                                onClick={() =>
                                  setSelectionByProduct((prev) => ({
                                    ...prev,
                                    [product.id]: {
                                      ...prev[product.id],
                                      colorName: c.colorName,
                                    },
                                  }))
                                }
                                className={`min-h-[34px] inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs border transition cursor-pointer ${
                                  isColorActive
                                    ? 'border-[#D4AF37] bg-[#D4AF37]/20 text-[#F5F5F4] font-bold shadow-[0_0_12px_rgba(212,175,55,0.25)]'
                                    : 'border-[#262626] bg-[#0A0A0A] text-[#A8A29E] hover:border-[#C5A059]'
                                }`}
                              >
                                <span
                                  className="w-3.5 h-3.5 rounded-full border border-white/30 shrink-0"
                                  style={{ backgroundColor: c.colorHex || '#D4AF37' }}
                                />
                                <span>{c.colorName}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Seletor Rápido de Numeração / Tamanho com Alvos de Toque Confortáveis */}
                    {resolved.sizeOptionsForColorAndModel.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#A8A29E]">
                            Numeração / Tamanho:{' '}
                            <strong className="text-[#D4AF37]">{resolved.selectedSizeLabel}</strong>
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {resolved.sizeOptionsForColorAndModel.map((sz) => {
                            const isSizeSelected =
                              sz.sizeLabel.toLowerCase() ===
                              resolved.selectedSizeLabel.toLowerCase();
                            const canSelect = sz.isCompatibleWithColorAndModel;
                            return (
                              <button
                                key={sz.sizeLabel}
                                type="button"
                                disabled={!canSelect}
                                onClick={() =>
                                  setSelectionByProduct((prev) => ({
                                    ...prev,
                                    [product.id]: {
                                      ...prev[product.id],
                                      colorName: resolved.selectedColorName,
                                      sizeLabel: sz.sizeLabel,
                                    },
                                  }))
                                }
                                className={`min-w-[40px] min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                                  !canSelect
                                    ? 'border-[#262626]/40 bg-[#0A0A0A]/40 text-[#A8A29E]/30 line-through cursor-not-allowed'
                                    : isSizeSelected
                                    ? 'border-[#D4AF37] bg-[#D4AF37] text-[#0A0A0A] cursor-pointer shadow-[0_2px_10px_rgba(212,175,55,0.35)]'
                                    : 'border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] hover:border-[#D4AF37] cursor-pointer'
                                }`}
                              >
                                {sz.sizeLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bloco de Preço PIX com Ancoragem de Economia + Botões de Conversão */}
                  <div className="pt-4 border-t border-[#262626] space-y-3.5">
                    <div className="rounded-2xl border border-[#262626] bg-[#0A0A0A] p-3.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[11px] text-[#10B981] font-semibold block">
                          Valor Especial no PIX ({pixDiscountPercent}% OFF):
                        </span>
                        <strong className="text-2xl text-[#D4AF37] font-bold tabular-nums tracking-tight">
                          {formatCurrencyBRL(pixPriceCents)}
                        </strong>
                        {pixSavingsCents > 0 && (
                          <span className="text-[11px] text-[#10B981] block">
                            Economize {formatCurrencyBRL(pixSavingsCents)} à vista
                          </span>
                        )}
                      </div>

                      <div className="text-right text-xs text-[#A8A29E] tabular-nums">
                        <span className="line-through text-[#A8A29E]/70 block">
                          {formatCurrencyBRL(unitPriceCents)}
                        </span>
                        <span className="text-[#F5F5F4] font-medium block">
                          {maxInstallments}x de {formatCurrencyBRL(installmentValueCents)}
                        </span>
                        <span className="text-[10px] text-[#A8A29E] block">no cartão</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                      <a
                        href={singleWaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sm:col-span-3 min-h-[44px] inline-flex items-center justify-center px-3.5 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] text-xs font-bold tracking-wide transition text-center shadow-[0_4px_14px_rgba(212,175,55,0.25)]"
                      >
                        Tenho Interesse (WhatsApp)
                      </a>

                      <button
                        type="button"
                        onClick={() => handleToggleInterestItem(snapshotForList)}
                        className={`sm:col-span-2 min-h-[44px] inline-flex items-center justify-center px-3 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                          isAddedToList
                            ? 'border-[#10B981] bg-[#10B981]/15 text-[#10B981]'
                            : 'border-[#D4AF37]/50 bg-[#0A0A0A] hover:border-[#D4AF37] text-[#D4AF37]'
                        }`}
                      >
                        {isAddedToList ? '✓ Na Lista' : '+ Minha Lista'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Quick-View Modal Interativo Completo de Detalhes do Modelo */}
      {quickModalProduct &&
        (() => {
          const modalSel = selectionByProduct[quickModalProduct.id] || {};
          const modalResolved = resolveProductVariationSelection({
            product: quickModalProduct,
            variants: quickModalProduct.variants,
            images: quickModalProduct.images,
            selectedColorName: modalSel.colorName,
            selectedModelName: modalSel.modelName,
            selectedSizeLabel: modalSel.sizeLabel,
            pixDiscountPercent,
          });

          const modalUnitPrice =
            modalResolved.commercialState?.unitPriceCents ??
            quickModalProduct.promotionalPriceCents ??
            quickModalProduct.basePriceCents;
          const modalPixPrice =
            modalResolved.pixPriceCents ??
            calculatePixPriceCents(modalUnitPrice, pixDiscountPercent);
          const modalPrimaryImg = modalResolved.galleryResolution.primaryImage;
          const modalBadgeLabel = modalResolved.commercialState?.badgeLabel || 'Sob Consulta';
          const modalSku =
            modalResolved.selectedVariant?.skuCode || quickModalProduct.slug.toUpperCase();

          const modalWaUrl = buildSingleModelWhatsAppUrl({
            whatsappNumber,
            productName: quickModalProduct.name,
            skuCode: modalSku,
            colorName: modalResolved.selectedColorName || 'Padrão',
            modelName: modalResolved.selectedModelName || 'Padrão',
            sizeLabel: modalResolved.selectedSizeLabel || 'Único',
            badgeLabel: modalBadgeLabel,
            unitPriceCents: modalUnitPrice,
            pixPriceCents: modalPixPrice,
            pixDiscountPercent,
          });

          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Ficha completa do modelo ${quickModalProduct.name}`}
              onClick={() => setQuickModalProductId(null)}
              className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-4xl rounded-3xl border border-[#D4AF37]/50 bg-[#141414] p-6 sm:p-8 max-h-[90vh] overflow-y-auto shadow-2xl grid grid-cols-1 md:grid-cols-2 gap-6"
              >
                {/* Galeria Sincronizada no Modal */}
                <div className="space-y-3">
                  <div className="aspect-square rounded-2xl border border-[#262626] bg-[#0A0A0A] overflow-hidden">
                    {modalPrimaryImg ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={modalPrimaryImg.url}
                        alt={modalPrimaryImg.altText}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-6 text-xs text-[#A8A29E] text-center">
                        Imagem específica da cor {modalResolved.selectedColorName}
                      </div>
                    )}
                  </div>

                  {quickModalProduct.images.length > 1 && (
                    <div className="grid grid-cols-3 gap-2">
                      {quickModalProduct.images.map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => {
                            if (img.colorName) {
                              setSelectionByProduct((prev) => ({
                                ...prev,
                                [quickModalProduct.id]: {
                                  ...prev[quickModalProduct.id],
                                  colorName: img.colorName || undefined,
                                },
                              }));
                            }
                          }}
                          className="rounded-xl border border-[#262626] hover:border-[#D4AF37] bg-[#0A0A0A] overflow-hidden cursor-pointer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.url}
                            alt={img.altText}
                            className="w-full aspect-square object-cover"
                          />
                          <span className="block py-1 text-[10px] text-[#C5A059] text-center truncate px-1">
                            {img.colorName || 'Geral'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Ficha Técnica Completa e Seletores no Modal */}
                <div className="flex flex-col justify-between space-y-5">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3 border-b border-[#262626] pb-3">
                      <div>
                        <span className="text-xs uppercase tracking-widest text-[#C5A059] font-semibold">
                          {quickModalProduct.category.name} • Ref: {modalSku}
                        </span>
                        <h3 className="text-2xl font-serif text-[#D4AF37] font-semibold mt-0.5">
                          {quickModalProduct.name}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQuickModalProductId(null)}
                        className="px-3 py-1.5 rounded-xl border border-[#262626] bg-[#0A0A0A] text-xs text-[#F5F5F4] hover:border-[#D4AF37] cursor-pointer"
                      >
                        Fechar ✕
                      </button>
                    </div>

                    <p className="text-xs sm:text-sm text-[#F5F5F4]/90 leading-relaxed">
                      {quickModalProduct.fullDescription || quickModalProduct.shortDescription}
                    </p>

                    {quickModalProduct.material && (
                      <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-3 text-xs space-y-1">
                        <strong className="text-[#C5A059] block">Material &amp; Acabamento:</strong>
                        <span className="text-[#A8A29E]">{quickModalProduct.material}</span>
                      </div>
                    )}

                    {/* Cores no Modal */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-[#A8A29E] block">
                        Escolha a Cor:{' '}
                        <strong className="text-[#F5F5F4]">
                          {modalResolved.selectedColorName}
                        </strong>
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {modalResolved.availableColors.map((c) => {
                          const active =
                            c.colorName.toLowerCase() ===
                            modalResolved.selectedColorName.toLowerCase();
                          return (
                            <button
                              key={c.colorName}
                              type="button"
                              onClick={() =>
                                setSelectionByProduct((prev) => ({
                                  ...prev,
                                  [quickModalProduct.id]: {
                                    ...prev[quickModalProduct.id],
                                    colorName: c.colorName,
                                  },
                                }))
                              }
                              className={`px-3 py-1.5 rounded-full text-xs border transition cursor-pointer inline-flex items-center gap-1.5 ${
                                active
                                  ? 'border-[#D4AF37] bg-[#D4AF37]/20 text-[#F5F5F4] font-bold'
                                  : 'border-[#262626] bg-[#0A0A0A] text-[#A8A29E]'
                              }`}
                            >
                              <span
                                className="w-3 h-3 rounded-full border border-white/25"
                                style={{ backgroundColor: c.colorHex || '#D4AF37' }}
                              />
                              {c.colorName}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tamanhos no Modal */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-[#A8A29E] block">
                        Escolha a Numeração / Tamanho:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {modalResolved.sizeOptionsForColorAndModel.map((sz) => {
                          const active =
                            sz.sizeLabel.toLowerCase() ===
                            modalResolved.selectedSizeLabel.toLowerCase();
                          return (
                            <button
                              key={sz.sizeLabel}
                              type="button"
                              disabled={!sz.isCompatibleWithColorAndModel}
                              onClick={() =>
                                setSelectionByProduct((prev) => ({
                                  ...prev,
                                  [quickModalProduct.id]: {
                                    ...prev[quickModalProduct.id],
                                    colorName: modalResolved.selectedColorName,
                                    sizeLabel: sz.sizeLabel,
                                  },
                                }))
                              }
                              className={`min-w-[42px] min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                                !sz.isCompatibleWithColorAndModel
                                  ? 'opacity-30 line-through cursor-not-allowed border-[#262626]'
                                  : active
                                  ? 'border-[#D4AF37] bg-[#D4AF37] text-[#0A0A0A] cursor-pointer'
                                  : 'border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] cursor-pointer'
                              }`}
                            >
                              {sz.sizeLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[#262626] space-y-3">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-xs text-[#10B981] font-semibold block">
                          Valor no PIX ({pixDiscountPercent}% OFF):
                        </span>
                        <strong className="text-2xl text-[#D4AF37] font-bold tabular-nums">
                          {formatCurrencyBRL(modalPixPrice)}
                        </strong>
                      </div>
                      <span className="text-xs text-[#A8A29E] tabular-nums">
                        ou {formatCurrencyBRL(modalUnitPrice)} em até {maxInstallments}x
                      </span>
                    </div>

                    <a
                      href={modalWaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-h-[46px] inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] text-sm font-bold transition text-center shadow-lg"
                    >
                      Solicitar este Modelo no WhatsApp →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Barra Flutuante Dourada no Rodapé — "Lista de Interesse" */}
      {interestList.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 max-w-5xl mx-auto">
          {drawerOpen && (
            <div className="mb-2 rounded-2xl border border-[#D4AF37]/50 bg-[#141414]/98 backdrop-blur-md p-4 shadow-2xl space-y-3 max-h-72 overflow-y-auto">
              <div className="flex items-center justify-between border-b border-[#262626] pb-2">
                <strong className="text-xs uppercase tracking-wider text-[#D4AF37]">
                  Modelos Selecionados na sua Lista de Interesse ({interestList.length})
                </strong>
                <button
                  type="button"
                  onClick={() => saveInterestList([])}
                  className="text-[11px] text-[#EF4444] hover:underline cursor-pointer"
                >
                  Limpar Lista
                </button>
              </div>
              <div className="space-y-2">
                {interestList.map((item) => (
                  <div
                    key={item.variantId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 py-2 text-xs"
                  >
                    <div>
                      <strong className="text-[#F5F5F4]">{item.productName}</strong>
                      <span className="text-[#A8A29E] block">
                        Cor: {item.colorName} • Tam: {item.sizeLabel} • {item.badgeLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <strong className="text-[#D4AF37] tabular-nums">
                        {formatCurrencyBRL(item.pixPriceCents)}
                      </strong>
                      <button
                        type="button"
                        onClick={() => handleToggleInterestItem(item)}
                        className="text-[#EF4444] hover:underline text-xs cursor-pointer"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border-2 border-[#D4AF37] bg-[#0A0A0A]/95 backdrop-blur-md px-4 py-3.5 sm:px-6 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center justify-between sm:justify-start gap-3">
              <span className="w-8 h-8 rounded-full bg-[#D4AF37] text-[#0A0A0A] font-bold text-sm inline-flex items-center justify-center shrink-0 tabular-nums">
                {interestList.length}
              </span>
              <div>
                <strong className="text-xs sm:text-sm text-[#F5F5F4] block">
                  Lista de Interesse ({interestList.length}{' '}
                  {interestList.length === 1 ? 'modelo selecionado' : 'modelos selecionados'})
                </strong>
                <span className="text-[11px] text-[#C5A059] tabular-nums">
                  Total estimado no PIX:{' '}
                  {formatCurrencyBRL(
                    interestList.reduce((acc, i) => acc + i.pixPriceCents, 0)
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setDrawerOpen((prev) => !prev)}
                className="min-h-[42px] px-3.5 py-2 rounded-xl border border-[#262626] bg-[#141414] hover:border-[#D4AF37] text-xs font-medium text-[#F5F5F4] cursor-pointer"
              >
                {drawerOpen ? 'Ocultar Seleção' : 'Ver Seleção'}
              </button>

              <a
                href={buildInterestListWhatsAppUrl({
                  whatsappNumber,
                  items: interestList,
                  pixDiscountPercent,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 sm:flex-initial min-h-[42px] inline-flex items-center justify-center px-5 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] text-xs sm:text-sm font-bold tracking-wide transition shadow-lg text-center"
              >
                Enviar Seleção para o WhatsApp →
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
