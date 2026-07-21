// fx/plus/util.js
//
// FxUtil — the classic jQuery static utilities, attached to `$` at install:
// $.each, $.map, $.grep, $.inArray, $.merge, $.extend (deep), $.param,
// $.isPlainObject, $.isEmptyObject, $.type, $.trim, $.now, $.noop,
// $.contains, $.uniqueSort, $.parseHTML, $.parseJSON, $.escapeSelector.

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxDom } from "./kit.js";

export class FxUtil {
  static isPlainObject(o) {
    if (o === null || typeof o !== "object") return false;
    const proto = Object.getPrototypeOf(o);
    return proto === null || proto === Object.prototype;
  }

  static isEmptyObject(o) {
    for (const k in o) return false;
    return true;
  }

  static type(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (v instanceof Date) return "date";
    if (v instanceof RegExp) return "regexp";
    return typeof v;
  }

  static trim(s) { return s == null ? "" : String(s).trim(); }
  static now() { return Date.now(); }
  static noop() {}

  /** jQuery.each — arrays: fn(i, v); objects: fn(k, v); `this` = v; false breaks. */
  static each(obj, fn) {
    try {
      if (obj == null) return obj;
      if (Array.isArray(obj) || typeof obj.length === "number" && typeof obj !== "function") {
        const arr = Array.from(obj);
        for (let i = 0; i < arr.length; i++) if (fn.call(arr[i], i, arr[i]) === false) break;
      } else {
        for (const k of Object.keys(obj)) if (fn.call(obj[k], k, obj[k]) === false) break;
      }
    } catch (e) { log.error("$.each failed:", e); }
    return obj;
  }

  /** jQuery.map — fn(v, i); null/undefined results dropped, arrays flattened. */
  static map(obj, fn) {
    const out = [];
    try {
      const push = (v) => { if (v != null) Array.isArray(v) ? out.push(...v) : out.push(v); };
      if (obj == null) return out;
      if (Array.isArray(obj) || typeof obj.length === "number" && typeof obj !== "function") {
        Array.from(obj).forEach((v, i) => push(fn(v, i)));
      } else {
        for (const k of Object.keys(obj)) push(fn(obj[k], k));
      }
    } catch (e) { log.error("$.map failed:", e); }
    return out;
  }

  static grep(arr, fn, invert = false) {
    try { return Array.from(arr ?? []).filter((v, i) => Boolean(fn(v, i)) !== invert); }
    catch (e) { log.error("$.grep failed:", e); return []; }
  }

  static inArray(value, arr, fromIndex = 0) {
    try { return Array.from(arr ?? []).indexOf(value, fromIndex); }
    catch { return -1; }
  }

  static merge(first, second) {
    try {
      const items = Array.from(second ?? []);
      let i = first.length;
      for (const v of items) first[i++] = v;
      if (!Array.isArray(first)) first.length = i;
      return first;
    } catch (e) { log.error("$.merge failed:", e); return first; }
  }

  /** Full jQuery.extend semantics, including `$.extend(true, target, …)` deep mode. */
  static extend(...args) {
    let deep = false, i = 0;
    if (typeof args[0] === "boolean") { deep = args[0]; i = 1; }
    const target = args[i++] ?? {};
    for (; i < args.length; i++) {
      const src = args[i];
      if (src == null) continue;
      for (const key of Object.keys(src)) {
        const copy = src[key];
        if (target === copy) continue; // avoid self-reference loops
        if (deep && copy && (FxUtil.isPlainObject(copy) || Array.isArray(copy))) {
          const existing = target[key];
          const base = Array.isArray(copy)
            ? (Array.isArray(existing) ? existing : [])
            : (FxUtil.isPlainObject(existing) ? existing : {});
          target[key] = FxUtil.extend(true, base, copy);
        } else if (copy !== undefined) {
          target[key] = copy;
        }
      }
    }
    return target;
  }

  static contains(container, contained) {
    try { return !!container && !!contained && container !== contained && container.contains(contained); }
    catch { return false; }
  }

  static uniqueSort(els) { return FxDom.unique(Array.from(els ?? [])); }

  static parseHTML(html) { return FxDom.parseHTML(html); }

  static parseJSON(s) {
    try { return JSON.parse(s); }
    catch (e) { log.error("$.parseJSON failed:", e); return null; }
  }

  static escapeSelector(s) {
    try { return CSS.escape(String(s)); }
    catch { return String(s).replace(/([^\w-])/g, "\\$1"); }
  }

  /** jQuery.param — serialise an object/array into an URL query string. */
  static param(obj) {
    const parts = [];
    const add = (key, value) => {
      const v = typeof value === "function" ? value() : value;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v == null ? "" : v)}`);
    };
    const build = (prefix, value) => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => {
          if (/\[\]$/.test(prefix)) add(prefix, v);
          else build(`${prefix}[${typeof v === "object" && v != null ? i : ""}]`, v);
        });
      } else if (FxUtil.isPlainObject(value)) {
        for (const k of Object.keys(value)) build(`${prefix}[${k}]`, value[k]);
      } else {
        add(prefix, value);
      }
    };
    try {
      if (Array.isArray(obj)) {
        obj.forEach((item) => add(item.name, item.value)); // serializeArray form
      } else if (obj && typeof obj === "object") {
        for (const k of Object.keys(obj)) build(k, obj[k]);
      }
    } catch (e) { log.error("$.param failed:", e); }
    return parts.join("&");
  }
}

// ── register as $ statics ────────────────────────────────────────────
for (const name of [
  "each", "map", "grep", "inArray", "merge", "extend", "param",
  "isPlainObject", "isEmptyObject", "type", "trim", "now", "noop",
  "contains", "uniqueSort", "parseHTML", "parseJSON", "escapeSelector",
]) {
  FxPlus.util(name, FxUtil[name].bind(FxUtil));
}

export default FxUtil;
