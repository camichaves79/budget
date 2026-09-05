import type { Category, TxType } from './types';
import { isValidISODate, todayISO } from './dates';

/**
 * AI transaction parsing through the app's parse microservice
 * (api/parse.js on Vercel — see README "Smart entry (AI parsing)").
 *
 * This module is the ONLY place in the app that knows about the service:
 * endpoint and shared secret come from build-time Vite env vars, and the LLM
 * API key itself lives server-side and never reaches the client. Swap the
 * provider/service here without touching any UI.
 *
 * Privacy: only the user's utterance and the current category list are sent.
 * Transaction history never leaves the device.
 */

const ENDPOINT = (import.meta.env.VITE_PARSE_ENDPOINT ?? '').trim();
const SECRET = (import.meta.env.VITE_PARSE_SECRET ?? '').trim();

/** Structured result of a successful parse, ready for the review step. */
export interface ParsedDraft {
  type: TxType;
  /** Integer centavos, converted from the LLM's peso amount. */
  amountCents: number;
  /** Null when the LLM couldn't map a category — the user picks in review. */
  categoryId: string | null;
  /** YYYY-MM-DD, or null when undetermined (review defaults to today). */
  date: string | null;
  note?: string;
}

export type ParseErrorKind =
  | 'not-configured'
  | 'rate-limit'
  | 'provider'
  | 'network'
  | 'invalid-response';

export interface ParseError {
  kind: ParseErrorKind;
  /** User-facing message. */
  message: string;
}

export type ParseResult = { ok: true; draft: ParsedDraft } | { ok: false; error: ParseError };

/**
 * Pure trust boundary for LLM output. The LLM never does arithmetic: the
 * frontend converts pesos → integer centavos here. `type` and `amount` are
 * required; category/date/notes may be absent or null and are filled in
 * during review. Unsupported category ids are dropped to null (never guessed
 * into a real category). Returns null when the payload can't be trusted.
 */
export function validateParsedTransaction(raw: unknown, categories: Category[]): ParsedDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const type = r.type;
  if (type !== 'expense' && type !== 'income') return null;

  let amount: number;
  if (typeof r.amount === 'number') {
    amount = r.amount;
  } else if (typeof r.amount === 'string' && r.amount.trim() !== '') {
    amount = Number(r.amount);
  } else {
    return null;
  }
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const amountCents = Math.round(amount * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;

  let categoryId: string | null = null;
  if (typeof r.categoryId === 'string' && r.categoryId !== '') {
    const cat = categories.find((c) => c.id === r.categoryId);
    if (cat && cat.kind === type && !cat.archived) categoryId = r.categoryId;
  }

  let date: string | null = null;
  if (typeof r.date === 'string' && isValidISODate(r.date)) date = r.date;

  const draft: ParsedDraft = { type, amountCents, categoryId, date };
  if (typeof r.notes === 'string') {
    const note = r.notes.trim();
    if (note) draft.note = note;
  }
  return draft;
}

const NOT_CONFIGURED: ParseResult = {
  ok: false,
  error: {
    kind: 'not-configured',
    message: "Smart entry isn't set up for this build. Ask the app owner to finish the setup.",
  },
};

/** Send the utterance to the parse microservice and validate the reply. */
export async function parseUtterance(utterance: string, categories: Category[]): Promise<ParseResult> {
  const text = utterance.trim();
  if (!text) {
    return { ok: false, error: { kind: 'invalid-response', message: 'Nothing to parse yet.' } };
  }
  if (!ENDPOINT || !SECRET) return NOT_CONFIGURED;

  const refs = categories
    .filter((c) => !c.archived)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-budget-secret': SECRET,
      },
      body: JSON.stringify({ utterance: text, categories: refs, today: todayISO() }),
    });
  } catch {
    return {
      ok: false,
      error: { kind: 'network', message: "Couldn't reach the parsing service. Check your connection and try again." },
    };
  }

  if (res.status === 401 || res.status === 403) return NOT_CONFIGURED;
  if (res.status === 429) {
    return {
      ok: false,
      error: { kind: 'rate-limit', message: 'The parsing service is busy right now. Try again in a moment.' },
    };
  }
  if (res.status >= 500) {
    return {
      ok: false,
      error: { kind: 'provider', message: 'The parsing service is having trouble. Try again shortly.' },
    };
  }

  let payload: { ok?: boolean; parsed?: unknown; code?: string } | null = null;
  try {
    payload = (await res.json()) as { ok?: boolean; parsed?: unknown; code?: string };
  } catch {
    payload = null;
  }

  if (payload && payload.ok === true && payload.parsed !== undefined) {
    const draft = validateParsedTransaction(payload.parsed, categories);
    if (draft) return { ok: true, draft };
    return invalidResponse();
  }

  const code = payload?.code;
  if (code === 'rate-limited') {
    return {
      ok: false,
      error: { kind: 'rate-limit', message: 'The parsing service is busy right now. Try again in a moment.' },
    };
  }
  if (code === 'invalid-response') return invalidResponse();
  if (code === 'provider') {
    return {
      ok: false,
      error: { kind: 'provider', message: 'The parsing service is having trouble. Try again shortly.' },
    };
  }
  if (code === 'unauthorized' || code === 'origin-not-allowed') return NOT_CONFIGURED;
  return {
    ok: false,
    error: { kind: 'network', message: 'The parsing service answered unexpectedly. Try again shortly.' },
  };
}

function invalidResponse(): ParseResult {
  return {
    ok: false,
    error: { kind: 'invalid-response', message: "Couldn't understand that. Try rewording it, or enter it manually." },
  };
}
