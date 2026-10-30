'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  calculateProductMarginMetrics,
  calculateSalePriceFromMarkup,
  evaluatePurchaseListMetrics,
} from '@/lib/purchasing-strategy';

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  defaultWeightKg: number;
  defaultHeightCm: number;
  defaultWidthCm: number;
  defaultLengthCm: number;
  _count?: {
    products: number;
  };
}

export interface VariantDTO {
  id: string;
  productId: string;
  skuCode: string;
  colorName: string;
  colorHex: string | null;
  modelName: string;
  sizeLabel: string;
  priceOverrideCents: number | null;
  supplyMode: string;
  prepDays: number | null;
  stockOnHand: number;
  stockReserved: number;
  isActive: boolean;
}

export interface ImageDTO {
  id: string;
  productId: string;
  colorName: string | null;
  modelName: string | null;
  url: string;
  altText: string;
  displayOrder: number;
  isPrimary: boolean;
}

export interface ProductDTO {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  shortDescription: string;
  fullDescription?: string | null;
  material?: string | null;
  costPriceCents?: number;
  basePriceCents: number;
  promotionalPriceCents: number | null;
  status: string;
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  category: CategoryDTO;
  variants: VariantDTO[];
  images: ImageDTO[];
}

export interface MovementDTO {
  id: string;
  movementType: string;
  quantityDelta: number;
  previousOnHand: number;
  newOnHand: number;
  previousReserved: number;
  newReserved: number;
  reason: string;
  createdAt: string;
  variant: {
    skuCode: string;
    colorName: string;
    sizeLabel: string;
    product: { name: string };
  };
}

export interface PurchaseItemDTO {
  id: string;
  purchaseListId: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  skuCode: string;
  colorName: string;
  sizeLabel: string;
  quantity: number;
  unitCostCents: number;
  unitSalePriceCents: number;
  createdAt: string;
}

export interface PurchaseListDTO {
  id: string;
  title: string;
  supplierName: string | null;
  minOrderQuantity: number;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseItemDTO[];
}

interface Props {
  adminEmail: string;
  adminRole: string;
  categories: CategoryDTO[];
  initialProducts: ProductDTO[];
  recentMovements: MovementDTO[];
  initialDefaultMarkupPercent?: number;
  initialPixDiscountPercent?: number;
  initialGatewayPixFeePercent?: number;
  initialGatewayCardFeePercent?: number;
  initialPurchaseLists?: PurchaseListDTO[];
}

const PRESET_SHOE_SIZES = ['34', '35', '36', '37', '38', '39', '40'];
const PRESET_BAG_SIZES = ['Único', 'P', 'M', 'G'];

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function slugifyText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default function AdminCatalogManager({
  adminEmail,
  adminRole,
  categories,
  initialProducts,
  recentMovements,
  initialDefaultMarkupPercent = 120,
  initialPixDiscountPercent = 10,
  initialGatewayPixFeePercent = 0.99,
  initialGatewayCardFeePercent = 3.99,
  initialPurchaseLists = [],
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    'estudio' | 'pedidos_fornecedor' | 'config_estoque' | 'categorias'
  >('estudio');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Gestão de Categorias
  const [categoriesList, setCategoriesList] = useState<CategoryDTO[]>(categories);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catSlug, setCatSlug] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catOrder, setCatOrder] = useState('0');
  const [catIsActive, setCatIsActive] = useState(true);
  const [catWeightKg, setCatWeightKg] = useState('0.6');
  const [catHeightCm, setCatHeightCm] = useState('15');
  const [catWidthCm, setCatWidthCm] = useState('25');
  const [catLengthCm, setCatLengthCm] = useState('30');
  const [catSubmitting, setCatSubmitting] = useState(false);

  // Configurações estratégicas de Markup (%), Desconto PIX (%) e Taxas Gateway Mercado Pago (%)
  const [markupPercent, setMarkupPercent] = useState<number>(initialDefaultMarkupPercent);
  const [pixDiscountPercent, setPixDiscountPercent] = useState<number>(initialPixDiscountPercent);
  const [gatewayPixFeePercent, setGatewayPixFeePercent] = useState<number>(initialGatewayPixFeePercent);
  const [gatewayCardFeePercent, setGatewayCardFeePercent] = useState<number>(initialGatewayCardFeePercent);

  // ============================================================================
  // MÓDULO 3: ASSISTENTE DE CADASTRO PERSUASIVO COM OPENAI VISION / SMART ENGINE
  // ============================================================================
  const [aiRawNotes, setAiRawNotes] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSocialCaption, setAiSocialCaption] = useState('');
  const [aiNotice, setAiNotice] = useState('');

  // ============================================================================
  // MÓDULO 2 & 4: ESTÚDIO DE POSTAGEM ÁGIL (COM UPLOAD, CUSTO E MARKUP 120%)
  // ============================================================================
  const firstCat = categories[0];
  const [prodCategoryId, setProdCategoryId] = useState(firstCat?.id || '');
  const [prodName, setProdName] = useState('');
  const [prodSlug, setProdSlug] = useState('');
  const [prodShortDesc, setProdShortDesc] = useState('');
  const [prodFullDesc, setProdFullDesc] = useState('');
  const [prodMaterial, setProdMaterial] = useState('');
  const [prodCostReais, setProdCostReais] = useState('');
  const [prodPriceReais, setProdPriceReais] = useState('');
  const [prodWeightKg, setProdWeightKg] = useState(String(firstCat?.defaultWeightKg ?? 0.7));
  const [prodHeightCm, setProdHeightCm] = useState(String(firstCat?.defaultHeightCm ?? 20));
  const [prodWidthCm, setProdWidthCm] = useState(String(firstCat?.defaultWidthCm ?? 28));
  const [prodLengthCm, setProdLengthCm] = useState(String(firstCat?.defaultLengthCm ?? 35));
  const [prodStatus, setProdStatus] = useState<'ACTIVE' | 'DRAFT'>('ACTIVE');

  // Estado de Nova Variação em Lote (Múltiplas Numerações em 1 Clique)
  const [varProductId, setVarProductId] = useState(initialProducts[0]?.id || '');
  const [varSkuCode, setVarSkuCode] = useState('');
  const [varColorName, setVarColorName] = useState('');
  const [varColorHex, setVarColorHex] = useState('#D4AF37');
  const [varModelName, setVarModelName] = useState('Padrão');
  const [varSizeLabel, setVarSizeLabel] = useState('');
  const [selectedBatchSizes, setSelectedBatchSizes] = useState<string[]>([]);
  const [varSupplyMode, setVarSupplyMode] = useState<
    'IN_STOCK' | 'MADE_TO_ORDER_CONFIRMED_LEAD' | 'MADE_TO_ORDER_TBD_LEAD' | 'UNAVAILABLE'
  >('IN_STOCK');
  const [varPrepDays, setVarPrepDays] = useState('5');
  const [varInitialStock, setVarInitialStock] = useState('2');

  // Estado de Upload Direto de Foto + Vínculo com Cor
  const [imgProductId, setImgProductId] = useState(initialProducts[0]?.id || '');
  const [imgColorName, setImgColorName] = useState('');
  const [imgModelName, setImgModelName] = useState('Padrão');
  const [imgUrl, setImgUrl] = useState('');
  const [imgAlt, setImgAlt] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [colorPhotos, setColorPhotos] = useState<Array<{ url: string; altText?: string }>>([]);
  const [uploadingForProductColor, setUploadingForProductColor] = useState<string | null>(null);

  // Modo do Estúdio Unificado: Criar Novo Modelo Completo OU Adicionar Nova Cor a Modelo Existente
  const [studioMode, setStudioMode] = useState<'NEW_PRODUCT' | 'ADD_COLOR_TO_EXISTING'>(
    'NEW_PRODUCT'
  );
  const [submittingUnified, setSubmittingUnified] = useState(false);

  // Estado para Listas de Pedidos ao Fornecedor (Módulo 4)
  const [selectedListId, setSelectedListId] = useState<string>(initialPurchaseLists[0]?.id || '');
  const [newListTitle, setNewListTitle] = useState('');
  const [newListSupplier, setNewListSupplier] = useState('');
  const [newListMinQty, setNewListMinQty] = useState('12');
  const [newListNotes, setNewListNotes] = useState('');

  // Adicionar SKU à Lista de Pedido ao Fornecedor
  const [orderItemVariantId, setOrderItemVariantId] = useState('');
  const [orderItemQuantity, setOrderItemQuantity] = useState('2');
  const [copiedSupplierText, setCopiedSupplierText] = useState(false);

  // Estado de Ajuste Manual de Estoque
  const [adjVariantId, setAdjVariantId] = useState('');
  const [adjDelta, setAdjDelta] = useState('1');
  const [adjReason, setAdjReason] = useState('');

  // Cálculo em Tempo Real da Margem no Formulário de Cadastro (com taxas do gateway)
  const formMarginPreview = useMemo(() => {
    const costCents = Math.round((Number(prodCostReais.replace(',', '.')) || 0) * 100);
    const saleCents = Math.round((Number(prodPriceReais.replace(',', '.')) || 0) * 100);
    return calculateProductMarginMetrics({
      costCents,
      salePriceCents: saleCents,
      pixDiscountPercent,
      gatewayPixFeePercent,
      gatewayCardFeePercent,
    });
  }, [prodCostReais, prodPriceReais, pixDiscountPercent, gatewayPixFeePercent, gatewayCardFeePercent]);

  function handleApplyDefaultMarkup() {
    const costCents = Math.round((Number(prodCostReais.replace(',', '.')) || 0) * 100);
    if (costCents <= 0) {
      setFeedback({
        type: 'err',
        text: 'Informe primeiro o Valor de Custo (R$) para aplicar o Markup automático.',
      });
      return;
    }
    const suggestedSaleCents = calculateSalePriceFromMarkup(costCents, markupPercent, {
      coverGatewayFee: true,
      gatewayFeePercent: gatewayCardFeePercent,
    });
    setProdPriceReais((suggestedSaleCents / 100).toFixed(2).replace('.', ','));
  }

  function toggleBatchSize(sz: string) {
    setSelectedBatchSizes((prev) =>
      prev.includes(sz) ? prev.filter((item) => item !== sz) : [...prev, sz]
    );
  }

  async function handleLogout() {
    await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    router.push('/admin/login');
    router.refresh();
  }

  // Upload direto de arquivo(s) de foto do PC / Celular
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingPhoto(true);
    setFeedback(null);
    try {
      const newPhotos: Array<{ url: string; altText?: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/admin/upload', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (res.ok && data.url) {
          newPhotos.push({
            url: data.url,
            altText: `Foto ${prodName || 'produto'} ${varColorName || ''} ${colorPhotos.length + i + 1}`.trim(),
          });
        }
      }

      if (newPhotos.length > 0) {
        setColorPhotos((prev) => [...prev, ...newPhotos]);
        setImgUrl(newPhotos[0].url);
        if (!imgAlt) {
          setImgAlt(`Foto ${prodName || 'produto'} ${varColorName || ''}`.trim());
        }
        setFeedback({
          type: 'ok',
          text: `${newPhotos.length} foto(s) enviada(s) com sucesso para esta cor.`,
        });
      }
    } catch {
      setFeedback({ type: 'err', text: 'Erro ao fazer upload das imagens.' });
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  }

  // Upload e vínculo direto de fotos a uma cor de produto já existente
  async function handleAddPhotosToExistingColor(
    productId: string,
    colorName: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const key = `${productId}-${colorName}`;
    setUploadingForProductColor(key);
    setFeedback(null);

    try {
      let countSuccess = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);

        const uploadRes = await fetch('/api/admin/upload', {
          method: 'POST',
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (uploadRes.ok && uploadData.url) {
          const imgRes = await fetch('/api/admin/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId,
              colorName,
              modelName: 'Padrão',
              url: uploadData.url,
              altText: `Foto ${colorName} ${Date.now()}`,
              displayOrder: 10 + i,
              isPrimary: false,
            }),
          });
          if (imgRes.ok) countSuccess++;
        }
      }

      setFeedback({
        type: 'ok',
        text: `${countSuccess} nova(s) foto(s) adicionada(s) à cor "${colorName}" com sucesso!`,
      });
      router.refresh();
    } catch {
      setFeedback({ type: 'err', text: 'Falha ao adicionar fotos à cor selecionada.' });
    } finally {
      setUploadingForProductColor(null);
      e.target.value = '';
    }
  }

  async function handleDeleteProductImage(imageId: string) {
    if (!confirm('Deseja excluir esta foto?')) return;
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/images?id=${encodeURIComponent(imageId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setFeedback({ type: 'ok', text: 'Foto removida com sucesso.' });
        router.refresh();
      } else {
        const data = await res.json();
        setFeedback({ type: 'err', text: data.error || 'Erro ao remover foto.' });
      }
    } catch {
      setFeedback({ type: 'err', text: 'Erro ao conectar à API de imagens.' });
    }
  }

  async function handleSetPrimaryProductImage(imageId: string) {
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: imageId, isPrimary: true }),
      });
      if (res.ok) {
        setFeedback({ type: 'ok', text: 'Foto definida como principal (capa).' });
        router.refresh();
      } else {
        const data = await res.json();
        setFeedback({ type: 'err', text: data.error || 'Erro ao definir foto principal.' });
      }
    } catch {
      setFeedback({ type: 'err', text: 'Erro ao conectar à API de imagens.' });
    }
  }

  async function handleGenerateWithAI() {
    if (!aiRawNotes.trim() && !imgUrl.trim()) {
      setFeedback({
        type: 'err',
        text: 'Informe uma breve descrição da peça para preencher o cadastro.',
      });
      return;
    }

    setAiLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawNotes: aiRawNotes,
          imageUrl: imgUrl,
          markupPercent,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.suggestion) {
        setFeedback({ type: 'err', text: data.error || 'Falha ao gerar sugestão com IA.' });
        return;
      }

      const sug = data.suggestion;
      const matchingCat = categories.find((c) => c.slug === sug.categorySlug) || categories[0];
      if (matchingCat) {
        setProdCategoryId(matchingCat.id);
      }

      setProdName(sug.suggestedName);
      setProdSlug(sug.slug);
      setProdShortDesc(sug.shortDescription);
      setProdFullDesc(sug.fullDescription);
      setProdMaterial(sug.material);
      setProdCostReais((sug.costPriceCents / 100).toFixed(2).replace('.', ','));
      setProdPriceReais((sug.suggestedSalePriceCents / 100).toFixed(2).replace('.', ','));

      setVarColorName(sug.detectedColorName);
      setVarColorHex(sug.detectedColorHex);
      setSelectedBatchSizes(sug.suggestedSizes || []);
      setVarSupplyMode(sug.supplyMode);
      setVarPrepDays(String(sug.prepDays || 5));
      setVarInitialStock(String(sug.initialStockOnHand ?? 3));

      setImgColorName(sug.detectedColorName);
      if (!imgAlt) {
        setImgAlt(`${sug.suggestedName} na cor ${sug.detectedColorName}`);
      }

      setAiSocialCaption(sug.socialCaption || '');
      setAiNotice(data.notice || '');
      setFeedback({
        type: 'ok',
        text: `Ficha persuasiva preenchida automaticamente! Revise os campos abaixo e clique em "Salvar Modelo no Catálogo".`,
      });
    } catch {
      setFeedback({ type: 'err', text: 'Erro ao consultar o Assistente IA.' });
    } finally {
      setAiLoading(false);
    }
  }

  async function handleUnifiedCatalogSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const sizesToCreate =
      selectedBatchSizes.length > 0
        ? selectedBatchSizes
        : varSizeLabel.trim()
        ? [varSizeLabel.trim()]
        : ['Único'];

    const colorNameClean = (varColorName || imgColorName || 'Padrão').trim();
    if (!colorNameClean) {
      setFeedback({ type: 'err', text: 'Informe o nome da cor (ex.: Preto Ônix, Dourado).' });
      return;
    }

    setSubmittingUnified(true);
    try {
      const costNumber = Number(prodCostReais.replace(',', '.')) || 0;
      const priceNumber = Number(prodPriceReais.replace(',', '.')) || 0;
      const costPriceCents = Math.max(0, Math.round(costNumber * 100));
      const basePriceCents = Math.round(priceNumber * 100);

      const payload: Record<string, unknown> = {
        ...(studioMode === 'ADD_COLOR_TO_EXISTING'
          ? { existingProductId: varProductId }
          : {
              categoryId: prodCategoryId,
              name: prodName,
              slug: prodSlug || slugifyText(prodName),
              shortDescription: prodShortDesc,
              fullDescription: prodFullDesc || null,
              material: prodMaterial || null,
              costPriceCents,
              basePriceCents,
              status: prodStatus,
              isFeatured: true,
              weightKg: Number(prodWeightKg),
              heightCm: Number(prodHeightCm),
              widthCm: Number(prodWidthCm),
              lengthCm: Number(prodLengthCm),
            }),
        unifiedVariant: {
          colorName: colorNameClean,
          colorHex: varColorHex,
          modelName: varModelName || 'Padrão',
          sizes: sizesToCreate,
          sizeLabel: sizesToCreate[0],
          skuCode: varSkuCode || undefined,
          skuPrefix: varSkuCode || undefined,
          supplyMode: varSupplyMode,
          prepDays:
            varSupplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' ? Number(varPrepDays) : undefined,
          initialStockOnHand: varSupplyMode === 'IN_STOCK' ? Number(varInitialStock) : 0,
          imageUrl: imgUrl.trim() || undefined,
          imageAlt:
            imgAlt.trim() ||
            `${prodName || 'Modelo STILLUS ALBAN'} na cor ${colorNameClean}`,
          images:
            colorPhotos.length > 0
              ? colorPhotos.map((p) => ({ url: p.url, altText: p.altText }))
              : undefined,
        },
      };

      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: data.error || 'Erro ao publicar cadastro unificado.' });
        return;
      }

      const skusCreatedCount = Array.isArray(data.createdVariants)
        ? data.createdVariants.length
        : 0;
      const hasPhoto = Boolean(data.attachedImage);

      setFeedback({
        type: 'ok',
        text:
          studioMode === 'NEW_PRODUCT'
            ? `Cadastro Unificado concluído! Modelo "${data.product.name}" publicado com a cor "${colorNameClean}", ${skusCreatedCount} numeração(ões)${
                hasPhoto ? ' e foto vinculada' : ''
              }!`
            : `Nova cor "${colorNameClean}" com ${skusCreatedCount} numeração(ões)${
                hasPhoto ? ' e foto' : ''
              } adicionada ao modelo "${data.product.name}"!`,
      });

      if (studioMode === 'NEW_PRODUCT') {
        setProdName('');
        setProdSlug('');
        setProdShortDesc('');
        setProdFullDesc('');
        setProdMaterial('');
        setProdCostReais('');
        setProdPriceReais('');
      }
      setVarProductId(data.product.id);
      setImgProductId(data.product.id);
      setVarSkuCode('');
      setVarSizeLabel('');
      setSelectedBatchSizes([]);
      setImgUrl('');
      setImgAlt('');
      setColorPhotos([]);
      router.refresh();
    } catch {
      setFeedback({ type: 'err', text: 'Erro de comunicação ao salvar o cadastro unificado.' });
    } finally {
      setSubmittingUnified(false);
    }
  }

  async function handleQuickToggleProductStatus(prod: ProductDTO) {
    const nextStatus = prod.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE';
    const res = await fetch('/api/admin/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: prod.id, status: nextStatus }),
    });
    if (res.ok) {
      setFeedback({
        type: 'ok',
        text: `Status de "${prod.name}" alterado para ${nextStatus === 'ACTIVE' ? 'Ativo' : 'Rascunho'}.`,
      });
      router.refresh();
    }
  }

  async function handleDeleteProduct(prod: ProductDTO) {
    const res = await fetch(`/api/admin/products?id=${encodeURIComponent(prod.id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setFeedback({ type: 'ok', text: `Modelo "${prod.name}" removido do catálogo.` });
      router.refresh();
    }
  }

  async function handleQuickToggleVariantMode(variant: VariantDTO) {
    const nextMode =
      variant.supplyMode === 'IN_STOCK' ? 'MADE_TO_ORDER_CONFIRMED_LEAD' : 'IN_STOCK';
    const res = await fetch('/api/admin/variants', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: variant.id,
        supplyMode: nextMode,
        prepDays: nextMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' ? 5 : 0,
      }),
    });
    if (res.ok) {
      setFeedback({
        type: 'ok',
        text: `SKU ${variant.skuCode} alterada para ${
          nextMode === 'IN_STOCK' ? 'Pronta Entrega' : 'Sob Encomenda (5 dias)'
        }.`,
      });
      router.refresh();
    }
  }

  async function handleDeleteVariant(variant: VariantDTO) {
    const res = await fetch(`/api/admin/variants?id=${encodeURIComponent(variant.id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setFeedback({ type: 'ok', text: `SKU ${variant.skuCode} excluída.` });
      router.refresh();
    }
  }

  // ============================================================================
  // AÇÕES: GESTÃO COMPLETA DE CATEGORIAS
  // ============================================================================
  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    setCatSubmitting(true);
    setFeedback(null);

    try {
      const payload = {
        id: editingCategoryId || undefined,
        name: catName,
        slug: catSlug || undefined,
        description: catDesc || null,
        displayOrder: Number(catOrder) || 0,
        isActive: catIsActive,
        defaultWeightKg: Number(catWeightKg) || 0.6,
        defaultHeightCm: Number(catHeightCm) || 15,
        defaultWidthCm: Number(catWidthCm) || 25,
        defaultLengthCm: Number(catLengthCm) || 30,
      };

      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: data.error || 'Erro ao salvar categoria.' });
        return;
      }

      setFeedback({
        type: 'ok',
        text: editingCategoryId
          ? `Categoria "${data.category.name}" atualizada com sucesso.`
          : `Categoria "${data.category.name}" criada com sucesso.`,
      });

      if (editingCategoryId) {
        setCategoriesList((prev) =>
          prev.map((c) => (c.id === editingCategoryId ? { ...c, ...data.category } : c))
        );
      } else {
        setCategoriesList((prev) => [...prev, data.category]);
        if (!prodCategoryId) {
          setProdCategoryId(data.category.id);
        }
      }

      handleCancelCategoryEdit();
      router.refresh();
    } catch {
      setFeedback({ type: 'err', text: 'Falha de conexão ao salvar categoria.' });
    } finally {
      setCatSubmitting(false);
    }
  }

  function handleStartCategoryEdit(cat: CategoryDTO) {
    setEditingCategoryId(cat.id);
    setCatName(cat.name);
    setCatSlug(cat.slug);
    setCatDesc(cat.description || '');
    setCatOrder(String(cat.displayOrder ?? 0));
    setCatIsActive(cat.isActive ?? true);
    setCatWeightKg(String(cat.defaultWeightKg));
    setCatHeightCm(String(cat.defaultHeightCm));
    setCatWidthCm(String(cat.defaultWidthCm));
    setCatLengthCm(String(cat.defaultLengthCm));
    setActiveTab('categorias');
    window.scrollTo({ top: 300, behavior: 'smooth' });
  }

  function handleCancelCategoryEdit() {
    setEditingCategoryId(null);
    setCatName('');
    setCatSlug('');
    setCatDesc('');
    setCatOrder('0');
    setCatIsActive(true);
    setCatWeightKg('0.6');
    setCatHeightCm('15');
    setCatWidthCm('25');
    setCatLengthCm('30');
  }

  async function handleToggleCategoryActive(cat: CategoryDTO) {
    setFeedback(null);
    try {
      const nextActive = !cat.isActive;
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          isActive: nextActive,
          defaultWeightKg: cat.defaultWeightKg,
          defaultHeightCm: cat.defaultHeightCm,
          defaultWidthCm: cat.defaultWidthCm,
          defaultLengthCm: cat.defaultLengthCm,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: data.error || 'Erro ao alterar status da categoria.' });
        return;
      }
      setCategoriesList((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, isActive: nextActive } : c))
      );
      setFeedback({
        type: 'ok',
        text: `Categoria "${cat.name}" agora está ${nextActive ? 'Ativa' : 'Inativa'} na loja.`,
      });
      router.refresh();
    } catch {
      setFeedback({ type: 'err', text: 'Erro ao conectar à API.' });
    }
  }

  async function handleDeleteCategory(cat: CategoryDTO) {
    if (!confirm(`Deseja realmente excluir ou desativar a categoria "${cat.name}"?`)) return;
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/categories?id=${encodeURIComponent(cat.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: data.error || 'Erro ao excluir categoria.' });
        return;
      }
      if (data.category) {
        setCategoriesList((prev) =>
          prev.map((c) => (c.id === cat.id ? { ...c, isActive: false } : c))
        );
      } else {
        setCategoriesList((prev) => prev.filter((c) => c.id !== cat.id));
      }
      setFeedback({ type: 'ok', text: data.message });
      router.refresh();
    } catch {
      setFeedback({ type: 'err', text: 'Erro ao conectar à API.' });
    }
  }

  // ============================================================================
  // AÇÕES DO MÓDULO 4: LISTAS DE PEDIDOS AO FORNECEDOR & CONFIGURAÇÃO MARKUP
  // ============================================================================
  async function handleSaveMarkupSettings(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const res = await fetch('/api/admin/purchase-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_SETTINGS',
        defaultMarkupPercent: markupPercent,
        pixDiscountPercent,
        gatewayPixFeePercent,
        gatewayCardFeePercent,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: 'err', text: data.error || 'Erro ao salvar configurações.' });
      return;
    }
    setFeedback({
      type: 'ok',
      text: `Configurações salvas: Markup padrão de ${data.settings.defaultMarkupPercent}%, Desconto PIX de ${data.settings.pixDiscountPercent}%, Taxa PIX MP de ${data.settings.gatewayPixFeePercent}% e Taxa Cartão MP de ${data.settings.gatewayCardFeePercent}%.`,
    });
    router.refresh();
  }

  async function handleCreatePurchaseList(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const res = await fetch('/api/admin/purchase-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newListTitle,
        supplierName: newListSupplier || null,
        minOrderQuantity: Number(newListMinQty) || 10,
        notes: newListNotes || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: 'err', text: data.error || 'Erro ao criar lista de pedido.' });
      return;
    }
    setSelectedListId(data.purchaseList.id);
    setNewListTitle('');
    setNewListSupplier('');
    setNewListNotes('');
    setFeedback({
      type: 'ok',
      text: `Lista de pedido "${data.purchaseList.title}" criada com regra mínima de ${data.purchaseList.minOrderQuantity} peças.`,
    });
    router.refresh();
  }

  const allCatalogVariantsWithProduct = useMemo(
    () =>
      initialProducts.flatMap((prod) =>
        prod.variants.map((v) => ({
          variant: v,
          product: prod,
        }))
      ),
    [initialProducts]
  );

  async function handleAddSkuToPurchaseList(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!selectedListId) {
      setFeedback({ type: 'err', text: 'Selecione ou crie uma Lista de Pedido primeiro.' });
      return;
    }

    const found = allCatalogVariantsWithProduct.find((x) => x.variant.id === orderItemVariantId);
    if (!found) {
      setFeedback({ type: 'err', text: 'Selecione um modelo/numeração do catálogo.' });
      return;
    }

    const unitCostCents =
      found.product.costPriceCents && found.product.costPriceCents > 0
        ? found.product.costPriceCents
        : Math.round(found.product.basePriceCents / (1 + markupPercent / 100));
    const unitSalePriceCents =
      found.variant.priceOverrideCents ?? found.product.basePriceCents;

    const res = await fetch('/api/admin/purchase-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ADD_ITEM',
        purchaseListId: selectedListId,
        productId: found.product.id,
        variantId: found.variant.id,
        productName: found.product.name,
        skuCode: found.variant.skuCode,
        colorName: found.variant.colorName,
        sizeLabel: found.variant.sizeLabel,
        quantity: Number(orderItemQuantity) || 1,
        unitCostCents,
        unitSalePriceCents,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: 'err', text: data.error || 'Erro ao adicionar item à lista.' });
      return;
    }

    setFeedback({
      type: 'ok',
      text: `Item "${found.product.name} (${found.variant.colorName} • Tam ${found.variant.sizeLabel})" adicionado à Lista de Pedido!`,
    });
    router.refresh();
  }

  async function handleUpdatePurchaseItemQuantity(itemId: string, nextQty: number) {
    if (nextQty < 1) return;
    await fetch('/api/admin/purchase-lists', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, quantity: nextQty }),
    });
    router.refresh();
  }

  async function handleRemovePurchaseItem(itemId: string) {
    await fetch(`/api/admin/purchase-lists?itemId=${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
    });
    router.refresh();
  }

  async function handleStockAdjustment(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const res = await fetch('/api/admin/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variantId: adjVariantId,
        quantityDelta: Number(adjDelta),
        movementType: 'MANUAL_ADJUSTMENT',
        reason: adjReason,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: 'err', text: data.error || 'Falha no ajuste de estoque.' });
      return;
    }

    setFeedback({
      type: 'ok',
      text: `Estoque da SKU ${data.variant.skuCode} atualizado para ${data.variant.stockOnHand} unidade(s).`,
    });
    setAdjReason('');
    router.refresh();
  }

  const allInStockVariants = initialProducts.flatMap((p) =>
    p.variants
      .filter((v) => v.supplyMode === 'IN_STOCK')
      .map((v) => ({ ...v, productName: p.name }))
  );

  const activePurchaseList =
    initialPurchaseLists.find((l) => l.id === selectedListId) || initialPurchaseLists[0] || null;

  const activePurchaseEvaluation = useMemo(() => {
    if (!activePurchaseList) return null;
    return evaluatePurchaseListMetrics({
      title: activePurchaseList.title,
      supplierName: activePurchaseList.supplierName,
      minOrderQuantity: activePurchaseList.minOrderQuantity,
      items: activePurchaseList.items,
      pixDiscountPercent,
      gatewayPixFeePercent,
      gatewayCardFeePercent,
    });
  }, [activePurchaseList, pixDiscountPercent, gatewayPixFeePercent, gatewayCardFeePercent]);

  const executiveKpis = useMemo(() => {
    const activeModels = initialProducts.filter((p) => p.status === 'ACTIVE').length;
    let totalSkus = 0;
    let totalUnitsInStock = 0;
    let sumPixMargin = 0;

    for (const p of initialProducts) {
      totalSkus += p.variants.length;
      for (const v of p.variants) {
        if (v.supplyMode === 'IN_STOCK') {
          totalUnitsInStock += Math.max(0, v.stockOnHand - v.stockReserved);
        }
      }
      const cost =
        p.costPriceCents && p.costPriceCents > 0
          ? p.costPriceCents
          : Math.round(p.basePriceCents / (1 + markupPercent / 100));
      const m = calculateProductMarginMetrics({
        costCents: cost,
        salePriceCents: p.basePriceCents,
        pixDiscountPercent,
      });
      sumPixMargin += m.pixMarginPercent;
    }

    const avgPixMargin =
      initialProducts.length > 0 ? (sumPixMargin / initialProducts.length).toFixed(1) : '0.0';

    return {
      activeModels,
      totalModels: initialProducts.length,
      totalSkus,
      totalUnitsInStock,
      avgPixMargin,
    };
  }, [initialProducts, markupPercent, pixDiscountPercent]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F4]">
      {/* Topbar Administrativa */}
      <header className="border-b border-[#262626] bg-[#141414]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-[#C5A059] block">
              Gestão de Catálogo, Estoque &amp; Compras
            </span>
            <h1 className="text-xl font-serif tracking-[0.15em] text-[#D4AF37] font-semibold">
              STILLUS ALBAN — ADMINISTRAÇÃO
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <Link
              href="/admin/pedidos"
              className="min-h-[38px] inline-flex items-center px-3 py-1.5 rounded-lg border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-[#F5F5F4]"
            >
              Pedidos
            </Link>
            <Link
              href="/admin/entregas"
              className="min-h-[38px] inline-flex items-center px-3 py-1.5 rounded-lg border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-[#F5F5F4]"
            >
              Entregas
            </Link>
            <Link
              href="/admin/sistema"
              className="min-h-[38px] inline-flex items-center px-3 py-1.5 rounded-lg border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-[#F5F5F4]"
            >
              Auditoria
            </Link>
            <Link
              href="/"
              className="min-h-[38px] inline-flex items-center px-3.5 py-1.5 rounded-lg bg-[#D4AF37] text-[#0A0A0A] font-bold hover:bg-[#E5C453] transition"
            >
              Ver Loja →
            </Link>
            <span className="text-[#A8A29E] hidden xl:inline">
              {adminEmail}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-[#F5F5F4] cursor-pointer"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Barra Executiva de Indicadores (KPIs do Catálogo & Rentabilidade) */}
        <section
          aria-label="Resumo executivo do catálogo"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3.5"
        >
          <div className="rounded-xl border border-[#262626] bg-[#141414] p-4 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#A8A29E] block">
              Modelos no Showroom
            </span>
            <strong className="text-xl text-[#F5F5F4] font-bold tabular-nums">
              {executiveKpis.activeModels} ativos{' '}
              <span className="text-xs font-normal text-[#A8A29E]">
                (de {executiveKpis.totalModels})
              </span>
            </strong>
          </div>

          <div className="rounded-xl border border-[#262626] bg-[#141414] p-4 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#A8A29E] block">
              Grade de Numerações &amp; Estoque
            </span>
            <strong className="text-xl text-[#D4AF37] font-bold tabular-nums">
              {executiveKpis.totalSkus} SKUs{' '}
              <span className="text-xs font-normal text-[#10B981]">
                ({executiveKpis.totalUnitsInStock} un. pronta entrega)
              </span>
            </strong>
          </div>

          <div className="rounded-xl border border-[#10B981]/30 bg-[#141414] p-4 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#10B981] block">
              Margem Média Líquida (PIX)
            </span>
            <strong className="text-xl text-[#10B981] font-bold tabular-nums">
              {executiveKpis.avgPixMargin}%{' '}
              <span className="text-xs font-normal text-[#A8A29E]">
                (após -{pixDiscountPercent}% OFF)
              </span>
            </strong>
          </div>

          <div className="rounded-xl border border-[#D4AF37]/30 bg-[#141414] p-4 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#C5A059] block">
              Próximo Pedido Fornecedor
            </span>
            <strong className="text-xl text-[#F5F5F4] font-bold tabular-nums">
              {activePurchaseEvaluation
                ? `${activePurchaseEvaluation.totalUnits}/${activePurchaseEvaluation.minOrderQuantity} peças`
                : 'Nenhuma lista'}
            </strong>
          </div>
        </section>

        {/* Abas Principais do Painel */}
        <div className="flex flex-wrap gap-3 border-b border-[#262626] pb-4">
          <button
            type="button"
            onClick={() => setActiveTab('estudio')}
            className={`min-h-[44px] px-5 py-2.5 rounded-lg text-sm font-semibold transition cursor-pointer ${
              activeTab === 'estudio'
                ? 'bg-[#D4AF37] text-[#0A0A0A]'
                : 'bg-[#141414] text-[#F5F5F4] border border-[#262626]'
            }`}
          >
            1. Catálogo &amp; Cadastro ({initialProducts.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pedidos_fornecedor')}
            className={`min-h-[44px] px-5 py-2.5 rounded-lg text-sm font-semibold transition cursor-pointer ${
              activeTab === 'pedidos_fornecedor'
                ? 'bg-[#D4AF37] text-[#0A0A0A]'
                : 'bg-[#141414] text-[#F5F5F4] border border-[#262626]'
            }`}
          >
            2. Pedidos ao Fornecedor ({initialPurchaseLists.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('config_estoque')}
            className={`min-h-[44px] px-5 py-2.5 rounded-lg text-sm font-semibold transition cursor-pointer ${
              activeTab === 'config_estoque'
                ? 'bg-[#D4AF37] text-[#0A0A0A]'
                : 'bg-[#141414] text-[#F5F5F4] border border-[#262626]'
            }`}
          >
            3. Configurações &amp; Estoque
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('categorias')}
            className={`min-h-[44px] px-5 py-2.5 rounded-lg text-sm font-semibold transition cursor-pointer ${
              activeTab === 'categorias'
                ? 'bg-[#D4AF37] text-[#0A0A0A]'
                : 'bg-[#141414] text-[#F5F5F4] border border-[#262626]'
            }`}
          >
            4. Categorias &amp; Frete ({categoriesList.length})
          </button>
        </div>

        {feedback && (
          <div
            role="alert"
            className={`rounded-lg border p-4 text-sm ${
              feedback.type === 'ok'
                ? 'border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981]'
                : 'border-[#EF4444]/50 bg-[#EF4444]/10 text-[#EF4444]'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {activeTab === 'estudio' && (
          <div className="space-y-8">
            {/* Assistente de Cadastro */}
            <section className="rounded-2xl border border-[#D4AF37]/50 bg-gradient-to-r from-[#171510] via-[#121212] to-[#0E0E0E] p-5 sm:p-6 space-y-4 shadow-xl">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#D4AF37] font-semibold">
                    ✦ Assistente de Copywriting &amp; Precificação
                  </span>
                  <h2 className="text-lg font-serif text-[#F5F5F4] font-semibold">
                    Preenchimento Inteligente com Cálculo de Markup (+{markupPercent}%)
                  </h2>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
                <div className="lg:col-span-3">
                  <label htmlFor="ai-notes" className="block text-xs text-[#A8A29E] mb-1">
                    Resumo da peça (modelo, cor, custo e numerações):
                  </label>
                  <input
                    id="ai-notes"
                    type="text"
                    value={aiRawNotes}
                    onChange={(e) => setAiRawNotes(e.target.value)}
                    placeholder="Ex.: Sandália salto bloco dourada couro, custo R$ 135, tam 35 ao 38"
                    className="w-full min-h-[44px] rounded-lg border border-[#D4AF37]/40 bg-[#0A0A0A] px-3.5 text-sm text-[#F5F5F4]"
                  />
                </div>
                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={handleGenerateWithAI}
                  className="min-h-[44px] px-5 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-bold text-xs sm:text-sm transition cursor-pointer shadow-lg"
                >
                  {aiLoading ? 'Preenchendo...' : '✨ Preencher com IA'}
                </button>
              </div>

              {aiSocialCaption && (
                <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#D4AF37]">
                      📲 Legenda para Divulgação (Instagram &amp; WhatsApp):
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(aiSocialCaption);
                        setFeedback({
                          type: 'ok',
                          text: 'Legenda copiada para a área de transferência.',
                        });
                      }}
                      className="px-3 py-1 rounded border border-[#D4AF37] text-xs text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#0A0A0A] cursor-pointer"
                    >
                      Copiar Legenda
                    </button>
                  </div>
                  <pre className="text-xs text-[#A8A29E] whitespace-pre-wrap font-sans">
                    {aiSocialCaption}
                  </pre>
                  {aiNotice && <p className="text-[11px] text-[#C5A059]">{aiNotice}</p>}
                </div>
              )}
            </section>

            {/* CADASTRO UNIFICADO (Modelo + Custo/Markup + Foto + Cores/Numerações) */}
            <form
              onSubmit={handleUnifiedCatalogSubmit}
              className="rounded-2xl border border-[#D4AF37]/40 bg-[#141414] p-6 space-y-6 shadow-xl"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262626] pb-4">
                <div>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#C5A059] font-semibold">
                    Cadastro de Produto
                  </span>
                  <h2 className="text-lg font-serif text-[#D4AF37] font-semibold">
                    Dados do Produto, Fotos e Tamanhos
                  </h2>
                </div>

                {/* Alternador Rápido: Criar Novo Produto vs Adicionar Nova Cor */}
                <div className="inline-flex rounded-xl border border-[#262626] bg-[#0A0A0A] p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setStudioMode('NEW_PRODUCT')}
                    className={`px-3.5 py-2 rounded-lg font-semibold transition cursor-pointer ${
                      studioMode === 'NEW_PRODUCT'
                        ? 'bg-[#D4AF37] text-[#0A0A0A]'
                        : 'text-[#A8A29E] hover:text-[#F5F5F4]'
                    }`}
                  >
                    + Cadastrar Novo Produto
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudioMode('ADD_COLOR_TO_EXISTING')}
                    className={`px-3.5 py-2 rounded-lg font-semibold transition cursor-pointer ${
                      studioMode === 'ADD_COLOR_TO_EXISTING'
                        ? 'bg-[#D4AF37] text-[#0A0A0A]'
                        : 'text-[#A8A29E] hover:text-[#F5F5F4]'
                    }`}
                  >
                    + Adicionar Cor a Produto Existente
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Coluna 1 (5 cols): Dados do Produto + Custo + Markup */}
                <div className="lg:col-span-5 rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-[#D4AF37] border-b border-[#262626] pb-2">
                    1. Identificação do Produto &amp; Precificação
                  </h3>

                  {studioMode === 'ADD_COLOR_TO_EXISTING' ? (
                    <div className="space-y-3">
                      <label htmlFor="var-prod" className="block text-xs text-[#A8A29E]">
                        Selecione o Produto já Cadastrado *
                      </label>
                      <select
                        id="var-prod"
                        required
                        value={varProductId}
                        onChange={(e) => {
                          setVarProductId(e.target.value);
                          setImgProductId(e.target.value);
                        }}
                        className="w-full min-h-[42px] rounded-lg border border-[#D4AF37]/50 bg-[#141414] px-3 text-sm text-[#F5F5F4]"
                      >
                        <option value="">Selecione um produto...</option>
                        {initialProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({formatBRL(p.basePriceCents)})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-[#A8A29E]">
                        Ao salvar, a nova cor, a foto enviada e todas as numerações marcadas ao lado serão adicionadas diretamente a este modelo.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label htmlFor="prod-cat" className="block text-xs text-[#A8A29E]">
                              Categoria *
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                handleCancelCategoryEdit();
                                setActiveTab('categorias');
                              }}
                              className="text-[11px] text-[#D4AF37] hover:underline cursor-pointer"
                            >
                              + Criar Categoria
                            </button>
                          </div>
                          <select
                            id="prod-cat"
                            value={prodCategoryId}
                            onChange={(e) => {
                              const cat = categoriesList.find((c) => c.id === e.target.value);
                              setProdCategoryId(e.target.value);
                              if (cat) {
                                setProdWeightKg(String(cat.defaultWeightKg));
                                setProdHeightCm(String(cat.defaultHeightCm));
                                setProdWidthCm(String(cat.defaultWidthCm));
                                setProdLengthCm(String(cat.defaultLengthCm));
                              }
                            }}
                            className="w-full min-h-[40px] rounded border border-[#262626] bg-[#141414] px-3 text-xs"
                          >
                            {categoriesList.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} {c.isActive === false ? '(Inativa)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor="prod-status" className="block text-xs text-[#A8A29E] mb-1">
                            Visibilidade *
                          </label>
                          <select
                            id="prod-status"
                            value={prodStatus}
                            onChange={(e) => setProdStatus(e.target.value as 'ACTIVE' | 'DRAFT')}
                            className="w-full min-h-[40px] rounded border border-[#262626] bg-[#141414] px-3 text-xs"
                          >
                            <option value="ACTIVE">Ativo no Catálogo</option>
                            <option value="DRAFT">Rascunho (Oculto)</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="prod-name" className="block text-xs text-[#A8A29E] mb-1">
                          Nome do Modelo *
                        </label>
                        <input
                          id="prod-name"
                          type="text"
                          required={studioMode === 'NEW_PRODUCT'}
                          value={prodName}
                          onChange={(e) => {
                            setProdName(e.target.value);
                            setProdSlug(slugifyText(e.target.value));
                          }}
                          className="w-full min-h-[42px] rounded border border-[#262626] bg-[#141414] px-3 text-sm"
                          placeholder="Ex.: Sandália Salto Bloco Aurum"
                        />
                      </div>

                      {/* Custo, Markup 120% e Preço de Venda */}
                      <div className="rounded-lg border border-[#D4AF37]/30 bg-[#141414] p-3 space-y-2.5">
                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label htmlFor="prod-cost" className="block text-[11px] text-[#C5A059] mb-1">
                              Valor de Custo (R$)
                            </label>
                            <input
                              id="prod-cost"
                              type="text"
                              value={prodCostReais}
                              onChange={(e) => setProdCostReais(e.target.value)}
                              className="w-full min-h-[38px] rounded border border-[#262626] bg-[#0A0A0A] px-2.5 text-sm tabular-nums"
                              placeholder="150,00"
                            />
                          </div>

                          <div>
                            <label htmlFor="prod-price" className="block text-[11px] text-[#D4AF37] mb-1">
                              Valor de Venda (R$) *
                            </label>
                            <input
                              id="prod-price"
                              type="text"
                              required={studioMode === 'NEW_PRODUCT'}
                              value={prodPriceReais}
                              onChange={(e) => setProdPriceReais(e.target.value)}
                              className="w-full min-h-[38px] rounded border border-[#D4AF37]/60 bg-[#0A0A0A] px-2.5 text-sm font-bold text-[#D4AF37] tabular-nums"
                              placeholder="330,00"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleApplyDefaultMarkup}
                          className="w-full py-1.5 px-3 rounded border border-[#D4AF37]/50 bg-[#D4AF37]/15 hover:bg-[#D4AF37]/25 text-xs text-[#D4AF37] font-semibold cursor-pointer transition"
                        >
                          ⚡ Calcular Venda com Markup (+{markupPercent}% + taxa cartão {gatewayCardFeePercent}%)
                        </button>

                        {formMarginPreview.salePriceCents > 0 && (
                          <div className="text-[11px] space-y-1.5 pt-2 border-t border-[#262626] text-[#A8A29E] tabular-nums">
                            <div className="flex justify-between items-center">
                              <span>Lucro Líq. Cartão (-{gatewayCardFeePercent}% MP):</span>
                              <strong className="text-[#F5F5F4]">
                                {formatBRL(formMarginPreview.cardNetProfitCents)} ({formMarginPreview.cardNetMarginPercent}%)
                              </strong>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>Lucro Líq. PIX (-{pixDiscountPercent}% desc | -{gatewayPixFeePercent}% MP):</span>
                              <strong
                                className={
                                 formMarginPreview.pixNetProfitCents > 0
                                   ? 'text-[#10B981]'
                                   : 'text-[#EF4444]'
                                }
                              >
                                {formatBRL(formMarginPreview.pixNetProfitCents)} ({formMarginPreview.pixNetMarginPercent}%)
                              </strong>
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <label htmlFor="prod-desc" className="block text-xs text-[#A8A29E] mb-1">
                          Descrição Curta Persuasiva *
                        </label>
                        <input
                          id="prod-desc"
                          type="text"
                          required={studioMode === 'NEW_PRODUCT'}
                          value={prodShortDesc}
                          onChange={(e) => setProdShortDesc(e.target.value)}
                          className="w-full min-h-[40px] rounded border border-[#262626] bg-[#141414] px-3 text-xs"
                          placeholder="Couro legítimo, salto bloco estável e metais dourados"
                        />
                      </div>

                      <div>
                        <label htmlFor="prod-material" className="block text-xs text-[#A8A29E] mb-1">
                          Material / Especificação
                        </label>
                        <input
                          id="prod-material"
                          type="text"
                          value={prodMaterial}
                          onChange={(e) => setProdMaterial(e.target.value)}
                          className="w-full min-h-[38px] rounded border border-[#262626] bg-[#141414] px-3 text-xs"
                          placeholder="Couro legítimo e ferragens em banho ouro"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Coluna 2 (7 cols): Cor + Upload da Foto + Seleção de Numerações e Estoque */}
                <div className="lg:col-span-7 rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-[#D4AF37] border-b border-[#262626] pb-2">
                      2. Cor, Foto da Peça &amp; Grade de Numerações
                    </h3>

                    {/* Cor + Seletor de Tom + Upload Direto da Foto */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                      <div className="sm:col-span-5 space-y-1">
                        <label htmlFor="var-color" className="block text-xs text-[#A8A29E]">
                          Nome da Cor *
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="var-color"
                            type="text"
                            required
                            value={varColorName}
                            onChange={(e) => {
                              setVarColorName(e.target.value);
                              setImgColorName(e.target.value);
                            }}
                            className="w-full min-h-[40px] rounded border border-[#262626] bg-[#141414] px-3 text-xs"
                            placeholder="Ex.: Preto Ônix, Dourado"
                          />
                          <input
                            id="var-hex"
                            type="color"
                            title="Escolher tom da cor"
                            value={varColorHex}
                            onChange={(e) => setVarColorHex(e.target.value)}
                            className="w-10 h-[40px] rounded border border-[#262626] bg-[#141414] p-1 cursor-pointer shrink-0"
                          />
                        </div>
                      </div>

                      <div className="sm:col-span-7 space-y-1">
                        <label
                          htmlFor="img-file-upload"
                          className="block text-xs text-[#D4AF37] font-semibold"
                        >
                          📷 Foto(s) desta Cor (Selecione 1 ou mais do aparelho ou cole URL):
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="img-file-upload"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleFileUpload}
                            className="w-full text-xs text-[#A8A29E] file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-bold file:bg-[#D4AF37] file:text-[#0A0A0A] cursor-pointer"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            id="img-url"
                            type="text"
                            value={imgUrl}
                            onChange={(e) => setImgUrl(e.target.value)}
                            className="w-full min-h-[34px] rounded border border-[#262626] bg-[#141414] px-2.5 text-xs text-[#A8A29E] mt-1"
                            placeholder={
                              uploadingPhoto
                                ? 'Enviando foto...'
                                : 'Caminho preenchido no upload (ou cole URL da foto)'
                            }
                          />
                          {imgUrl && !colorPhotos.some((p) => p.url === imgUrl) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!imgUrl.trim()) return;
                                setColorPhotos((prev) => [
                                  ...prev,
                                  {
                                    url: imgUrl.trim(),
                                    altText: `Foto ${prodName || 'produto'} ${varColorName || ''} ${colorPhotos.length + 1}`.trim(),
                                  },
                                ]);
                                setImgUrl('');
                              }}
                              className="mt-1 px-3 py-1 bg-[#262626] hover:bg-[#D4AF37] hover:text-[#0A0A0A] text-xs text-[#F5F5F4] rounded font-semibold transition shrink-0"
                            >
                              + Anexar URL
                            </button>
                          )}
                        </div>

                        {/* Miniaturas das fotos anexadas para esta cor */}
                        {colorPhotos.length > 0 && (
                          <div className="pt-2">
                            <span className="text-[11px] text-[#A8A29E] block mb-1.5 font-medium">
                              {colorPhotos.length} foto(s) anexada(s) para a cor &quot;{varColorName || 'selecionada'}&quot;:
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {colorPhotos.map((photo, pIdx) => (
                                <div
                                  key={pIdx}
                                  className="relative group w-14 h-14 rounded-lg overflow-hidden border border-[#D4AF37]/50 bg-[#141414] shrink-0"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={photo.url}
                                    alt={photo.altText || ''}
                                    className="w-full h-full object-cover"
                                  />
                                  {pIdx === 0 && (
                                    <span className="absolute bottom-0 inset-x-0 bg-[#D4AF37] text-[#0A0A0A] text-[9px] font-bold text-center leading-none py-0.5">
                                      Capa
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setColorPhotos((prev) => prev.filter((_, idx) => idx !== pIdx));
                                      if (pIdx === 0 && colorPhotos[1]) {
                                        setImgUrl(colorPhotos[1].url);
                                      } else if (colorPhotos.length === 1) {
                                        setImgUrl('');
                                      }
                                    }}
                                    className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-600/90 hover:bg-red-600 text-white rounded text-[10px] flex items-center justify-center font-bold"
                                    title="Remover foto"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Grade de Numerações em 1 Clique */}
                    <div className="rounded-lg border border-[#262626] bg-[#141414] p-3.5 space-y-2.5">
                      <span className="text-xs text-[#C5A059] font-semibold block">
                        Selecione todas as Numerações / Tamanhos disponíveis nesta cor:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {[...PRESET_SHOE_SIZES, ...PRESET_BAG_SIZES].map((sz) => {
                          const active = selectedBatchSizes.includes(sz);
                          return (
                            <button
                              key={sz}
                              type="button"
                              onClick={() => toggleBatchSize(sz)}
                              className={`min-w-[38px] min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                                active
                                  ? 'border-[#D4AF37] bg-[#D4AF37] text-[#0A0A0A] shadow'
                                  : 'border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] hover:border-[#D4AF37]'
                              }`}
                            >
                              {active ? `✓ ${sz}` : sz}
                            </button>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                        <div>
                          <label htmlFor="var-size" className="block text-[11px] text-[#A8A29E] mb-1">
                            Numerações Selecionadas (ou digite outra):
                          </label>
                          <input
                            id="var-size"
                            type="text"
                            value={varSizeLabel}
                            onChange={(e) => setVarSizeLabel(e.target.value)}
                            className="w-full min-h-[36px] rounded border border-[#262626] bg-[#0A0A0A] px-2.5 text-xs"
                            placeholder={
                              selectedBatchSizes.length > 0
                                ? `Selecionados: ${selectedBatchSizes.join(', ')}`
                                : 'Padrão: Único (ou marque acima)'
                            }
                          />
                        </div>

                        <div>
                          <label htmlFor="var-sku" className="block text-[11px] text-[#A8A29E] mb-1">
                            Prefixo ou Código SKU (Opcional — gerado automático)
                          </label>
                          <input
                            id="var-sku"
                            type="text"
                            value={varSkuCode}
                            onChange={(e) => setVarSkuCode(e.target.value)}
                            className="w-full min-h-[36px] rounded border border-[#262626] bg-[#0A0A0A] px-2.5 text-xs"
                            placeholder="Automático (ex.: SA-SAND-DOU-36)"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Disponibilidade: Pronta Entrega vs Encomenda */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="var-mode" className="block text-xs text-[#A8A29E] mb-1">
                          Modalidade de Fornecimento *
                        </label>
                        <select
                          id="var-mode"
                          value={varSupplyMode}
                          onChange={(e) => setVarSupplyMode(e.target.value as typeof varSupplyMode)}
                          className="w-full min-h-[40px] rounded border border-[#262626] bg-[#141414] px-3 text-xs"
                        >
                          <option value="IN_STOCK">Pronta Entrega (Estoque Próprio)</option>
                          <option value="MADE_TO_ORDER_CONFIRMED_LEAD">
                            Sob Encomenda (Prazo Confirmado)
                          </option>
                          <option value="MADE_TO_ORDER_TBD_LEAD">
                            Sob Encomenda (Prazo a Confirmar)
                          </option>
                        </select>
                      </div>

                      {varSupplyMode === 'IN_STOCK' ? (
                        <div>
                          <label htmlFor="var-stock" className="block text-xs text-[#A8A29E] mb-1">
                            Qtd. em Estoque (para cada numeração marcada) *
                          </label>
                          <input
                            id="var-stock"
                            type="number"
                            min="0"
                            required
                            value={varInitialStock}
                            onChange={(e) => setVarInitialStock(e.target.value)}
                            className="w-full min-h-[40px] rounded border border-[#262626] bg-[#141414] px-3 text-xs tabular-nums"
                          />
                        </div>
                      ) : (
                        <div>
                          <label htmlFor="var-prep" className="block text-xs text-[#A8A29E] mb-1">
                            Prazo de Preparação (Dias Úteis) *
                          </label>
                          <input
                            id="var-prep"
                            type="number"
                            min="1"
                            required
                            value={varPrepDays}
                            onChange={(e) => setVarPrepDays(e.target.value)}
                            className="w-full min-h-[40px] rounded border border-[#262626] bg-[#141414] px-3 text-xs tabular-nums"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submittingUnified}
                    className="w-full min-h-[48px] rounded-xl bg-[#D4AF37] hover:bg-[#E5C453] disabled:opacity-50 text-[#0A0A0A] font-bold text-sm cursor-pointer transition shadow-[0_6px_20px_rgba(212,175,55,0.28)]"
                  >
                    {submittingUnified
                      ? 'Publicando...'
                      : studioMode === 'NEW_PRODUCT'
                      ? '✦ Publicar Modelo no Catálogo'
                      : '✦ Adicionar Nova Cor e Numerações'}
                  </button>
                </div>
              </div>
            </form>

            {/* Listagem de Modelos Cadastrados */}
            <section className="rounded-xl border border-[#262626] bg-[#141414] p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[#D4AF37]">
                  Produtos Cadastrados ({initialProducts.length})
                </h2>
              </div>

              {initialProducts.length === 0 ? (
                <p className="text-sm text-[#A8A29E]">Nenhum produto cadastrado ainda.</p>
              ) : (
                <div className="space-y-4">
                  {initialProducts.map((prod) => {
                    const costCents =
                      prod.costPriceCents && prod.costPriceCents > 0
                        ? prod.costPriceCents
                        : Math.round(prod.basePriceCents / (1 + markupPercent / 100));
                    const metrics = calculateProductMarginMetrics({
                      costCents,
                      salePriceCents: prod.basePriceCents,
                      pixDiscountPercent,
                      gatewayPixFeePercent,
                      gatewayCardFeePercent,
                    });
                    const coverImg =
                      prod.images.find((i) => i.isPrimary)?.url || prod.images[0]?.url || null;
                    const distinctColors: string[] = Array.from(
                      new Set([
                        ...prod.variants
                          .map((v) => v.colorName?.trim())
                          .filter((c): c is string => Boolean(c)),
                        ...prod.images
                          .map((img) => img.colorName?.trim())
                          .filter((c): c is string => Boolean(c)),
                      ])
                    );

                    return (
                      <div
                        key={prod.id}
                        className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#262626] pb-3">
                          <div className="flex items-start gap-3.5">
                            {coverImg ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={coverImg}
                                alt={prod.name}
                                className="w-16 h-16 rounded-xl object-cover border border-[#D4AF37]/40 bg-[#141414] shrink-0"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-xl border border-[#262626] bg-[#141414] flex items-center justify-center text-[10px] text-[#A8A29E] shrink-0">
                                Sem foto
                              </div>
                            )}

                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs uppercase text-[#C5A059] font-semibold">
                                  {prod.category.name}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                                    prod.status === 'ACTIVE'
                                      ? 'bg-[#10B981]/20 text-[#10B981]'
                                      : 'bg-[#F59E0B]/20 text-[#F59E0B]'
                                  }`}
                                >
                                  {prod.status === 'ACTIVE' ? 'Ativo na Loja' : 'Oculto (Rascunho)'}
                                </span>
                              </div>
                              <h3 className="text-base font-serif font-semibold text-[#F5F5F4]">
                                {prod.name}
                              </h3>
                              <p className="text-xs text-[#A8A29E] max-w-xl">
                                {prod.shortDescription}
                              </p>
                            </div>
                          </div>

                          {/* Painel de Custo, Venda, Markup e Margem Real no PIX */}
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="rounded-lg border border-[#262626] bg-[#141414] px-3 py-2 text-xs">
                              <span className="text-[#A8A29E] block">Custo Fornecedor</span>
                              <strong className="text-[#F5F5F4]">{formatBRL(costCents)}</strong>
                            </div>
                            <div className="rounded-lg border border-[#262626] bg-[#141414] px-3 py-2 text-xs">
                              <span className="text-[#A8A29E] block">
                                Venda Cartão (+{metrics.appliedMarkupPercent}%)
                              </span>
                              <strong className="text-[#D4AF37]">
                                {formatBRL(prod.basePriceCents)}
                              </strong>
                            </div>
                            <div className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/10 px-3 py-2 text-xs">
                              <span className="text-[#10B981] block">
                                Lucro Líq. Real no PIX (-{pixDiscountPercent}% desc | -{gatewayPixFeePercent}% MP)
                              </span>
                              <strong className="text-[#10B981]">
                                +{formatBRL(metrics.pixNetProfitCents)} ({metrics.pixNetMarginPercent}%
                                margem)
                              </strong>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setStudioMode('ADD_COLOR_TO_EXISTING');
                                  setVarProductId(prod.id);
                                  setImgProductId(prod.id);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="px-2.5 py-1.5 rounded border border-[#D4AF37]/50 bg-[#D4AF37]/15 hover:bg-[#D4AF37] text-xs text-[#D4AF37] hover:text-[#0A0A0A] font-semibold cursor-pointer transition"
                              >
                                + Nova Cor / Tam
                              </button>
                              <button
                                type="button"
                                onClick={() => handleQuickToggleProductStatus(prod)}
                                className="px-2.5 py-1.5 rounded border border-[#262626] bg-[#141414] hover:border-[#D4AF37] text-xs text-[#F5F5F4] cursor-pointer"
                              >
                                {prod.status === 'ACTIVE' ? 'Ocultar' : 'Ativar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(prod)}
                                className="px-2.5 py-1.5 rounded border border-[#EF4444]/40 bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-xs text-[#EF4444] cursor-pointer"
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Lista de SKUs / Numerações com botões rápidos */}
                        <div className="space-y-2">
                          <span className="text-xs uppercase tracking-wider text-[#A8A29E] block">
                            Variações / SKUs ({prod.variants.length})
                          </span>
                          {prod.variants.length === 0 ? (
                            <p className="text-xs text-[#F59E0B]">
                              Nenhuma numeração cadastrada para este modelo.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {prod.variants.map((v) => {
                                const matchingImgs = prod.images.filter(
                                  (img) =>
                                    img.colorName?.trim().toLowerCase() ===
                                    v.colorName.trim().toLowerCase()
                                );
                                return (
                                  <div
                                    key={v.id}
                                    className="rounded border border-[#262626] bg-[#141414] p-2.5 text-xs flex items-center justify-between gap-2"
                                  >
                                    <div>
                                      <strong className="text-[#D4AF37]">{v.skuCode}</strong> • Cor:{' '}
                                      <span className="text-[#F5F5F4] font-medium">
                                        {v.colorName}
                                      </span>{' '}
                                      • Tam: <strong>{v.sizeLabel}</strong>
                                      <div className="text-[#A8A29E] mt-0.5">
                                        {v.supplyMode === 'IN_STOCK'
                                          ? `Pronta Entrega: ${v.stockOnHand} un.`
                                          : `Sob Encomenda (${v.prepDays ?? '?'} dias)`}{' '}
                                        •{' '}
                                        <span
                                          className={
                                            matchingImgs.length > 0
                                              ? 'text-[#10B981]'
                                              : 'text-[#F59E0B]'
                                          }
                                        >
                                          {matchingImgs.length} foto(s)
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleQuickToggleVariantMode(v)}
                                        className="px-2 py-1 rounded border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-[11px] text-[#C5A059] cursor-pointer"
                                        title="Alternar entre Pronta Entrega e Sob Encomenda"
                                      >
                                        Alternar Modo
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteVariant(v)}
                                        className="px-2 py-1 rounded border border-[#EF4444]/40 text-[11px] text-[#EF4444] hover:bg-[#EF4444]/15 cursor-pointer"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Galeria de Fotos por Cor com Upload Múltiplo e Definição de Capa */}
                        <div className="space-y-2 border-t border-[#262626] pt-3">
                          <span className="text-xs uppercase tracking-wider text-[#D4AF37] font-semibold block">
                            📸 Fotos por Cor deste Modelo ({prod.images.length} foto(s) no total)
                          </span>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {(distinctColors.length > 0 ? distinctColors : ['Padrão']).map((cName) => {
                              const colorImgs = prod.images.filter(
                                (img) =>
                                  (img.colorName || 'Padrão').trim().toLowerCase() ===
                                  cName.trim().toLowerCase()
                              );
                              const isUploading = uploadingForProductColor === `${prod.id}-${cName}`;

                              return (
                                <div
                                  key={cName}
                                  className="rounded border border-[#262626] bg-[#141414] p-2.5 space-y-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-[#F5F5F4] flex items-center gap-1.5">
                                      Cor: <strong className="text-[#D4AF37]">{cName}</strong>
                                      <span className="text-[10px] text-[#A8A29E]">
                                        ({colorImgs.length} foto(s))
                                      </span>
                                    </span>

                                    <label
                                      className={`text-[11px] font-semibold px-2.5 py-1 rounded border border-[#D4AF37]/50 text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#0A0A0A] cursor-pointer transition ${
                                        isUploading ? 'opacity-60 cursor-not-allowed bg-transparent' : 'bg-[#D4AF37]/10'
                                      }`}
                                    >
                                      {isUploading ? 'Enviando...' : '+ Adicionar Fotos'}
                                      <input
                                        type="file"
                                        multiple
                                        accept="image/*"
                                        disabled={isUploading}
                                        className="hidden"
                                        onChange={(e) =>
                                          handleAddPhotosToExistingColor(prod.id, cName, e)
                                        }
                                      />
                                    </label>
                                  </div>

                                  {colorImgs.length === 0 ? (
                                    <p className="text-[11px] text-[#F59E0B]">
                                      Nenhuma foto enviada para esta cor. Clique em &quot;+ Adicionar Fotos&quot;.
                                    </p>
                                  ) : (
                                    <div className="flex flex-wrap gap-2 pt-1">
                                      {colorImgs.map((img) => (
                                        <div
                                          key={img.id}
                                          className={`relative group w-16 h-16 rounded-lg overflow-hidden border bg-[#0A0A0A] shrink-0 ${
                                            img.isPrimary
                                              ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]'
                                              : 'border-[#262626]'
                                          }`}
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={img.url}
                                            alt={img.altText || ''}
                                            className="w-full h-full object-cover"
                                          />
                                          {img.isPrimary && (
                                            <span className="absolute top-0 inset-x-0 bg-[#D4AF37] text-[#0A0A0A] text-[8px] font-bold text-center leading-none py-0.5 uppercase">
                                              Capa
                                            </span>
                                          )}
                                          <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-1">
                                            {!img.isPrimary && (
                                              <button
                                                type="button"
                                                onClick={() => handleSetPrimaryProductImage(img.id)}
                                                className="text-[9px] bg-[#D4AF37] text-[#0A0A0A] px-1.5 py-0.5 rounded font-bold hover:scale-105"
                                                title="Definir como foto principal (capa)"
                                              >
                                                ⭐ Capa
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteProductImage(img.id)}
                                              className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold hover:scale-105"
                                              title="Excluir esta foto"
                                            >
                                              ✕ Excluir
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ============================================================================ */}
        {/* ABA 2: LISTAS DE PEDIDOS AO FORNECEDOR & SIMULADOR ESTRATÉGICO DE MARGEM    */}
        {/* ============================================================================ */}
        {activeTab === 'pedidos_fornecedor' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Criar Nova Lista de Pedido com Regra de Quantidade Mínima */}
              <form
                onSubmit={handleCreatePurchaseList}
                className="rounded-xl border border-[#262626] bg-[#141414] p-5 space-y-4"
              >
                <h2 className="text-base font-semibold text-[#D4AF37] border-b border-[#262626] pb-2">
                  1. Criar Nova Lista de Pedido ao Fornecedor
                </h2>

                <div>
                  <label htmlFor="list-title" className="block text-xs text-[#A8A29E] mb-1">
                    Nome da Lista de Pedido *
                  </label>
                  <input
                    id="list-title"
                    type="text"
                    required
                    value={newListTitle}
                    onChange={(e) => setNewListTitle(e.target.value)}
                    placeholder="Ex.: Pedido Fornecedor Calçados — Novembro"
                    className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="list-supplier" className="block text-xs text-[#A8A29E] mb-1">
                      Fornecedor / Fábrica
                    </label>
                    <input
                      id="list-supplier"
                      type="text"
                      value={newListSupplier}
                      onChange={(e) => setNewListSupplier(e.target.value)}
                      placeholder="Ex.: Atacado Sul"
                      className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="list-min-qty" className="block text-xs text-[#D4AF37] mb-1">
                      Regra Qtd. Mínima (peças) *
                    </label>
                    <input
                      id="list-min-qty"
                      type="number"
                      min="1"
                      required
                      value={newListMinQty}
                      onChange={(e) => setNewListMinQty(e.target.value)}
                      className="w-full min-h-[42px] rounded border border-[#D4AF37]/60 bg-[#0A0A0A] px-3 text-sm font-bold text-[#D4AF37]"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="list-notes" className="block text-xs text-[#A8A29E] mb-1">
                    Observações Estratégicas
                  </label>
                  <input
                    id="list-notes"
                    type="text"
                    value={newListNotes}
                    onChange={(e) => setNewListNotes(e.target.value)}
                    placeholder="Ex.: Fechar grade mínima de 12 pares para frete grátis"
                    className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[44px] rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-semibold text-sm cursor-pointer"
                >
                  Criar Lista de Pedido
                </button>
              </form>

              {/* Adicionar Produto/SKU Cadastrado à Lista Selecionada */}
              <form
                onSubmit={handleAddSkuToPurchaseList}
                className="lg:col-span-2 rounded-xl border border-[#262626] bg-[#141414] p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#262626] pb-2">
                  <h2 className="text-base font-semibold text-[#D4AF37]">
                    2. Adicionar Modelos Cadastrados à Lista de Pedido
                  </h2>
                  {initialPurchaseLists.length > 0 && (
                    <select
                      aria-label="Selecionar lista de pedido ativa"
                      value={activePurchaseList?.id || ''}
                      onChange={(e) => setSelectedListId(e.target.value)}
                      className="min-h-[38px] rounded border border-[#D4AF37] bg-[#0A0A0A] px-3 text-xs text-[#D4AF37] font-semibold"
                    >
                      {initialPurchaseLists.map((l) => (
                        <option key={l.id} value={l.id}>
                          Lista Ativa: {l.title} (Mín. {l.minOrderQuantity} un.)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                  <div className="sm:col-span-3">
                    <label htmlFor="order-sku" className="block text-xs text-[#A8A29E] mb-1">
                      Escolha o Modelo, Cor e Numeração (com prévia de Custo e Margem) *
                    </label>
                    <select
                      id="order-sku"
                      required
                      value={orderItemVariantId}
                      onChange={(e) => setOrderItemVariantId(e.target.value)}
                      className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-xs sm:text-sm"
                    >
                      <option value="">Selecione um modelo/SKU do catálogo...</option>
                      {allCatalogVariantsWithProduct.map(({ product, variant }) => {
                        const cost =
                          product.costPriceCents && product.costPriceCents > 0
                            ? product.costPriceCents
                            : Math.round(product.basePriceCents / (1 + markupPercent / 100));
                        const sale = variant.priceOverrideCents ?? product.basePriceCents;
                        const m = calculateProductMarginMetrics({
                          costCents: cost,
                          salePriceCents: sale,
                          pixDiscountPercent,
                        });
                        return (
                          <option key={variant.id} value={variant.id}>
                            {product.name} | {variant.colorName} • Tam {variant.sizeLabel} | Custo:{' '}
                            {formatBRL(cost)} → Venda: {formatBRL(sale)} (Lucro PIX:{' '}
                            +{formatBRL(m.pixProfitCents)} / {m.pixMarginPercent}%)
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="order-qty" className="block text-xs text-[#A8A29E] mb-1">
                      Qtd. a Pedir *
                    </label>
                    <input
                      id="order-qty"
                      type="number"
                      min="1"
                      required
                      value={orderItemQuantity}
                      onChange={(e) => setOrderItemQuantity(e.target.value)}
                      className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!activePurchaseList}
                  className="w-full min-h-[44px] rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] disabled:opacity-40 text-[#0A0A0A] font-bold text-sm cursor-pointer"
                >
                  + Incluir na Lista de Pedido & Simular Margem do Lote
                </button>
              </form>
            </div>

            {/* Painel Estratégico da Lista de Pedido Selecionada */}
            {activePurchaseList && activePurchaseEvaluation && (
              <section className="rounded-2xl border border-[#D4AF37]/40 bg-[#141414] p-6 space-y-6 shadow-xl">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#262626] pb-4">
                  <div>
                    <span className="text-xs uppercase tracking-widest text-[#C5A059]">
                      Fornecedor: {activePurchaseList.supplierName || 'A definir'}
                    </span>
                    <h3 className="text-xl font-serif text-[#D4AF37] font-semibold">
                      {activePurchaseList.title}
                    </h3>
                    {activePurchaseList.notes && (
                      <p className="text-xs text-[#A8A29E] mt-0.5">{activePurchaseList.notes}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(activePurchaseEvaluation.whatsappOrderText);
                      setCopiedSupplierText(true);
                      setTimeout(() => setCopiedSupplierText(false), 3000);
                    }}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0A0A0A] font-bold text-xs sm:text-sm cursor-pointer transition shadow-lg"
                  >
                    {copiedSupplierText
                      ? '✓ Lista Copiada para Enviar ao Fornecedor!'
                      : '📲 Copiar Lista de Pedido para o Fornecedor (WhatsApp)'}
                  </button>
                </div>

                {/* Barra de Regra de Quantidade Mínima do Pedido */}
                <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <strong className="text-[#F5F5F4]">
                      Regra de Quantidade Mínima do Pedido:{' '}
                      <span className="text-[#D4AF37]">
                        {activePurchaseEvaluation.totalUnits} de{' '}
                        {activePurchaseEvaluation.minOrderQuantity} peças
                      </span>
                    </strong>
                    <span
                      className={`px-3 py-1 rounded-full font-bold ${
                        activePurchaseEvaluation.isMinimumMet
                          ? 'bg-[#10B981]/20 text-[#10B981]'
                          : 'bg-[#F59E0B]/20 text-[#F59E0B]'
                      }`}
                    >
                      {activePurchaseEvaluation.isMinimumMet
                        ? '✓ Regra Mínima Atingida — Pronto para Pedir!'
                        : `Faltam ${activePurchaseEvaluation.remainingToMinimum} peça(s) para atingir o mínimo`}
                    </span>
                  </div>
                  <div className="w-full h-3 rounded-full bg-[#1C1C1C] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        activePurchaseEvaluation.isMinimumMet ? 'bg-[#10B981]' : 'bg-[#D4AF37]'
                      }`}
                      style={{ width: `${activePurchaseEvaluation.progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* 4 Indicadores Financeiros Estratégicos do Lote */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-1">
                    <span className="text-xs text-[#A8A29E] block">
                      Investimento Total (Custo do Pedido)
                    </span>
                    <strong className="text-xl text-[#F5F5F4]">
                      {formatBRL(activePurchaseEvaluation.totalInvestmentCostCents)}
                    </strong>
                    <span className="text-[11px] text-[#A8A29E] block">
                      {activePurchaseEvaluation.totalUnits} unidades no lote
                    </span>
                  </div>

                  <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-1">
                    <span className="text-xs text-[#A8A29E] block">
                      Faturamento Previsto (Cartão vs PIX)
                    </span>
                    <strong className="text-lg text-[#D4AF37] block">
                      {formatBRL(activePurchaseEvaluation.expectedRevenueCardCents)} (Cartão)
                    </strong>
                    <span className="text-xs text-[#10B981] block">
                      ou {formatBRL(activePurchaseEvaluation.expectedRevenuePixCents)} tudo no PIX
                    </span>
                  </div>

                  <div className="rounded-xl border border-[#10B981]/40 bg-[#10B981]/10 p-4 space-y-1">
                    <span className="text-xs text-[#10B981] font-semibold block">
                      Lucro Líquido Real (após taxas MP)
                    </span>
                    <strong className="text-lg text-[#10B981] block">
                      +{formatBRL(activePurchaseEvaluation.expectedNetProfitPixCents)} a +
                      {formatBRL(activePurchaseEvaluation.expectedNetProfitCardCents)}
                    </strong>
                    <span className="text-[11px] text-[#A8A29E] block">
                      Margem líquida: {activePurchaseEvaluation.averageMarginPixPercent}% (PIX) a{' '}
                      {activePurchaseEvaluation.averageMarginCardPercent}% (Cartão)
                    </span>
                  </div>

                  <div className="rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-4 space-y-1">
                    <span className="text-xs text-[#D4AF37] font-semibold block">
                      Ponto de Equilíbrio (Break-Even)
                    </span>
                    <strong className="text-xl text-[#F5F5F4] block">
                      {activePurchaseEvaluation.breakEvenUnitsCard} a{' '}
                      {activePurchaseEvaluation.breakEvenUnitsPix} peças vendidas
                    </strong>
                    <span className="text-[11px] text-[#C5A059] block">
                      Pagam 100% do custo do pedido ao fornecedor!
                    </span>
                  </div>
                </div>

                {/* Tabela de Itens do Pedido ao Fornecedor */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-[#F5F5F4]">
                    Grade de Peças na Lista ({activePurchaseList.items.length} referências)
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#262626] text-[#A8A29E]">
                          <th className="py-2 pr-3">Modelo / SKU</th>
                          <th className="py-2 pr-3">Cor & Tam</th>
                          <th className="py-2 pr-3">Qtd.</th>
                          <th className="py-2 pr-3">Custo Un.</th>
                          <th className="py-2 pr-3">Venda Un.</th>
                          <th className="py-2 pr-3">Lucro Un. no PIX</th>
                          <th className="py-2 pr-3">Subtotal Custo</th>
                          <th className="py-2">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#262626]">
                        {activePurchaseList.items.map((item) => {
                          const itemMetrics = calculateProductMarginMetrics({
                            costCents: item.unitCostCents,
                            salePriceCents: item.unitSalePriceCents,
                            pixDiscountPercent,
                          });
                          return (
                            <tr key={item.id}>
                              <td className="py-2.5 pr-3">
                                <strong className="text-[#F5F5F4] block">{item.productName}</strong>
                                <span className="text-[#A8A29E]">{item.skuCode}</span>
                              </td>
                              <td className="py-2.5 pr-3">
                                {item.colorName} • <strong>{item.sizeLabel}</strong>
                              </td>
                              <td className="py-2.5 pr-3">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdatePurchaseItemQuantity(item.id, item.quantity - 1)
                                    }
                                    className="w-6 h-6 rounded border border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <strong className="px-2 text-[#D4AF37]">{item.quantity}</strong>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdatePurchaseItemQuantity(item.id, item.quantity + 1)
                                    }
                                    className="w-6 h-6 rounded border border-[#262626] bg-[#0A0A0A] text-[#F5F5F4] cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="py-2.5 pr-3">{formatBRL(item.unitCostCents)}</td>
                              <td className="py-2.5 pr-3 text-[#D4AF37] font-semibold">
                                {formatBRL(item.unitSalePriceCents)}
                              </td>
                              <td className="py-2.5 pr-3 text-[#10B981] font-semibold">
                                +{formatBRL(itemMetrics.pixProfitCents)} ({itemMetrics.pixMarginPercent}
                                %)
                              </td>
                              <td className="py-2.5 pr-3 font-semibold">
                                {formatBRL(item.unitCostCents * item.quantity)}
                              </td>
                              <td className="py-2.5">
                                <button
                                  type="button"
                                  onClick={() => handleRemovePurchaseItem(item.id)}
                                  className="text-[#EF4444] hover:underline cursor-pointer"
                                >
                                  Remover
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* ============================================================================ */}
        {/* ABA 3: CONFIGURAÇÃO DE MARKUP PADRÃO (120%) & AJUSTE DE ESTOQUE              */}
        {/* ============================================================================ */}
        {activeTab === 'config_estoque' && (
          <div className="space-y-8">
            {/* Configuração de Markup Padrão (%), Desconto PIX (%) e Taxas Gateway Mercado Pago */}
            <section className="rounded-xl border border-[#D4AF37]/40 bg-[#141414] p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#262626] pb-3">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-[#C5A059] font-semibold">
                    Financeiro &amp; Operadora
                  </span>
                  <h2 className="text-lg font-semibold text-[#D4AF37]">
                    Parâmetros Estratégicos de Precificação &amp; Taxas Mercado Pago
                  </h2>
                </div>
                <span className="text-xs text-[#A8A29E]">
                  As taxas deduzem automaticamente o cálculo de lucro real líquido.
                </span>
              </div>

              <form
                onSubmit={handleSaveMarkupSettings}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
              >
                <div>
                  <label htmlFor="cfg-markup" className="block text-xs text-[#A8A29E] mb-1">
                    Markup Padrão Loja (%) *
                  </label>
                  <input
                    id="cfg-markup"
                    type="number"
                    step="0.5"
                    min="0"
                    required
                    value={markupPercent}
                    onChange={(e) => setMarkupPercent(Number(e.target.value))}
                    className="w-full min-h-[42px] rounded border border-[#D4AF37] bg-[#0A0A0A] px-3 text-sm font-bold text-[#D4AF37]"
                  />
                </div>

                <div>
                  <label htmlFor="cfg-pix" className="block text-xs text-[#A8A29E] mb-1">
                    Desconto à Vista no PIX (%) *
                  </label>
                  <input
                    id="cfg-pix"
                    type="number"
                    step="0.5"
                    min="0"
                    max="50"
                    required
                    value={pixDiscountPercent}
                    onChange={(e) => setPixDiscountPercent(Number(e.target.value))}
                    className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm text-[#10B981] font-bold"
                  />
                </div>

                <div>
                  <label htmlFor="cfg-taxa-pix" className="block text-xs text-[#A8A29E] mb-1">
                    Taxa MP no PIX (%) *
                  </label>
                  <input
                    id="cfg-taxa-pix"
                    type="number"
                    step="0.01"
                    min="0"
                    max="20"
                    required
                    value={gatewayPixFeePercent}
                    onChange={(e) => setGatewayPixFeePercent(Number(e.target.value))}
                    className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm text-[#F5F5F4]"
                  />
                </div>

                <div>
                  <label htmlFor="cfg-taxa-card" className="block text-xs text-[#A8A29E] mb-1">
                    Taxa MP no Cartão (%) *
                  </label>
                  <input
                    id="cfg-taxa-card"
                    type="number"
                    step="0.01"
                    min="0"
                    max="20"
                    required
                    value={gatewayCardFeePercent}
                    onChange={(e) => setGatewayCardFeePercent(Number(e.target.value))}
                    className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm text-[#F5F5F4]"
                  />
                </div>

                <button
                  type="submit"
                  className="min-h-[42px] rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-bold text-sm px-5 cursor-pointer transition shadow-md"
                >
                  Salvar Parâmetros
                </button>
              </form>
            </section>

            {/* Ajuste Manual Auditado de Estoque */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form
                onSubmit={handleStockAdjustment}
                className="rounded-xl border border-[#262626] bg-[#141414] p-5 space-y-4 h-fit"
              >
                <h2 className="text-base font-semibold text-[#D4AF37] border-b border-[#262626] pb-2">
                  Ajuste Manual Auditado de Estoque
                </h2>

                <div>
                  <label htmlFor="adj-sku" className="block text-xs text-[#A8A29E] mb-1">
                    SKU (Apenas itens de Estoque Próprio) *
                  </label>
                  <select
                    id="adj-sku"
                    required
                    value={adjVariantId}
                    onChange={(e) => setAdjVariantId(e.target.value)}
                    className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                  >
                    <option value="">Selecione a SKU...</option>
                    {allInStockVariants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.skuCode} — {v.productName} ({v.colorName} {v.sizeLabel}) [Saldo:{' '}
                        {v.stockOnHand}]
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="adj-delta" className="block text-xs text-[#A8A29E] mb-1">
                    Quantidade a Somar/Subtrair (ex: 3 ou -1) *
                  </label>
                  <input
                    id="adj-delta"
                    type="number"
                    required
                    value={adjDelta}
                    onChange={(e) => setAdjDelta(e.target.value)}
                    className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="adj-reason" className="block text-xs text-[#A8A29E] mb-1">
                    Motivo da Movimentação (Obrigatório para Auditoria) *
                  </label>
                  <input
                    id="adj-reason"
                    type="text"
                    required
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                    placeholder="Reposição de fornecedor / Contagem física"
                  />
                </div>

                <button
                  type="submit"
                  disabled={allInStockVariants.length === 0}
                  className="w-full min-h-[44px] rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] disabled:opacity-40 text-[#0A0A0A] font-semibold text-sm cursor-pointer"
                >
                  Registrar Movimentação
                </button>
              </form>

              <section className="lg:col-span-2 rounded-xl border border-[#262626] bg-[#141414] p-5 space-y-4">
                <h2 className="text-base font-semibold text-[#D4AF37] border-b border-[#262626] pb-2">
                  Histórico Auditável de Movimentações de Estoque
                </h2>

                {recentMovements.length === 0 ? (
                  <p className="text-sm text-[#A8A29E]">Nenhuma movimentação registrada ainda.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#262626] text-[#A8A29E]">
                          <th className="py-2 pr-3">Data</th>
                          <th className="py-2 pr-3">SKU / Produto</th>
                          <th className="py-2 pr-3">Tipo</th>
                          <th className="py-2 pr-3">Delta</th>
                          <th className="py-2 pr-3">Saldo Físico</th>
                          <th className="py-2">Motivo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#262626]">
                        {recentMovements.map((m) => (
                          <tr key={m.id}>
                            <td className="py-2.5 pr-3 text-[#A8A29E]">
                              {new Date(m.createdAt).toLocaleString('pt-BR')}
                            </td>
                            <td className="py-2.5 pr-3">
                              <strong className="text-[#D4AF37]">{m.variant.skuCode}</strong>
                              <span className="block text-[#A8A29E]">
                                {m.variant.product.name} ({m.variant.colorName}{' '}
                                {m.variant.sizeLabel})
                              </span>
                            </td>
                            <td className="py-2.5 pr-3">{m.movementType}</td>
                            <td
                              className={`py-2.5 pr-3 font-semibold ${
                                m.quantityDelta >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'
                              }`}
                            >
                              {m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                            </td>
                            <td className="py-2.5 pr-3">
                              {m.previousOnHand} → <strong>{m.newOnHand}</strong>
                            </td>
                            <td className="py-2.5 text-[#A8A29E]">{m.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* ============================================================================ */}
        {/* ABA 4: GESTÃO DE CATEGORIAS & MEDIDAS DE FRETE (MELHOR ENVIO)                */}
        {/* ============================================================================ */}
        {activeTab === 'categorias' && (
          <div className="space-y-8">
            {/* Formulário de Criação / Edição de Categoria */}
            <section className="rounded-2xl border border-[#D4AF37]/40 bg-[#141414] p-6 space-y-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#262626] pb-3">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-[#C5A059] font-semibold">
                    Linhas de Produtos &amp; Logística
                  </span>
                  <h2 className="text-lg font-serif text-[#D4AF37] font-semibold">
                    {editingCategoryId ? 'Editar Categoria Existente' : 'Cadastrar Nova Categoria'}
                  </h2>
                </div>
                {editingCategoryId && (
                  <button
                    type="button"
                    onClick={handleCancelCategoryEdit}
                    className="text-xs text-[#A8A29E] hover:text-[#F5F5F4] underline cursor-pointer"
                  >
                    Cancelar Edição
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveCategory} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="lg:col-span-2">
                    <label htmlFor="cat-name" className="block text-xs text-[#A8A29E] mb-1">
                      Nome da Categoria *
                    </label>
                    <input
                      id="cat-name"
                      type="text"
                      required
                      value={catName}
                      onChange={(e) => {
                        setCatName(e.target.value);
                        if (!editingCategoryId) {
                          setCatSlug(slugifyText(e.target.value));
                        }
                      }}
                      placeholder="Ex: Sandálias Salto Bloco, Bolsas Tiracolo, Cintos"
                      className="w-full min-h-[42px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3.5 text-sm text-[#F5F5F4] focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label htmlFor="cat-slug" className="block text-xs text-[#A8A29E] mb-1">
                      Identificador / Slug (URL amigável) *
                    </label>
                    <input
                      id="cat-slug"
                      type="text"
                      required
                      value={catSlug}
                      onChange={(e) => setCatSlug(slugifyText(e.target.value))}
                      placeholder="sandalias-salto-bloco"
                      className="w-full min-h-[42px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm text-[#D4AF37] font-mono"
                    />
                  </div>

                  <div>
                    <label htmlFor="cat-order" className="block text-xs text-[#A8A29E] mb-1">
                      Ordem no Menu (0, 1, 2...)
                    </label>
                    <input
                      id="cat-order"
                      type="number"
                      min="0"
                      value={catOrder}
                      onChange={(e) => setCatOrder(e.target.value)}
                      className="w-full min-h-[42px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm text-[#F5F5F4]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label htmlFor="cat-desc" className="block text-xs text-[#A8A29E] mb-1">
                      Descrição da Linha (Exibida na loja / SEO - opcional)
                    </label>
                    <input
                      id="cat-desc"
                      type="text"
                      value={catDesc}
                      onChange={(e) => setCatDesc(e.target.value)}
                      placeholder="Ex: Calçados elegantes com conforto térmico e design atemporal."
                      className="w-full min-h-[42px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3.5 text-sm text-[#F5F5F4]"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-6">
                    <input
                      id="cat-active"
                      type="checkbox"
                      checked={catIsActive}
                      onChange={(e) => setCatIsActive(e.target.checked)}
                      className="w-4 h-4 rounded border-[#262626] text-[#D4AF37] accent-[#D4AF37] cursor-pointer"
                    />
                    <label htmlFor="cat-active" className="text-sm text-[#F5F5F4] cursor-pointer">
                      Categoria Ativa e Visível na Loja
                    </label>
                  </div>
                </div>

                {/* Bloco de Dimensões Padrão de Frete para Melhor Envio */}
                <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-[#D4AF37] font-semibold">
                      📦 Dimensões Padrão de Envio (Melhor Envio &amp; Correios)
                    </span>
                    <span className="text-[11px] text-[#A8A29E]">
                      Valores herdados automaticamente ao cadastrar um novo produto desta categoria.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label htmlFor="cat-weight" className="block text-[#A8A29E] mb-1">
                        Peso Médio (kg) *
                      </label>
                      <input
                        id="cat-weight"
                        type="number"
                        step="0.05"
                        min="0.1"
                        required
                        value={catWeightKg}
                        onChange={(e) => setCatWeightKg(e.target.value)}
                        className="w-full min-h-[38px] rounded border border-[#262626] bg-[#141414] px-2.5 text-xs text-[#F5F5F4]"
                      />
                    </div>

                    <div>
                      <label htmlFor="cat-height" className="block text-[#A8A29E] mb-1">
                        Altura (cm) *
                      </label>
                      <input
                        id="cat-height"
                        type="number"
                        min="1"
                        required
                        value={catHeightCm}
                        onChange={(e) => setCatHeightCm(e.target.value)}
                        className="w-full min-h-[38px] rounded border border-[#262626] bg-[#141414] px-2.5 text-xs text-[#F5F5F4]"
                      />
                    </div>

                    <div>
                      <label htmlFor="cat-width" className="block text-[#A8A29E] mb-1">
                        Largura (cm) *
                      </label>
                      <input
                        id="cat-width"
                        type="number"
                        min="5"
                        required
                        value={catWidthCm}
                        onChange={(e) => setCatWidthCm(e.target.value)}
                        className="w-full min-h-[38px] rounded border border-[#262626] bg-[#141414] px-2.5 text-xs text-[#F5F5F4]"
                      />
                    </div>

                    <div>
                      <label htmlFor="cat-length" className="block text-[#A8A29E] mb-1">
                        Comprimento (cm) *
                      </label>
                      <input
                        id="cat-length"
                        type="number"
                        min="5"
                        required
                        value={catLengthCm}
                        onChange={(e) => setCatLengthCm(e.target.value)}
                        className="w-full min-h-[38px] rounded border border-[#262626] bg-[#141414] px-2.5 text-xs text-[#F5F5F4]"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={catSubmitting}
                    className="min-h-[44px] px-6 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-bold text-sm transition cursor-pointer disabled:opacity-50"
                  >
                    {catSubmitting
                      ? 'Salvando...'
                      : editingCategoryId
                      ? 'Atualizar Categoria'
                      : 'Salvar Nova Categoria'}
                  </button>

                  {editingCategoryId && (
                    <button
                      type="button"
                      onClick={handleCancelCategoryEdit}
                      className="min-h-[44px] px-4 py-2 rounded-lg border border-[#262626] bg-[#0A0A0A] hover:bg-[#262626] text-xs text-[#F5F5F4] cursor-pointer"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </section>

            {/* Listagem de Categorias Cadastradas */}
            <section className="rounded-xl border border-[#262626] bg-[#141414] p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#262626] pb-3">
                <h3 className="text-base font-semibold text-[#D4AF37]">
                  Categorias Cadastradas ({categoriesList.length})
                </h3>
                <span className="text-xs text-[#A8A29E]">
                  Itens ativos aparecem no menu de navegação e filtros da vitrine.
                </span>
              </div>

              {categoriesList.length === 0 ? (
                <p className="text-sm text-[#A8A29E]">Nenhuma categoria cadastrada ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#262626] text-[#A8A29E]">
                        <th className="py-2.5 pr-3">Ordem</th>
                        <th className="py-2.5 pr-3">Nome / Slug</th>
                        <th className="py-2.5 pr-3">Dimensões Padrão de Frete</th>
                        <th className="py-2.5 pr-3">Produtos Vinculados</th>
                        <th className="py-2.5 pr-3">Status</th>
                        <th className="py-2.5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#262626]">
                      {categoriesList.map((cat) => (
                        <tr key={cat.id} className="hover:bg-[#0A0A0A]/50 transition">
                          <td className="py-3 pr-3 text-[#A8A29E] font-mono">
                            #{cat.displayOrder ?? 0}
                          </td>
                          <td className="py-3 pr-3">
                            <strong className="text-sm text-[#F5F5F4] block font-serif">
                              {cat.name}
                            </strong>
                            <span className="text-[11px] text-[#A8A29E] font-mono">
                              /{cat.slug}
                            </span>
                            {cat.description && (
                              <p className="text-[11px] text-[#A8A29E] mt-0.5 line-clamp-1">
                                {cat.description}
                              </p>
                            )}
                          </td>
                          <td className="py-3 pr-3 text-[#A8A29E]">
                            <span className="text-[#F5F5F4] font-medium">
                              {cat.defaultWeightKg} kg
                            </span>{' '}
                            • {cat.defaultHeightCm}x{cat.defaultWidthCm}x{cat.defaultLengthCm} cm
                          </td>
                          <td className="py-3 pr-3">
                            <span className="px-2 py-0.5 rounded bg-[#262626] text-[#F5F5F4] font-semibold text-[11px]">
                              {cat._count?.products ?? 0} produtos
                            </span>
                          </td>
                          <td className="py-3 pr-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                                cat.isActive !== false
                                  ? 'bg-[#10B981]/20 text-[#10B981]'
                                  : 'bg-[#EF4444]/20 text-[#EF4444]'
                              }`}
                            >
                              {cat.isActive !== false ? 'Ativa na Loja' : 'Oculta (Inativa)'}
                            </span>
                          </td>
                          <td className="py-3 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => handleStartCategoryEdit(cat)}
                              className="px-2.5 py-1 rounded border border-[#D4AF37]/40 bg-[#D4AF37]/10 text-xs text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#0A0A0A] font-semibold cursor-pointer transition"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleCategoryActive(cat)}
                              className="px-2.5 py-1 rounded border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-xs text-[#F5F5F4] cursor-pointer"
                            >
                              {cat.isActive !== false ? 'Desativar' : 'Ativar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat)}
                              className="px-2.5 py-1 rounded border border-[#EF4444]/40 bg-[#EF4444]/10 hover:bg-[#EF4444] text-xs text-[#EF4444] hover:text-white cursor-pointer transition"
                            >
                              Excluir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
