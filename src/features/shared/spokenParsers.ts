import Fuse from 'fuse.js';
import { format, parse, isValid, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import type { SelectOption } from './gridEditors';

function normalizeText(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SPANISH_NUMBER_WORDS: Record<string, number> = {
  primero: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisies: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintiun: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  'treinta y uno': 31,
  'treinta y un': 31,
};

function evaluateArithmeticExpression(expression: string) {
  const source = expression.replace(/\s+/g, '');

  if (!source) {
    return { value: null as number | null, error: null as string | null };
  }

  if (!/^[0-9()+\-*/.]+$/.test(source)) {
    return { value: null, error: 'Usa solo numeros, parentesis y + - * /' };
  }

  let index = 0;

  function parseExpression(): number {
    let value = parseTerm();

    while (index < source.length) {
      const operator = source[index];

      if (operator !== '+' && operator !== '-') {
        break;
      }

      index += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }

    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();

    while (index < source.length) {
      const operator = source[index];

      if (operator !== '*' && operator !== '/') {
        break;
      }

      index += 1;
      const right = parseFactor();

      if (operator === '/') {
        if (right === 0) {
          throw new Error('No se puede dividir entre cero');
        }

        value /= right;
      } else {
        value *= right;
      }
    }

    return value;
  }

  function parseFactor(): number {
    if (source[index] === '+') {
      index += 1;
      return parseFactor();
    }

    if (source[index] === '-') {
      index += 1;
      return -parseFactor();
    }

    if (source[index] === '(') {
      index += 1;
      const value = parseExpression();

      if (source[index] !== ')') {
        throw new Error('Falta cerrar un parentesis');
      }

      index += 1;
      return value;
    }

    const start = index;

    while (index < source.length && /[0-9.]/.test(source[index])) {
      index += 1;
    }

    if (start === index) {
      throw new Error('Expresión inválida');
    }

    const token = source.slice(start, index);

    if ((token.match(/\./g) ?? []).length > 1) {
      throw new Error('Numero invalido');
    }

    const value = Number(token);

    if (!Number.isFinite(value)) {
      throw new Error('Numero invalido');
    }

    return value;
  }

  try {
    const value = parseExpression();

    if (index !== source.length) {
      return { value: null, error: 'Expresión inválida' };
    }

    return { value, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Expresión inválida',
    };
  }
}

export function parseSpokenDate(transcript: string): string | null {
  if (!transcript) return null;

  const now = new Date();
  // normalize text and remove trailing punctuation that speech recognition may include (e.g. '17.' or '17 de julio.')
  const normalized = normalizeText(transcript);
  const cleaned = normalized.replace(/[.,!?;:\u2014]+$/g, '').replace(/\s+/g, ' ').trim();

  if (cleaned.includes('hoy')) return format(now, 'yyyy-MM-dd');
  if (cleaned.includes('ayer')) return format(addDays(now, -1), 'yyyy-MM-dd');
  if (cleaned.includes('antier') || cleaned.includes('anteayer')) return format(addDays(now, -2), 'yyyy-MM-dd');

  // Replace Spanish number words (e.g. 'diecisiete' -> '17') so date-fns can parse textual dates
  let s = cleaned;
  const numberKeys = Object.keys(SPANISH_NUMBER_WORDS).sort((a, b) => b.length - a.length);
  for (const key of numberKeys) {
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, 'g');
    s = s.replace(re, String(SPANISH_NUMBER_WORDS[key] as number));
  }

  // Try dd/mm/yyyy or dd-mm-yyyy or dd/mm or dd-mm
  const numericMatch = s.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);

  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const year = numericMatch[3] ? Number(numericMatch[3]) : now.getFullYear();

    const candidate = new Date(year, month - 1, day);
    if (isValid(candidate)) return format(candidate, 'yyyy-MM-dd');
  }

  // Try patterns like '17 de julio' or '17 julio' optionally adding current year
  const monthPatterns = ["d 'de' MMMM yyyy", "d 'de' MMMM", 'd MMMM yyyy', 'd MMMM'];

  for (const pattern of monthPatterns) {
    try {
      // If pattern doesn't include year, append current year
      const toParse = pattern.includes('yyyy') ? s : `${s} ${now.getFullYear()}`;
      const parsed = parse(toParse, pattern.includes('yyyy') ? pattern : `${pattern} yyyy`, now, { locale: es });

      if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
    } catch {
      // ignore
    }
  }

  // If the user only said a day number (e.g. 'diecisiete' -> '17'), interpret as current month/year
  const dayOnlyMatch = s.match(/^\s*(\d{1,2})\s*$/);
  if (dayOnlyMatch) {
    const day = Number(dayOnlyMatch[1]);
    const candidate = new Date(now.getFullYear(), now.getMonth(), day);
    if (isValid(candidate)) return format(candidate, 'yyyy-MM-dd');
  }

  return null;
}

export function fuzzyMatchOption(transcript: string, options: readonly SelectOption[], threshold = 0.35): SelectOption | null {
  if (!options || options.length === 0) return null;

  // ignore placeholder / empty-value options (e.g. 'Sin tienda')
  const candidates = options.filter((o) => Boolean(o.value && String(o.value).trim() !== ''));
  if (candidates.length === 0) return null;

  const fuse = new Fuse(candidates as any, { keys: ['label'], threshold, ignoreLocation: true });
  const results = fuse.search(transcript);

  if (!results || results.length === 0) return null;

  // @ts-ignore - fuse result typing
  return results[0].item as SelectOption;
}

export function parseQuantityAndUnit(transcript: string, units: { id: string; name: string }[]) {
  if (!transcript) return null;

  // normalize and replace number words (e.g. 'tres' -> '3')
  let s = normalizeText(transcript);
  const numKeys = Object.keys(SPANISH_NUMBER_WORDS).sort((a, b) => b.length - a.length);
  for (const key of numKeys) {
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, 'g');
    s = s.replace(re, String(SPANISH_NUMBER_WORDS[key] as number));
  }

  const numberMatch = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!numberMatch) return null;

  const rawNumber = numberMatch[0].replace(',', '.');
  const quantity = String(Number(rawNumber));

  let unitText = s.slice(numberMatch.index! + numberMatch[0].length).trim();
  // remove leading words like 'de' or 'un' or 'una' and punctuation
  unitText = unitText.replace(/^(de|un(a)?|la|el|los|las)\s+/i, '').replace(/[.,!?]$/g, '').trim();

  if (!unitText) {
    return { quantity, unitId: '' };
  }

  const unitOptions: SelectOption[] = units.map((u) => ({ value: u.id, label: u.name }));
  const unitTextNorm = normalizeText(unitText);

  // 1) Exact / singular match
  for (const u of unitOptions) {
    const nameNorm = normalizeText(u.label);
    if (nameNorm === unitTextNorm || nameNorm === unitTextNorm.replace(/s$/i, '')) {
      return { quantity, unitId: u.value };
    }
    if (nameNorm.includes(unitTextNorm) || unitTextNorm.includes(nameNorm)) {
      return { quantity, unitId: u.value };
    }
  }

  // 2) Abbreviation heuristic: match short labels like 'pz' inside 'piezas'
  for (const u of unitOptions) {
    const nameNorm = normalizeText(u.label);
    if (nameNorm.length <= 3) {
      const pattern = nameNorm.split('').map((c) => escapeRegExp(c)).join('.*');
      const re = new RegExp(pattern);
      if (re.test(unitTextNorm)) {
        return { quantity, unitId: u.value };
      }
    }
  }

  // 3) Fuzzy match with a couple thresholds
  let matched = fuzzyMatchOption(unitText, unitOptions, 0.45);
  if (!matched) matched = fuzzyMatchOption(unitText, unitOptions, 0.6);

  return { quantity, unitId: matched?.value ?? '' };
}

export function parseSubtotal(transcript: string): string | null {
  let t = transcript.toLowerCase().trim();
  if (!t) return null;

  // remove currency words
  t = t.replace(/\b(pesos|mxn|dólares|dolares|usd)\b/g, '');

  // handle '130 con 50' or '130 coma 50'
  const conMatch = t.match(/(\d+)\s*(?:con|coma)\s*(\d+)/);
  if (conMatch) {
    return String(Number(`${conMatch[1]}.${conMatch[2]}`));
  }

  // normalize words to operators
  t = t.replace(/\bpor\b/g, '*').replace(/\bentre\b/g, '/').replace(/\bmas\b/g, '+').replace(/\bmenos\b/g, '-');
  t = t.replace(/=/g, '');

  // try to evaluate arithmetic
  if (/[+\-*/()]/.test(t)) {
    const evaluation = evaluateArithmeticExpression(t.replace(/[^0-9+\-*/().]/g, ''));
    if (evaluation.value != null) return String(Number(evaluation.value.toFixed(6)));
    return null;
  }

  // otherwise extract first number
  const numberMatch = t.match(/-?\d+(?:[.,]\d+)?/);
  if (!numberMatch) return null;

  const raw = numberMatch[0].replace(',', '.');
  return String(Number(raw));
}
