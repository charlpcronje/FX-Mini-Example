// fx/plus/data.js
//
// FxData — jQuery's .data()/.removeData() with the same read semantics:
// a WeakMap side-store first, `data-*` attributes as fallback (with jQuery's
// type coercion: "true" → true, "3" → 3, "{...}" → object). The store is also
// used internally by effects (remembered display / opacity).

import { log } from "./logger.js";
import { FxPlus } from "./core.js";

export class FxData {
  static #store = new WeakMap(); // Element -> Map<string, any>

  static #map(el, create) {
    let m = this.#store.get(el);
    if (!m && create) { m = new Map(); this.#store.set(el, m); }
    return m;
  }

  static camel(s) { return String(s).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

  /** jQuery-style coercion of a data-attribute string. */
  static coerce(v) {
    if (typeof v !== "string") return v;
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "null") return null;
    if (v !== "" && !Number.isNaN(Number(v)) && String(Number(v)) === v) return Number(v);
    if (/^(?:\{[\s\S]*\}|\[[\s\S]*\])$/.test(v.trim())) {
      try { return JSON.parse(v); } catch { /* not JSON — keep the string */ }
    }
    return v;
  }

  static get(el, key) {
    try {
      const k = this.camel(key);
      const m = this.#map(el, false);
      if (m && m.has(k)) return m.get(k);
      if (el.dataset && k in el.dataset) return this.coerce(el.dataset[k]);
    } catch (e) { log.warn("FxData.get failed:", e); }
    return undefined;
  }

  static getAll(el) {
    const out = {};
    try {
      if (el.dataset) for (const k of Object.keys(el.dataset)) out[k] = this.coerce(el.dataset[k]);
      const m = this.#map(el, false);
      if (m) for (const [k, v] of m) out[k] = v;
    } catch (e) { log.warn("FxData.getAll failed:", e); }
    return out;
  }

  static set(el, key, value) {
    try { this.#map(el, true).set(this.camel(key), value); }
    catch (e) { log.warn("FxData.set failed:", e); }
  }

  static remove(el, key) {
    try {
      const m = this.#map(el, false);
      if (!m) return;
      if (key === undefined) m.clear();
      else m.delete(this.camel(key));
    } catch (e) { log.warn("FxData.remove failed:", e); }
  }
}

// ── handle methods ───────────────────────────────────────────────────
const dataMode = (args) =>
  (args.length === 0 || (args.length === 1 && typeof args[0] === "string")) ? "first" : "chain";

FxPlus.handle("data", (h, [key, value]) => {
  if (key === undefined) return FxData.getAll(h.el);
  if (typeof key === "object" && key !== null) {
    for (const k of Object.keys(key)) FxData.set(h.el, k, key[k]);
    return h;
  }
  if (value === undefined) return FxData.get(h.el, key);
  FxData.set(h.el, key, value);
  return h;
}, dataMode);

FxPlus.handle("removeData", (h, [key]) => {
  FxData.remove(h.el, key);
  return h;
}, "chain");

export default FxData;
