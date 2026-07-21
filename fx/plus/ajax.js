// fx/plus/ajax.js
//
// AJAX with FX's contract: the answer IS the return value —
//   const users = $.get("/api/users");                 // parsed, next line
//   $.get("/api/users", "app.users");                  // …AND into the reactive graph
//   const env = $.http({ url, method: "PUT", body });  // full envelope, never throws
//
// HOW it stays synchronous depends on where you call it:
//   • Inside a replay boundary (any plus event handler, $(fn) ready, effect
//     callback, $computed) the request runs via background fetch + kernel
//     FXSuspend: the handler suspends, the UI thread stays FREE, and the
//     handler REPLAYS when the response lands — the memo in FxReplay makes
//     requests (including POSTs) fire exactly once across replays.
//   • Outside a boundary (top level, console, third-party callbacks) it falls
//     back to the classic blocking sync XHR, so the contract still holds.
// Opt out per call with { suspend: false } or globally via $.ajaxSetup().

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxEnv } from "./kit.js";
import { FxUtil } from "./util.js";
import { FxReplay } from "./replay.js";

export class FxAjaxError extends Error {
  constructor(message, status, url, xhr) {
    super(message);
    this.name = "FxAjaxError";
    this.status = status;
    this.url = url;
    this.xhr = xhr;
  }
}

export class FxAjax {
  static defaults = {
    method: "GET", dataType: "auto", headers: {}, cache: true, throws: false, suspend: true,
    schema: { template: "data" },   // response template: what callers (and nodes) receive
  };

  /** Named response templates: envelope in → caller-facing shape out. */
  static templates = {
    data: (env) => env.data,
    envelope: (env) => env,
  };

  /** Register a custom named template: FxAjax.template("api", env => ({...})). */
  static template(name, fn) {
    if (typeof name !== "string" || typeof fn !== "function") {
      log.warn("FxAjax.template(name, fn): bad arguments");
      return;
    }
    this.templates[name] = fn;
  }

  /** Effective schema for a request (per-call > binding/options > setup defaults). */
  static effectiveSchema(o) {
    if (o?.envelope === true) return { template: "envelope" }; // legacy alias
    return o?.schema ?? this.defaults.schema ?? { template: "data" };
  }

  /** Is the plain body-only template in effect (drives error-shape compat)? */
  static isDataTemplate(o) {
    const s = this.effectiveSchema(o);
    return !!s && typeof s !== "function" && !s.map && !s.pick && (s.template ?? "data") === "data";
  }

  /** Apply the response template to an envelope. Never throws. */
  static shape(envelope, o) {
    const schema = this.effectiveSchema(o);
    try {
      if (typeof schema === "function") return schema(envelope);
      if (typeof schema?.map === "function") return schema.map(envelope);
      if (schema?.pick && typeof schema.pick === "object") {
        const out = {};
        for (const key of Object.keys(schema.pick)) {
          out[key] = String(schema.pick[key]).split(".")
            .reduce((v, k) => (v == null ? undefined : v[k]), envelope);
        }
        return out;
      }
      const name = schema?.template ?? "data";
      const fn = this.templates[name];
      if (typeof fn === "function") return fn(envelope);
      log.warn(`unknown response template "${name}" — using "data"`);
      return envelope.data;
    } catch (e) {
      log.error("response template failed — returning raw data:", e);
      return envelope.data;
    }
  }

  /**
   * Core request. Returns { ok, status, statusText, url, data, xhr, error }.
   * Suspends (throws kernel FXSuspend) instead of blocking when a replay
   * boundary is active and suspension isn't disabled.
   */
  static request(options) {
    const o = { ...this.defaults, ...(options || {}) };
    o.method = String(o.type || o.method || "GET").toUpperCase();
    let url = String(o.url ?? "");
    if (!url) {
      const error = new FxAjaxError("no url given", 0, url, null);
      log.warn("$.http failed:", error.message);
      return { ok: false, status: 0, statusText: "", url, data: undefined, xhr: null, error };
    }

    let body = o.body ?? o.data;
    if (o.method === "GET" || o.method === "HEAD") {
      if (body && typeof body === "object") url += (url.includes("?") ? "&" : "?") + FxUtil.param(body);
      else if (typeof body === "string" && body) url += (url.includes("?") ? "&" : "?") + body;
      body = undefined;
    }

    // ── suspend path: background fetch + replay (UI thread stays free) ──
    if (o.suspend !== false && FxReplay.active && FxReplay.canSuspend) {
      // Key EXCLUDES the cache-buster (a per-attempt timestamp would never
      // match its own replay); the buster is applied inside the fetch itself.
      const key = `${o.method} ${url} ${body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)}`;
      if (FxReplay.memoHas(key)) return FxReplay.memoGet(key);
      const promise = FxReplay.inflightHas(key)
        ? FxReplay.inflightGet(key)
        : this.#fetchEnvelope(o, url, body, key);
      const suspension = FxReplay.suspension(promise);
      if (suspension) throw suspension;
      // Kernel missing (shouldn't happen once booted) — fall through to XHR.
    }

    // ── blocking path: classic synchronous XHR ───────────────────────
    if (o.cache === false) url += (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    const envelope = { ok: false, status: 0, statusText: "", url, data: undefined, xhr: null, error: null };
    if (o.dataType === "blob" || o.dataType === "arrayBuffer") {
      // sync XHR cannot change responseType — binary needs the suspend path
      envelope.error = new FxAjaxError(
        `dataType "${o.dataType}" requires a replay boundary (call from an event handler)`, 0, url, null);
      log.warn("$.http failed:", envelope.error.message);
      return envelope;
    }
    try {
      const xhr = new XMLHttpRequest();
      envelope.xhr = xhr;
      xhr.open(o.method, url, false /* synchronous fallback */);
      const headers = this.#headersFor(o, body);
      for (const k of Object.keys(headers)) xhr.setRequestHeader(k, headers[k]);
      xhr.send(this.#encodeBody(body));
      envelope.status = xhr.status;
      envelope.statusText = xhr.statusText;
      envelope.ok = xhr.status >= 200 && xhr.status < 300;
      envelope.data = this.#parseText(xhr.responseText ?? "", xhr.getResponseHeader("content-type") || "", o.dataType);
      if (!envelope.ok) envelope.error = new FxAjaxError(`HTTP ${xhr.status} for ${url}`, xhr.status, url, xhr);
    } catch (e) {
      envelope.error = e instanceof FxAjaxError ? e : new FxAjaxError(String(e?.message || e), 0, url, envelope.xhr);
    }
    if (envelope.error) log.warn("$.http failed:", envelope.error.message);
    return envelope;
  }

  /** Background fetch that settles into the replay memo (exactly-once). */
  static #fetchEnvelope(o, url, body, key) {
    const target = o.cache === false ? url + (url.includes("?") ? "&" : "?") + "_=" + Date.now() : url;
    const promise = (async () => {
      const envelope = { ok: false, status: 0, statusText: "", url: target, data: undefined, xhr: null, error: null };
      try {
        const res = await fetch(target, { method: o.method, headers: this.#headersFor(o, body), body: this.#encodeBody(body) });
        envelope.status = res.status;
        envelope.statusText = res.statusText;
        envelope.ok = res.ok;
        if (o.dataType === "blob") envelope.data = await res.blob();               // binary —
        else if (o.dataType === "arrayBuffer") envelope.data = await res.arrayBuffer(); // fetch-only
        else envelope.data = this.#parseText(await res.text(), res.headers.get("content-type") || "", o.dataType);
        if (!res.ok) envelope.error = new FxAjaxError(`HTTP ${res.status} for ${target}`, res.status, target, null);
      } catch (e) {
        envelope.error = new FxAjaxError(String(e?.message || e), 0, target, null);
      }
      if (envelope.error) log.warn("$.http (suspended) failed:", envelope.error.message);
      FxReplay.memoSet(key, envelope);   // BEFORE the replay resumes
      FxReplay.inflightDelete(key);
      return envelope;
    })();
    FxReplay.inflightSet(key, promise);
    return promise;
  }

  static #headersFor(o, body) {
    const headers = { ...o.headers };
    const hasType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    if (body !== undefined && typeof body !== "string" && !(body instanceof FormData) && !hasType) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  static #encodeBody(body) {
    if (body === undefined) return undefined;
    return typeof body === "string" || body instanceof FormData ? body : JSON.stringify(body);
  }

  static #parseText(text, contentType, dataType) {
    if (dataType === "text" || dataType === "html") return text;
    const ct = contentType.toLowerCase();
    if (dataType === "json" || (dataType === "auto" && (ct.includes("json") || /^\s*[[{]/.test(text)))) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text;
  }

  /** Shared tail: node fan-out + jQuery callbacks + optional throwing. */
  static settle(envelope, o = {}) {
    const shaped = this.shape(envelope, o);
    if (envelope.ok && o.into != null) {
      const node = FxEnv.toNode(o.into);
      if (node) node.set(shaped);
      else log.warn("$.ajax into-target did not resolve:", o.into);
    }
    try {
      if (envelope.ok) o.success?.(envelope.data, envelope.status, envelope.xhr);
      else o.error?.(envelope.error, envelope.status, envelope.xhr);
      o.complete?.(envelope);
    } catch (e) { log.error("ajax callback failed:", e); }
    if (!envelope.ok && o.throws) throw envelope.error;
    if (envelope.ok) return shaped;
    return this.isDataTemplate(o) ? undefined : shaped; // jQuery-compat: data mode → undefined on error
  }
}

// ── $ statics ────────────────────────────────────────────────────────
FxPlus.util("http", (opts) => FxAjax.request(opts));

/** The one home for defaults AND response templates:
 *    $.ajaxSetup({ schema: { template: "envelope" } })
 *    $.ajaxSetup({ templates: { api: (env) => ({ ok: env.ok, body: env.data }) } })
 */
FxPlus.util("ajaxSetup", (opts) => {
  const o = { ...(opts || {}) };
  if (o.templates && typeof o.templates === "object") {
    for (const name of Object.keys(o.templates)) FxAjax.template(name, o.templates[name]);
    delete o.templates;
  }
  return Object.assign(FxAjax.defaults, o);
});

FxPlus.util("ajax", (urlOrOpts, maybeOpts) => {
  const o = typeof urlOrOpts === "string" ? { ...(maybeOpts || {}), url: urlOrOpts } : (urlOrOpts || {});
  return FxAjax.settle(FxAjax.request(o), o);
});

const isInto = (x) => typeof x === "string" || FxEnv.isNode(x);

FxPlus.util("get", (url, dataOrInto, into) => {
  const data = isInto(dataOrInto) ? undefined : dataOrInto;
  const target = isInto(dataOrInto) ? dataOrInto : into;
  const o = { url, method: "GET", data, into: target };
  return FxAjax.settle(FxAjax.request(o), o);
});

FxPlus.util("getJSON", (url, into) => {
  const o = { url, method: "GET", dataType: "json", into };
  return FxAjax.settle(FxAjax.request(o), o);
});

FxPlus.util("post", (url, data, into) => {
  const o = { url, method: "POST", data, into };
  return FxAjax.settle(FxAjax.request(o), o);
});

// ── the classic .load() ──────────────────────────────────────────────
FxPlus.handle("load", (h, [urlSpec, cb]) => {
  const spec = String(urlSpec ?? "").trim();
  if (!spec) { log.warn(".load(): url required"); return h; }
  const sp = spec.indexOf(" ");
  const url = sp === -1 ? spec : spec.slice(0, sp);
  const selector = sp === -1 ? null : spec.slice(sp + 1).trim();
  const env = FxAjax.request({ url, dataType: "html" }); // suspends inside boundaries
  if (env.ok) {
    let html = String(env.data ?? "");
    if (selector) {
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      html = Array.from(tpl.content.querySelectorAll(selector)).map((n) => n.outerHTML).join("");
    }
    h.html(html); // decorated .html(): binding hygiene + hydration
  } else {
    log.warn(`.load(${url}) failed:`, env.error?.message);
  }
  if (typeof cb === "function") {
    try { cb.call(h.el, env.data, env.ok ? "success" : "error", env.xhr); }
    catch (e) { log.error(".load() callback failed:", e); }
  }
  return h;
}, "chain");

export default FxAjax;
