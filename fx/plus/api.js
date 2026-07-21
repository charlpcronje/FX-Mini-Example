// fx/plus/api.js
//
// Node-first HTTP — the FX-native way to talk to a server. No `$.` statics:
// you select a binding the same way you select anything in FX, then act on it.
//
//   const users = $$("app.users@/api/users").get();     // returns parsed body
//                                                       // …AND grafts it onto app.users
//   $$("app.saved@/api/save").post({ name: "Ada" });    // the argument IS the payload
//   $$("app.users@/api/users").get({ active: 1 });      // GET payload → query string
//
// Config never rides the payload — it lives in .options() (persists on the
// cached binding, so set it once), a one-shot second argument, or globally
// in $.ajaxSetup:
//
//   $$("app.pic@/api/pic").options({ dataType: "blob" }).get();
//   $$("@/api/x").get(null, { schema: { pick: { ok: "ok", title: "data.title" } } });
//   $.ajaxSetup({ schema: { template: "envelope" } });   // response template, app-wide
//
// Response templates decide the SHAPE of what verbs return and nodes receive:
// "data" (default — parsed body), "envelope" ({ok,status,data,error,…}), a
// registered custom name ($.ajaxSetup({ templates: { api: env => … } })), an
// inline { map: env => … } function, or a declarative { pick: {out: "path"} }.
//
// Everything rides FxAjax, so inside any replay boundary (event handlers,
// ready callbacks, effect callbacks, computed) the request SUSPENDS via the
// kernel's FXSuspend instead of blocking the UI, replays exactly once, and
// the node fan-out happens on the completing pass. Outside a boundary it
// falls back to blocking sync XHR — same contract as the kernel.
//
// This upgrades fx-mini's own `path@url` API bindings in place: module and
// text-asset @-loads still go to the kernel untouched; only HTTP specs
// (absolute `/…` or `http(s)://…`, not .js/.html/.md/… files) route here.

import { log } from "./logger.js";
import { FxEnv } from "./kit.js";
import { FxAjax } from "./ajax.js";

const MODULE_RE = /\.(m?js|tsx?|jsx)$/i;
const TEXT_RE = /\.(html?|txt|md|css|svg|xml)$/i;

/** Same api-detection rule as the kernel's buildAtBinding. */
export function isApiSpec(spec) {
  if (typeof spec !== "string" || !spec) return false;
  if (MODULE_RE.test(spec) || TEXT_RE.test(spec)) return false;
  return /^https?:\/\//i.test(spec) || (spec.startsWith("/") && !spec.startsWith("//"));
}

export class FxApiBinding {
  #nodePath;
  #url;
  #opts = {};

  constructor(nodePath, url) {
    this.#nodePath = nodePath || null;
    this.#url = url;
  }

  get url() { return this.#url; }
  get nodePath() { return this.#nodePath; }
  get __fxApiBinding() { return true; } // duck-marker (FxContext, no import cycle)

  /** Persistent config for this binding: headers, schema, dataType, global, suspend… */
  options(o) {
    this.#opts = { ...this.#opts, ...(o || {}) };
    return this;
  }

  get(query, opts) { return this.#run("GET", query, opts); }
  fetch(query, opts) { return this.#run("GET", query, opts); }
  post(data, opts) { return this.#run("POST", data, opts); }
  put(data, opts) { return this.#run("PUT", data, opts); }
  patch(data, opts) { return this.#run("PATCH", data, opts); }
  delete(data, opts) { return this.#run("DELETE", data, opts); }

  #node() {
    if (!this.#nodePath) return null;
    try { return FxEnv.$$(this.#nodePath); }
    catch (e) { log.error(`api binding: node "${this.#nodePath}" unresolved:`, e); return null; }
  }

  #run(method, payload, perCall) {
    const o = { ...this.#opts, ...(perCall || {}), url: this.#url, method };
    if (payload !== undefined && payload !== null) o.data = payload; // GET → query, else body
    const envelope = FxAjax.request(o);       // suspends inside replay boundaries
    const shaped = FxAjax.shape(envelope, o); // response template applies everywhere
    const dataMode = FxAjax.isDataTemplate(o);
    const node = this.#node();
    if (node) {
      try {
        if (envelope.ok) node.set(shaped);
        else node.set(dataMode
          ? { error: String(envelope.error?.message || "request failed"), status: envelope.status }
          : shaped);
      } catch (e) { log.error("api binding: node fan-out failed:", e); }
    }
    if (o.global && envelope.ok) {
      try { globalThis[o.global] = shaped; } catch { /* frozen global — skip */ }
    }
    try {
      if (envelope.ok) o.success?.(envelope.data, envelope.status, envelope.xhr);
      else o.error?.(envelope.error, envelope.status, envelope.xhr);
      o.complete?.(envelope);
    } catch (e) { log.error("api binding callback failed:", e); }
    return envelope.ok ? shaped : (dataMode ? envelope.data : shaped);
  }
}

/**
 * Wrap globalThis.$$ so `path@spec` calls with an HTTP spec return an
 * FxApiBinding (cached per path@spec, like the kernel's atBindingCache).
 * Everything else — plain node paths, module loads, text assets, arrays,
 * two-arg writes — delegates to the original $$ untouched.
 */
export function installApiDollar() {
  const original = globalThis.$$;
  if (typeof original !== "function") {
    log.warn("installApiDollar: $$ not found — node-first HTTP not installed");
    return original;
  }
  if (original.__fxApiWrapped) return original;

  const cache = new Map(); // "nodePath@spec" -> FxApiBinding

  const base = function (path, value) {
    try {
      if (typeof path === "string" && path.includes("@")) {
        const at = path.indexOf("@");
        const nodePath = path.slice(0, at);
        const spec = path.slice(at + 1);
        if (isApiSpec(spec)) {
          const key = `${nodePath}@${spec}`;
          let binding = cache.get(key);
          if (!binding) { binding = new FxApiBinding(nodePath, spec); cache.set(key, binding); }
          return binding;
        }
      }
    } catch (e) {
      log.error("$$ api routing failed — delegating to kernel:", e);
    }
    return original(path, value);
  };

  const wrapped = new Proxy(base, {
    get: (_t, key) => (key === "__fxApiWrapped" ? true : Reflect.get(original, key)),
    set: (_t, key, v) => Reflect.set(original, key, v),
    has: (_t, key) => key === "__fxApiWrapped" || Reflect.has(original, key),
  });

  globalThis.$$ = wrapped;
  log.info("node-first HTTP installed — $$(\"node@url\").get()/.post()/… ride suspend/replay");
  return wrapped;
}

export default FxApiBinding;
