'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  addOrUpdateCartItem,
  CartItemSnapshot,
  formatCurrencyBRL,
  ProductWithRelations,
  resolveProductVariationSelection,
} from '@/lib/storefront';
import { CART_STORAGE_KEY } from './StoreHeader';
import CartSummaryBar from './CartSummaryBar';

interface ProductDetailClientProps {
  product: ProductWithRelations;
  pixDiscountPercent: number;
  maxInstallments: number;
  originCep: string;
  nearbyCities: string[];
}

export default function ProductDetailClient({
  product,
  pixDiscountPercent,
  maxInstallments,
  originCep,
  nearbyCities,
}: ProductDetailClientProps) {
  const initialSelection = useMemo(
    () =>
      resolveProductVariationSelection({
        product,
        variants: product.variants,
        images: product.images,
        pixDiscountPercent,
      }),
    [product, pixDiscountPercent]
  );

  const [selectedColor, setSelectedColor] = useState(initialSelection.selectedColorName);
  const [selectedModel, setSelectedModel] = useState(initialSelection.selectedModelName);
  const [selectedSize, setSelectedSize] = useState(initialSelection.selectedSizeLabel);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showIllustrativePhoto, setShowIllustrativePhoto] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const selection = useMemo(
    () =>
      resolveProductVariationSelection({
        product,
        variants: product.variants,
        images: product.images,
        selectedColorName: selectedColor,
        selectedModelName: selectedModel,
        selectedSizeLabel: selectedSize,
        pixDiscountPercent,
      }),
    [product, selectedColor, selectedModel, selectedSize, pixDiscountPercent]
  );

  function handleColorChange(nextColor: string) {
    setSelectedColor(nextColor);
    setActiveImageIndex(0);
    setShowIllustrativePhoto(false);
    setQuantity(1);
    setFeedback(null);
  }

  function handleModelChange(nextModel: string) {
    setSelectedModel(nextModel);
    setActiveImageIndex(0);
    setShowIllustrativePhoto(false);
    setQuantity(1);
    setFeedback(null);
  }

  function handleSizeChange(nextSize: string) {
    setSelectedSize(nextSize);
    setQuantity(1);
    setFeedback(null);
  }

  function handleAddToCart() {
    setFeedback(null);
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      const currentCart: CartItemSnapshot[] = raw ? JSON.parse(raw) : [];

      const updatedCart = addOrUpdateCartItem(currentCart, selection, product, quantity);
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(updatedCart));
      window.dispatchEvent(new Event('stillus-cart-updated'));

      setFeedback({
        type: 'ok',
        text: `Adicionado à sacola: ${product.name} — Cor ${selection.selectedColorName}, Modelo ${selection.selectedModelName}, Tamanho ${selection.selectedSizeLabel} (SKU: ${selection.selectedVariant?.skuCode}).`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível adicionar o item.';
      setFeedback({ type: 'err', text: msg });
    }
  }

  const state = selection.commercialState;
  const gallery = selection.galleryResolution;
  const displayedSpecificImage =
    gallery.hasSpecificImages && gallery.gallery[activeImageIndex]
      ? gallery.gallery[activeImageIndex]
      : gallery.primaryImage;

  const firstIllustrative = gallery.illustrativeFallbackImages[0] ?? null;

  const effectivePriceCents = state?.unitPriceCents ?? product.basePriceCents;
  const pixPriceCents = selection.pixPriceCents ?? effectivePriceCents;
  const installmentValueCents = Math.ceil(effectivePriceCents / Math.max(1, maxInstallments));

  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <nav aria-label="Localização na loja" className="text-xs text-[#A8A29E] flex flex-wrap gap-2">
        <Link href="/" className="hover:text-[#D4AF37]">
          Início
        </Link>
        <span>/</span>
        <Link
          href={`/produtos?categoria=${encodeURIComponent(product.category.slug)}`}
          className="hover:text-[#D4AF37]"
        >
          {product.category.name}
        </Link>
        <span>/</span>
        <span className="text-[#F5F5F4] font-medium">{product.name}</span>
      </nav>

      {/* Grid Principal: Galeria Sincronizada + Ficha de Variações */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Coluna Esquerda: Galeria Vinculada Estritamente à Cor/Modelo */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-xl border border-[#262626] bg-[#141414] overflow-hidden relative aspect-square flex items-center justify-center">
            {gallery.hasSpecificImages && displayedSpecificImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={displayedSpecificImage.url}
                alt={displayedSpecificImage.altText}
                className="w-full h-full object-cover"
              />
            ) : showIllustrativePhoto && firstIllustrative ? (
              <div className="relative w-full h-full">
                <div
                  role="alert"
                  className="absolute top-0 inset-x-0 z-20 bg-[#F59E0B] text-[#0A0A0A] px-4 py-2.5 text-xs font-bold text-center shadow"
                >
                  {firstIllustrative.disclaimer}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={firstIllustrative.image.url}
                  alt={firstIllustrative.image.altText}
                  className="w-full h-full object-cover opacity-90"
                />
              </div>
            ) : (
              /* Comportamento Seguro Obrigatório: Nunca exibe foto de outra cor como se fosse a escolhida */
              <div
                role="status"
                className="p-6 sm:p-8 text-center max-w-md space-y-4"
              >
                <div className="w-12 h-12 rounded-full border border-[#D4AF37]/50 bg-[#0A0A0A] mx-auto flex items-center justify-center text-[#D4AF37] font-serif text-lg">
                  !
                </div>
                <h2 className="text-base font-semibold text-[#F5F5F4]">
                  {gallery.missingImageNotice}
                </h2>
                <p className="text-xs text-[#A8A29E] leading-relaxed">
                  Para sua segurança, não exibimos automaticamente fotos de outra cor como se
                  fossem a variação <strong className="text-[#D4AF37]">{selection.selectedColorName}</strong>.
                </p>

                {firstIllustrative && (
                  <button
                    type="button"
                    onClick={() => setShowIllustrativePhoto(true)}
                    className="min-h-[44px] px-4 py-2 rounded-lg border border-[#D4AF37] bg-[#0A0A0A] hover:bg-[#D4AF37]/15 text-xs text-[#D4AF37] font-medium transition cursor-pointer"
                  >
                    Ver foto ilustrativa do modelo na cor &ldquo;
                    {firstIllustrative.image.colorName || 'Geral'}&rdquo;
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Miniaturas exclusivas da cor selecionada */}
          {gallery.hasSpecificImages && gallery.gallery.length > 1 && (
            <div className="flex items-center gap-3 overflow-x-auto pb-2">
              {gallery.gallery.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setActiveImageIndex(idx)}
                  aria-label={`Ver imagem ${idx + 1} da cor ${selection.selectedColorName}`}
                  className={`w-20 h-20 rounded-lg overflow-hidden border-2 transition shrink-0 cursor-pointer ${
                    idx === activeImageIndex
                      ? 'border-[#D4AF37]'
                      : 'border-[#262626] opacity-70 hover:opacity-100'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.altText} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Coluna Direita: Seleção de Variações, Disponibilidade, Preço e Compra */}
        <div className="lg:col-span-6 rounded-xl border border-[#262626] bg-[#141414] p-6 sm:p-8 space-y-6">
          <div className="space-y-2 border-b border-[#262626] pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-widest text-[#C5A059]">
                {product.category.name}
              </span>
              {selection.selectedVariant && (
                <span className="text-xs font-mono text-[#A8A29E]">
                  SKU: <strong className="text-[#F5F5F4]">{selection.selectedVariant.skuCode}</strong>
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-serif text-[#F5F5F4] font-semibold">
              {product.name}
            </h1>
            <p className="text-sm text-[#A8A29E]">{product.shortDescription}</p>
          </div>

          {/* Preço e Condições Comerciais Confirmadas */}
          <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 space-y-1">
            <span className="text-2xl font-bold text-[#D4AF37] block">
              {formatCurrencyBRL(pixPriceCents)} no PIX ({pixDiscountPercent}% de desconto)
            </span>
            <span className="text-sm text-[#F5F5F4] block">
              Valor no Cartão: {formatCurrencyBRL(effectivePriceCents)} em até {maxInstallments}x de{' '}
              {formatCurrencyBRL(installmentValueCents)}
            </span>
          </div>

          {/* Status de Estoque / Encomenda da Combinação Selecionada */}
          {state && (
            <div
              role="status"
              className={`rounded-lg border p-3.5 text-xs space-y-1 ${
                state.badgeType === 'IN_STOCK'
                  ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]'
                  : state.badgeType === 'MADE_TO_ORDER_CONFIRMED' ||
                    state.badgeType === 'MADE_TO_ORDER_TBD'
                  ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#D4AF37]'
                  : 'border-[#EF4444]/40 bg-[#EF4444]/10 text-[#EF4444]'
              }`}
            >
              <strong className="block text-sm">{state.badgeLabel}</strong>
              <p className="text-[#F5F5F4]">{state.availabilityDescription}</p>
            </div>
          )}

          {/* 1. Seletor de Cor */}
          <div className="space-y-2">
            <span className="block text-xs uppercase tracking-wider text-[#A8A29E]">
              1. Cor Selecionada:{' '}
              <strong className="text-[#F5F5F4]">{selection.selectedColorName}</strong>
            </span>
            <div
              role="radiogroup"
              aria-label="Selecionar cor do produto"
              className="flex flex-wrap gap-2.5"
            >
              {selection.availableColors.map((c) => {
                const isSelected =
                  c.colorName.toLowerCase() === selection.selectedColorName.toLowerCase();
                return (
                  <button
                    key={c.colorName}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`Cor ${c.colorName}`}
                    onClick={() => handleColorChange(c.colorName)}
                    className={`min-h-[44px] px-4 py-2 rounded-lg border text-xs sm:text-sm font-medium flex items-center gap-2 transition cursor-pointer ${
                      isSelected
                        ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-[#D4AF37]'
                        : 'border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] hover:border-[#C5A059]'
                    }`}
                  >
                    {c.colorHex && (
                      <span
                        aria-hidden="true"
                        className="w-4 h-4 rounded-full border border-[#F5F5F4]/40 shrink-0"
                        style={{ backgroundColor: c.colorHex }}
                      />
                    )}
                    <span>{c.colorName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Seletor de Modelo (Oculto se for apenas 'Padrão') */}
          {!(
            selection.availableModelsForColor.length === 1 &&
            selection.availableModelsForColor[0] === 'Padrão'
          ) && (
            <div className="space-y-2">
              <span className="block text-xs uppercase tracking-wider text-[#A8A29E]">
                2. Variação de Estilo:{' '}
                <strong className="text-[#F5F5F4]">{selection.selectedModelName}</strong>
              </span>
              <div
                role="radiogroup"
                aria-label="Selecionar modelo do produto"
                className="flex flex-wrap gap-2.5"
              >
                {selection.availableModelsForColor.map((modelName) => {
                  const isSelected =
                    modelName.toLowerCase() === selection.selectedModelName.toLowerCase();
                  return (
                    <button
                      key={modelName}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => handleModelChange(modelName)}
                      className={`min-h-[44px] px-4 py-2 rounded-lg border text-xs sm:text-sm font-medium transition cursor-pointer ${
                        isSelected
                          ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-[#D4AF37]'
                          : 'border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] hover:border-[#C5A059]'
                      }`}
                    >
                      {modelName}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Seletor de Tamanho (Impede combinações incompatíveis) */}
          <div className="space-y-2">
            <span className="block text-xs uppercase tracking-wider text-[#A8A29E]">
              {selection.availableModelsForColor.length === 1 &&
              selection.availableModelsForColor[0] === 'Padrão'
                ? '2. Tamanho / Numeração:'
                : '3. Tamanho / Numeração:'}{' '}
              <strong className="text-[#F5F5F4]">{selection.selectedSizeLabel}</strong>
            </span>
            <div
              role="radiogroup"
              aria-label="Selecionar tamanho ou numeração"
              className="flex flex-wrap gap-2.5"
            >
              {selection.sizeOptionsForColorAndModel.map((sizeOpt) => {
                const isSelected =
                  sizeOpt.sizeLabel.toLowerCase() === selection.selectedSizeLabel.toLowerCase();
                const isCompatible = sizeOpt.isCompatibleWithColorAndModel;
                const canBuySize = Boolean(sizeOpt.commercialState?.canPurchase);

                return (
                  <button
                    key={sizeOpt.sizeLabel}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!isCompatible}
                    aria-label={
                      !isCompatible
                        ? `Tamanho ${sizeOpt.sizeLabel} indisponível na cor ${selection.selectedColorName}`
                        : `Tamanho ${sizeOpt.sizeLabel} (${sizeOpt.commercialState?.badgeLabel})`
                    }
                    onClick={() => handleSizeChange(sizeOpt.sizeLabel)}
                    className={`min-w-[48px] min-h-[44px] px-3.5 py-2 rounded-lg border text-xs sm:text-sm font-semibold transition ${
                      !isCompatible
                        ? 'border-[#262626]/50 bg-[#0A0A0A]/40 text-[#A8A29E]/40 line-through cursor-not-allowed'
                        : isSelected
                        ? 'border-[#D4AF37] bg-[#D4AF37] text-[#0A0A0A] cursor-pointer'
                        : canBuySize
                        ? 'border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] hover:border-[#D4AF37] cursor-pointer'
                        : 'border-[#EF4444]/40 bg-[#0A0A0A] text-[#A8A29E] cursor-pointer'
                    }`}
                  >
                    {sizeOpt.sizeLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Quantidade e Botão de Adicionar à Sacola */}
          {state?.canPurchase ? (
            <div className="pt-2 space-y-4">
              <div className="flex items-center gap-4">
                <label
                  htmlFor="product-qty-select"
                  className="text-xs uppercase tracking-wider text-[#A8A29E]"
                >
                  Quantidade:
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Diminuir quantidade"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="min-w-[44px] min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <input
                    id="product-qty-select"
                    type="number"
                    min={1}
                    max={state.maxPurchaseQuantity}
                    value={quantity}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 1;
                      setQuantity(Math.min(Math.max(1, val), state.maxPurchaseQuantity));
                    }}
                    className="w-16 min-h-[44px] text-center rounded-lg border border-[#262626] bg-[#0A0A0A] text-sm font-semibold"
                  />
                  <button
                    type="button"
                    aria-label="Aumentar quantidade"
                    disabled={quantity >= state.maxPurchaseQuantity}
                    onClick={() =>
                      setQuantity((q) => Math.min(state.maxPurchaseQuantity, q + 1))
                    }
                    className="min-w-[44px] min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] disabled:opacity-40 font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
                {state.supplyMode === 'IN_STOCK' && (
                  <span className="text-xs text-[#A8A29E]">
                    (Máx. disponível: {state.availableStock} un.)
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleAddToCart}
                className="w-full min-h-[48px] rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-semibold text-sm sm:text-base transition shadow-lg cursor-pointer"
              >
                Adicionar à Sacola • {selection.selectedColorName} ({selection.selectedSizeLabel})
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-4 text-xs text-[#EF4444]">
              Esta combinação não está disponível para compra imediata. Selecione outra cor ou
              numeração disponível.
            </div>
          )}

          {feedback && (
            <div
              role="alert"
              className={`rounded-lg border p-3.5 text-xs ${
                feedback.type === 'ok'
                  ? 'border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981]'
                  : 'border-[#EF4444]/50 bg-[#EF4444]/10 text-[#EF4444]'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* Informações de Entrega e Ficha Técnica */}
          <div className="border-t border-[#262626] pt-4 space-y-3 text-xs text-[#A8A29E]">
            <div>
              <strong className="text-[#D4AF37] block">Envio &amp; Prazos de Entrega:</strong>
              <p>
                • Envio calculado via <strong>Melhor Envio</strong> a partir de Domingos Martins/ES
                (CEP {originCep}). Em pedidos mistos (pronta entrega + encomenda), o envio ocorre
                em <strong>remessa única</strong> após a preparação do item encomendado.
              </p>
              <p className="mt-1">
                • Opção de <strong>Entrega a Combinar</strong> disponível para:{' '}
                <strong className="text-[#F5F5F4]">{nearbyCities.join(', ')}</strong>.
              </p>
            </div>

            {product.fullDescription && (
              <div>
                <strong className="text-[#F5F5F4] block">Detalhes do Produto:</strong>
                <p>{product.fullDescription}</p>
              </div>
            )}

            <div>
              <strong className="text-[#F5F5F4]">Ficha Técnica &amp; Dimensões:</strong> Peso{' '}
              {product.weightKg}kg • Dimensões {product.heightCm}x{product.widthCm}x
              {product.lengthCm}cm
              {product.material ? ` • Material: ${product.material}` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Resumo da Sacola na própria página para conferência imediata */}
      <CartSummaryBar pixDiscountPercent={pixDiscountPercent} />
    </div>
  );
}
