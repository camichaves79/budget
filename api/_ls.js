/**
 * Lemon Squeezy API calls for the license functions (server-side only).
 * The LS API key never reaches the client.
 *
 * Docs: docs.lemonsqueezy.com/api — JSON:API with Bearer auth; the License
 * API (activate/validate/deactivate) is form-encoded WITHOUT a Bearer key
 * and is rate-limited to 60 req/min.
 */

const LS_API = 'https://api.lemonsqueezy.com/v1';

function apiKey() {
  return (process.env.LEMONSQUEEZY_API_KEY ?? '').trim() || null;
}

function jsonApiHeaders() {
  return {
    Authorization: `Bearer ${apiKey()}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };
}

/** @param {unknown} payload @returns {Record<string, unknown> | null} */
function attributesOf(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = /** @type {Record<string, unknown>} */ (payload).data;
  if (!data || typeof data !== 'object') return null;
  const attrs = /** @type {Record<string, unknown>} */ (data).attributes;
  if (!attrs || typeof attrs !== 'object') return null;
  return /** @type {Record<string, unknown>} */ (attrs);
}

/**
 * Fetch one order's attributes by numeric id (GET /v1/orders/{id}).
 * @param {string} orderId
 * @returns {Promise<{ status: number, attributes: Record<string, unknown> | null }>}
 */
export async function fetchOrderById(orderId) {
  const key = apiKey();
  if (!key) return { status: 0, attributes: null };
  try {
    const res = await fetch(`${LS_API}/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.api+json' },
    });
    if (!res.ok) return { status: res.status, attributes: null };
    const payload = await res.json();
    return { status: 200, attributes: attributesOf(payload) };
  } catch {
    return { status: 0, attributes: null };
  }
}

/**
 * Fetch the first order matching an order_number (GET /v1/orders?filter[order_number]=N).
 * Returns the NUMERIC order id alongside the attributes — the id is what the
 * LS order endpoints (e.g. generate-invoice) accept, while the attributes'
 * `identifier` is the UUID used for Firestore doc keys.
 * @param {string} orderNumber
 * @returns {Promise<{ id: string, attributes: Record<string, unknown> } | null>}
 */
export async function findOrderByNumber(orderNumber) {
  const key = apiKey();
  if (!key) return null;
  try {
    const url = `${LS_API}/orders?filter[order_number]=${encodeURIComponent(orderNumber)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.api+json' },
    });
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload || typeof payload !== 'object') return null;
    const list = /** @type {Record<string, unknown>} */ (payload).data;
    if (!Array.isArray(list) || list.length === 0) return null;
    const first = list[0];
    if (!first || typeof first !== 'object') return null;
    const attrs = /** @type {Record<string, unknown>} */ ((/** @type {Record<string, unknown>} */ (first)).attributes);
    const id = /** @type {Record<string, unknown>} */ (first).id;
    if (!attrs || typeof attrs !== 'object') return null;
    return { id: typeof id === 'string' ? id : String(id ?? ''), attributes: attrs };
  } catch {
    return null;
  }
}

/**
 * List order attributes for a buyer email (GET /v1/orders?filter[user_email]=X),
 * newest first — the self-heal path for "paid but never redeemed".
 * @param {string} email
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function findOrdersByEmail(email) {
  const key = apiKey();
  if (!key || !email) return [];
  try {
    const url = `${LS_API}/orders?filter[user_email]=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.api+json' },
    });
    if (!res.ok) return [];
    const payload = await res.json();
    if (!payload || typeof payload !== 'object') return [];
    const list = /** @type {Record<string, unknown>} */ (payload).data;
    if (!Array.isArray(list)) return [];
    /** @type {Array<Record<string, unknown>>} */
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const attrs = /** @type {Record<string, unknown>} */ (item).attributes;
      if (attrs && typeof attrs === 'object') out.push(/** @type {Record<string, unknown>} */ (attrs));
    }
    out.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    return out;
  } catch {
    return [];
  }
}

/**
 * Validate a Lemon Squeezy license key via the License API (form-encoded,
 * no Bearer). Returns the validation meta (order_id, customer email,
 * product info) when the key is valid — this is how a redirect/pasted key
 * resolves back to its order WITHOUT consuming an activation.
 * @param {string} key
 * @returns {Promise<{ valid: boolean, meta: Record<string, unknown> | null }>}
 */
export async function validateLicenseKey(key) {
  try {
    const res = await fetch(`${LS_API}/licenses/validate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ license_key: key }).toString(),
    });
    const payload = await res.json();
    if (!payload || typeof payload !== 'object') return { valid: false, meta: null };
    const p = /** @type {Record<string, unknown>} */ (payload);
    const meta = p.meta && typeof p.meta === 'object' ? /** @type {Record<string, unknown>} */ (p.meta) : null;
    return { valid: Boolean(p.valid), meta };
  } catch {
    return { valid: false, meta: null };
  }
}

/**
 * Generate the order invoice (POST /v1/orders/{id}/generate-invoice) so the
 * ledger can carry a download link for the accountant. Best-effort: failures
 * leave invoiceUrl null and the receipt URL still exists.
 * @param {string} orderId
 * @returns {Promise<string | null>} download_invoice URL or null
 */
export async function generateOrderInvoice(orderId) {
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetch(`${LS_API}/orders/${encodeURIComponent(orderId)}/generate-invoice`, {
      method: 'POST',
      headers: jsonApiHeaders(),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    let meta = null;
    if (payload && typeof payload === 'object') {
      const m = /** @type {Record<string, unknown>} */ (payload).meta;
      meta = m && typeof m === 'object' ? m : null;
    }
    const metaObj = meta !== null ? /** @type {Record<string, unknown>} */ (meta) : null;
    const urls =
      metaObj && typeof metaObj.urls === 'object' ? /** @type {Record<string, unknown>} */ (metaObj.urls) : null;
    return typeof urls?.download_invoice === 'string' ? /** @type {string} */ (urls.download_invoice) : null;
  } catch {
    return null;
  }
}
