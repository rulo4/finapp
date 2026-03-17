import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

type CatalogOption = {
  id: string;
  name: string;
};

type PaymentInstrumentOption = CatalogOption & {
  instrument_type: 'cash' | 'debit_card' | 'credit_card';
};

type GeminiReceiptItem = {
  concept?: string;
  quantity?: number;
  unit_of_measure_text?: string;
  unit_of_measure_id?: string;
  subtotal_original?: number;
  category_id?: string;
  category_text?: string;
  notes?: string;
};

type GeminiReceiptResponse = {
  receipt_date?: string;
  store_name_text?: string;
  store_id?: string;
  payment_instrument_text?: string;
  payment_instrument_id?: string;
  currency_code?: 'MXN' | 'USD';
  items?: GeminiReceiptItem[];
};

type ParsedTicketExpense = {
  entry_date: string;
  concept: string;
  quantity: number;
  unit_of_measure_id: string | null;
  unit_of_measure_text: string | null;
  subtotal_original: number;
  currency_code: 'MXN' | 'USD';
  suggested_store_id: string | null;
  suggested_store_text: string | null;
  suggested_payment_instrument_id: string | null;
  suggested_payment_instrument_text: string | null;
  suggested_category_id: string | null;
  suggested_category_text: string | null;
  notes: string;
};

type ProcessTicketRequest = {
  storage_path?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function normalizeString(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function normalizeMatchText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCurrency(value: string | undefined): 'MXN' | 'USD' {
  return value === 'USD' ? 'USD' : 'MXN';
}

function normalizeQuantity(value: number | undefined) {
  return Number.isFinite(value) && value! > 0 ? Number(value!.toFixed(6)) : 1;
}

function normalizeSubtotal(value: number | undefined) {
  return Number.isFinite(value) ? Number(value!.toFixed(6)) : 0;
}

function isDiscountConcept(concept: string) {
  const normalizedConcept = normalizeMatchText(concept);

  return /(cupon|coupon|descuento|bonificacion|rebaja|promo|promocion)/.test(normalizedConcept);
}

function resolveCatalogOptionByName<T extends CatalogOption>(value: string | null | undefined, options: T[]) {
  const normalizedValue = normalizeMatchText(value);

  if (!normalizedValue) {
    return null;
  }

  const exactMatch = options.find((option) => normalizeMatchText(option.name) === normalizedValue);

  if (exactMatch) {
    return exactMatch;
  }

  const containsMatches = options.filter((option) => {
    const normalizedName = normalizeMatchText(option.name);

    return normalizedName.includes(normalizedValue) || normalizedValue.includes(normalizedName);
  });

  return containsMatches.length === 1 ? containsMatches[0] : null;
}

function canonicalUnitName(value: string | null | undefined) {
  const normalizedValue = normalizeMatchText(value);

  if (!normalizedValue) {
    return null;
  }

  const aliasGroups: Record<string, string[]> = {
    kg: ['kg', 'kgs', 'kilo', 'kilos'],
    g: ['g', 'gr', 'grs', 'gramo', 'gramos'],
    pieza: ['p', 'pz', 'pza', 'pzas', 'pieza', 'piezas', 'pc', 'pcs'],
    litro: ['l', 'lt', 'lts', 'litro', 'litros'],
    ml: ['ml', 'mililitro', 'mililitros'],
    hr: ['hr', 'hrs', 'hora', 'horas'],
    m: ['m', 'mt', 'mts', 'metro', 'metros'],
    mes: ['mes', 'meses'],
    año: ['ano', 'anos', 'año', 'años'],
    servicio: ['servicio', 'servicios'],
  };

  for (const [canonicalName, aliases] of Object.entries(aliasGroups)) {
    if (aliases.includes(normalizedValue)) {
      return canonicalName;
    }
  }

  return normalizedValue;
}

function inferQuantityAndUnitFromConcept(concept: string) {
  const normalizedConcept = normalizeMatchText(concept);
  const quantityAndUnitMatch = normalizedConcept.match(
    /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|g|gr|grs|gramo|gramos|ml|mililitro|mililitros|l|lt|lts|litro|litros|p|pz|pza|pzas|pieza|piezas|pc|pcs|hr|hrs|hora|horas|m|mt|mts|metro|metros)(?=$|\s)/i,
  );

  if (!quantityAndUnitMatch) {
    return null;
  }

  const parsedQuantity = Number(quantityAndUnitMatch[1].replace(',', '.'));
  const unitName = canonicalUnitName(quantityAndUnitMatch[2]);

  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !unitName) {
    return null;
  }

  return {
    quantity: Number(parsedQuantity.toFixed(6)),
    unitName,
  };
}

function resolveUnitOption(
  unitId: string | undefined,
  unitText: string | null | undefined,
  inferredUnitName: string | null,
  units: CatalogOption[],
) {
  const trimmedUnitId = normalizeString(unitId);

  if (trimmedUnitId) {
    const byId = units.find((unit) => unit.id === trimmedUnitId);

    if (byId) {
      return byId;
    }
  }

  const unitCandidates = [unitText, inferredUnitName]
    .map((value) => canonicalUnitName(value))
    .filter((value): value is string => Boolean(value));

  for (const candidate of unitCandidates) {
    const resolved = resolveCatalogOptionByName(candidate, units);

    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);

    for (const byte of chunk) {
      binary += String.fromCharCode(byte);
    }
  }

  return btoa(binary);
}

function extractJsonText(rawResponse: Record<string, unknown>) {
  const candidates = Array.isArray(rawResponse.candidates) ? rawResponse.candidates : [];
  const parts = candidates
    .flatMap((candidate) => {
      const content = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>).content : null;

      if (!content || typeof content !== 'object' || !Array.isArray((content as Record<string, unknown>).parts)) {
        return [] as unknown[];
      }

      return (content as Record<string, unknown>).parts as unknown[];
    })
    .flatMap((part) => {
      if (!part || typeof part !== 'object') {
        return [] as string[];
      }

      const text = (part as Record<string, unknown>).text;

      return typeof text === 'string' ? [text] : [];
    });

  const joinedText = parts.join('').trim();

  if (!joinedText) {
    throw new Error('Gemini did not return structured text output.');
  }

  const fencedMatch = joinedText.match(/```(?:json)?\s*([\s\S]*?)```/i);

  return fencedMatch ? fencedMatch[1].trim() : joinedText;
}

function getGeminiFinishReason(rawResponse: Record<string, unknown>) {
  const candidates = Array.isArray(rawResponse.candidates) ? rawResponse.candidates : [];
  const firstCandidate = candidates[0];

  if (!firstCandidate || typeof firstCandidate !== 'object') {
    return null;
  }

  const finishReason = (firstCandidate as Record<string, unknown>).finishReason;

  return typeof finishReason === 'string' ? finishReason : null;
}

function parseGeminiJson(rawResponse: Record<string, unknown>) {
  const extractedJson = extractJsonText(rawResponse);

  try {
    return JSON.parse(extractedJson) as GeminiReceiptResponse;
  } catch (error) {
    const finishReason = getGeminiFinishReason(rawResponse);
    const message =
      finishReason === 'MAX_TOKENS'
        ? 'Gemini devolvio un JSON truncado porque alcanzo el limite de salida.'
        : 'Gemini devolvio un JSON incompleto o invalido.';

    throw new Error(message);
  }
}

function buildPrompt(
  stores: CatalogOption[],
  categories: CatalogOption[],
  units: CatalogOption[],
  paymentInstruments: PaymentInstrumentOption[],
) {
  return [
    'Analiza este ticket de compra y devuelve un JSON estricto.',
    'Objetivo: detectar la fecha del ticket, la tienda, el medio de pago y cada gasto individual.',
    'Reglas:',
    '- Usa solo IDs de los catálogos proporcionados; si no hay coincidencia confiable, devuelve cadena vacía.',
    '- Si el ticket no muestra cantidad, usa 1.',
    '- Usa MXN por defecto cuando no sea evidente otra moneda.',
    '- subtotal_original debe ser el subtotal original de cada renglón, no el total del ticket completo.',
    '- Incluye descuentos, cupones o promociones como renglones separados. Si representan una deduccion, subtotal_original debe ser negativo.',
    '- Si el concepto incluye cantidad y unidad embebidas, extráelas aunque no haya columna separada. Ejemplos: 2KG => quantity=2 y unit_of_measure_text=kg; 500G => quantity=500 y unit_of_measure_text=g; 2P => quantity=2 y unit_of_measure_text=pieza.',
    '- Si un producto fisico no trae unidad explicita y no es descuento, usa pieza por defecto.',
    '- concept debe ser breve pero útil para registrar el gasto.',
    '- No inventes campos adicionales.',
    `Tiendas disponibles: ${JSON.stringify(stores.slice(0, 100))}`,
    `Categorias disponibles: ${JSON.stringify(categories.slice(0, 100))}`,
    `Unidades disponibles: ${JSON.stringify(units.slice(0, 100))}`,
    `Instrumentos de pago disponibles: ${JSON.stringify(paymentInstruments.slice(0, 100))}`,
  ].join('\n');
}

function buildGenerationConfig(maxOutputTokens: number) {
  return {
    temperature: 0,
    topK: 20,
    topP: 0.9,
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        receipt_date: { type: 'STRING' },
        store_name_text: { type: 'STRING' },
        store_id: { type: 'STRING' },
        payment_instrument_text: { type: 'STRING' },
        payment_instrument_id: { type: 'STRING' },
        currency_code: { type: 'STRING', enum: ['MXN', 'USD'] },
        items: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              concept: { type: 'STRING' },
              quantity: { type: 'NUMBER' },
              unit_of_measure_text: { type: 'STRING' },
              unit_of_measure_id: { type: 'STRING' },
              subtotal_original: { type: 'NUMBER' },
              category_id: { type: 'STRING' },
              category_text: { type: 'STRING' },
              notes: { type: 'STRING' },
            },
            required: ['concept', 'quantity', 'subtotal_original'],
          },
        },
      },
      required: ['items'],
    },
  };
}

function normalizeParsedExpenses(
  payload: GeminiReceiptResponse,
  stores: CatalogOption[],
  categories: CatalogOption[],
  units: CatalogOption[],
  paymentInstruments: PaymentInstrumentOption[],
): ParsedTicketExpense[] {
  const entryDate = isIsoDate(payload.receipt_date) ? payload.receipt_date! : new Date().toISOString().slice(0, 10);
  const currencyCode = normalizeCurrency(payload.currency_code);
  const resolvedStore = resolveCatalogOptionByName(payload.store_name_text, stores);
  const resolvedPaymentInstrument = resolveCatalogOptionByName(payload.payment_instrument_text, paymentInstruments);
  const suggestedStoreId = normalizeString(payload.store_id) ?? resolvedStore?.id ?? null;
  const suggestedStoreText = normalizeString(payload.store_name_text) ?? resolvedStore?.name ?? null;
  const suggestedPaymentInstrumentId = normalizeString(payload.payment_instrument_id) ?? resolvedPaymentInstrument?.id ?? null;
  const suggestedPaymentInstrumentText = normalizeString(payload.payment_instrument_text) ?? resolvedPaymentInstrument?.name ?? null;

  return (payload.items ?? [])
    .map((item) => {
      const concept = item.concept?.trim() ?? '';
      const inferredMeasure = inferQuantityAndUnitFromConcept(concept);
      const isDiscount = isDiscountConcept(concept);
      const resolvedCategory = resolveCatalogOptionByName(item.category_text, categories);
      const resolvedUnit = resolveUnitOption(
        item.unit_of_measure_id,
        item.unit_of_measure_text,
        inferredMeasure?.unitName ?? (!isDiscount ? 'pieza' : null),
        units,
      );
      const normalizedQuantity = normalizeQuantity(item.quantity);
      const quantity = inferredMeasure && normalizedQuantity === 1 ? inferredMeasure.quantity : normalizedQuantity;
      const normalizedSubtotal = normalizeSubtotal(item.subtotal_original);
      const subtotalOriginal = isDiscount && normalizedSubtotal > 0 ? Number((-normalizedSubtotal).toFixed(6)) : normalizedSubtotal;

      return {
        entry_date: entryDate,
        concept,
        quantity,
        unit_of_measure_id: resolvedUnit?.id ?? null,
        unit_of_measure_text: resolvedUnit?.name ?? normalizeString(item.unit_of_measure_text) ?? inferredMeasure?.unitName ?? (!isDiscount ? 'pieza' : null),
        subtotal_original: subtotalOriginal,
        currency_code: currencyCode,
        suggested_store_id: suggestedStoreId,
        suggested_store_text: suggestedStoreText,
        suggested_payment_instrument_id: suggestedPaymentInstrumentId,
        suggested_payment_instrument_text: suggestedPaymentInstrumentText,
        suggested_category_id: normalizeString(item.category_id) ?? resolvedCategory?.id ?? null,
        suggested_category_text: normalizeString(item.category_text) ?? resolvedCategory?.name ?? null,
        notes: item.notes?.trim() ?? '',
      };
    })
    .filter((item) => item.concept && item.subtotal_original !== 0);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseAnonKey = getRequiredEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = getRequiredEnv('GEMINI_API_KEY');
    const geminiModel = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
    const geminiTimeoutMs = Number(Deno.env.get('GEMINI_TIMEOUT_MS') ?? '45000');
    const geminiMaxOutputTokens = Number(Deno.env.get('GEMINI_MAX_OUTPUT_TOKENS') ?? '4096');
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return jsonResponse(401, { error: 'Missing Authorization header' });
    }

    const authedClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const { data: authData, error: authError } = await authedClient.auth.getUser();

    if (authError || !authData.user) {
      return jsonResponse(401, { error: 'Invalid user session' });
    }

    const body = (await request.json()) as ProcessTicketRequest;
    const storagePath = body.storage_path?.trim();

    if (!storagePath) {
      return jsonResponse(400, { error: 'storage_path is required' });
    }

    const expectedFolder = `${authData.user.id}/`;

    if (!storagePath.startsWith(expectedFolder)) {
      return jsonResponse(403, { error: 'storage_path must be inside the authenticated user folder' });
    }

    const { data: ticketRecord, error: ticketInsertError } = await serviceClient
      .from('tickets')
      .insert({
        user_id: authData.user.id,
        storage_path: storagePath,
        status: 'processing',
        error_message: null,
      })
      .select('id')
      .single();

    if (ticketInsertError || !ticketRecord) {
      throw ticketInsertError ?? new Error('Unable to create ticket record');
    }

    const ticketId = ticketRecord.id as string;

    try {
      const [
        { data: imageBlob, error: downloadError },
        { data: stores, error: storesError },
        { data: categories, error: categoriesError },
        { data: units, error: unitsError },
        { data: paymentInstruments, error: paymentInstrumentsError },
      ] = await Promise.all([
        serviceClient.storage.from('tickets').download(storagePath),
        serviceClient.from('stores').select('id, name').eq('user_id', authData.user.id).eq('is_active', true).order('name'),
        serviceClient.from('expense_categories').select('id, name').eq('user_id', authData.user.id).eq('is_active', true).order('name'),
        serviceClient.from('unit_of_measures').select('id, name').eq('user_id', authData.user.id).eq('is_active', true).order('name'),
        serviceClient
          .from('payment_instruments')
          .select('id, name, instrument_type')
          .eq('user_id', authData.user.id)
          .eq('is_active', true)
          .order('name'),
      ]);

      if (downloadError || !imageBlob) throw downloadError ?? new Error('Unable to download image');
      if (storesError) throw storesError;
      if (categoriesError) throw categoriesError;
      if (unitsError) throw unitsError;
      if (paymentInstrumentsError) throw paymentInstrumentsError;

      const imageBuffer = new Uint8Array(await imageBlob.arrayBuffer());
      const imageBase64 = bytesToBase64(imageBuffer);
      const prompt = buildPrompt(
        (stores ?? []) as CatalogOption[],
        (categories ?? []) as CatalogOption[],
        (units ?? []) as CatalogOption[],
        (paymentInstruments ?? []) as PaymentInstrumentOption[],
      );

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(geminiTimeoutMs),
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: imageBlob.type || 'image/jpeg',
                      data: imageBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: buildGenerationConfig(geminiMaxOutputTokens),
          }),
        },
      );

      const rawGeminiResponse = (await geminiResponse.json()) as Record<string, unknown>;

      if (!geminiResponse.ok) {
        throw new Error(`Gemini request failed: ${JSON.stringify(rawGeminiResponse)}`);
      }

      const parsedGeminiPayload = parseGeminiJson(rawGeminiResponse);
      const parsedExpenses = normalizeParsedExpenses(
        parsedGeminiPayload,
        (stores ?? []) as CatalogOption[],
        (categories ?? []) as CatalogOption[],
        (units ?? []) as CatalogOption[],
        (paymentInstruments ?? []) as PaymentInstrumentOption[],
      );

      const { error: ticketUpdateError } = await serviceClient
        .from('tickets')
        .update({
          status: 'processed',
          raw_llm_response: rawGeminiResponse,
          parsed_expenses: parsedExpenses,
          error_message: null,
        })
        .eq('id', ticketId)
        .eq('user_id', authData.user.id);

      if (ticketUpdateError) {
        throw ticketUpdateError;
      }

      return jsonResponse(200, {
        ticket_id: ticketId,
        parsed_expenses: parsedExpenses,
      });
    } catch (processingError) {
      const errorMessage = processingError instanceof Error ? processingError.message : 'Unexpected ticket processing error';

      await serviceClient
        .from('tickets')
        .update({
          status: 'error',
          error_message: errorMessage,
        })
        .eq('id', ticketId)
        .eq('user_id', authData.user.id);

      throw processingError;
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'TimeoutError' || error.name === 'AbortError'
          ? 'Gemini did not respond before the configured timeout.'
          : error.message
        : 'Unexpected function error';

    return jsonResponse(500, { error: message });
  }
});