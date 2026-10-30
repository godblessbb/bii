// HTTP client for the sticker backend, exactly as specified in _dev/sticker/api_contract.md.
// DOM-free (fetch, FormData, Blob and AbortController exist in Node too), so it is unit tested
// with a fake fetch. The local mock with the same surface lives in api-mock.js.

export class ApiError extends Error {
  constructor({ status = 0, code = 'internal', message = 'Something went wrong on our side.', field = null, retryable = false, extra = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryable = retryable;
    this.extra = extra;
  }
}

export const GENERATION_TIMEOUT_MS = 65000; // server gives up at 60 s (contract §3); we wait a little longer
const DEFAULT_TIMEOUT_MS = 20000;
const UPLOAD_TIMEOUT_MS = 60000;

export function createHttpApi(base, { fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const root = String(base).replace(/\/+$/, '') + '/v1';

  async function call(method, path, { json, body, headers = {}, timeout = DEFAULT_TIMEOUT_MS, idempotencyKey } = {}) {
    const h = { Accept: 'application/json', ...headers };
    let payload = body;
    if (json !== undefined) {
      h['Content-Type'] = 'application/json; charset=utf-8';
      payload = JSON.stringify(json);
    }
    if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetchImpl(root + path, { method, headers: h, body: payload, signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
    } catch (e) {
      if (ctrl.signal.aborted) {
        throw new ApiError({ code: 'provider_timeout', message: 'That took too long. Nothing was used up; please try again.', retryable: true });
      }
      throw new ApiError({ code: 'network_error', message: 'We couldn’t reach our server. Check your connection and try again.', retryable: true });
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const err = (data && data.error) || {};
      const { code, message, field, retryable, ...extra } = err;
      throw new ApiError({
        status: res.status,
        code: code || (res.status >= 500 ? 'internal' : 'bad_request'),
        message: message || `The server answered ${res.status}.`,
        field: field || null,
        retryable: retryable ?? res.status >= 500,
        extra: Object.keys(extra).length ? extra : null,
      });
    }
    return data;
  }

  return {
    kind: 'http',
    base: String(base),

    getPricing() {
      return call('GET', '/pricing');
    },

    // §2: the cutout PNG + meta; the original photo is never uploaded
    createDesign(cutoutBlob, meta) {
      const fd = new FormData();
      fd.append('cutout', cutoutBlob, 'cutout.png');
      fd.append('meta', JSON.stringify(meta));
      return call('POST', '/designs', { body: fd, timeout: UPLOAD_TIMEOUT_MS });
    },

    // §3: one style for a design (synchronous, up to 60 s on the server)
    async generate(designId, styleId) {
      const gen = await call('POST', `/designs/${encodeURIComponent(designId)}/generations`, { json: { style_id: styleId }, timeout: GENERATION_TIMEOUT_MS });
      return gen;
    },

    async fetchImage(url) {
      let res;
      try {
        res = await fetchImpl(url, { mode: 'cors', credentials: 'omit' });
      } catch {
        throw new ApiError({ code: 'network_error', message: 'We couldn’t download your sticker. Please try again.', retryable: true });
      }
      if (!res.ok) throw new ApiError({ status: res.status, code: 'provider_error', message: 'We couldn’t download your sticker. Please try again.', retryable: true });
      return res.blob();
    },

    // §6.1: raw bytes, id chosen by the browser
    upload(uploadId, blob, contentType) {
      return call('PUT', `/uploads/${encodeURIComponent(uploadId)}`, { body: blob, headers: { 'Content-Type': contentType }, timeout: UPLOAD_TIMEOUT_MS });
    },

    // §5 (optional)
    quote(payload) {
      return call('POST', '/quote', { json: payload });
    },

    // §6: designs and options only; the server prices the order itself
    checkout(payload, idempotencyKey) {
      return call('POST', '/checkout', { json: payload, idempotencyKey });
    },
  };
}

// The redirect target must be a real web page: https anywhere (Stripe), or a page of this site.
export function safeCheckoutUrl(url, pageUrl) {
  let u;
  try { u = new URL(url, pageUrl); } catch { return null; }
  const here = new URL(pageUrl);
  if (u.protocol === 'https:') return u.href;
  if (u.origin === here.origin && (u.protocol === 'http:' || u.protocol === 'https:')) return u.href;
  return null;
}
