// fx/plus/core.js
//
// FxPlus — the decoration engine that upgrades fx-mini's `$` in place.
//
// fx-mini builds Handles/Groups as fresh object literals per call, so the plus
// layer decorates every result the moment it leaves `$(...)`:
//   • all registered extension methods are attached (handle / group / root),
//   • traversal results (find/children/parent/closest/next/prev/each) are
//     decorated recursively, so chains never "lose" the extra methods,
//   • `$("<li>…</li>")` creates detached elements (jQuery-style),
//   • `$(fn)` runs fn on DOM-ready,
//   • `$.fn.myPlugin = function () {…}` registers a classic jQuery plugin.
//
// Registration API (used by the sibling modules at import time):
//   FxPlus.handle(name, (h, args, prev) => result, groupMode)
//   FxPlus.group(name, (g, args, prev) => result)     // explicit group impl
//   FxPlus.root(name, (r, args, prev) => result)      // $(document) / $(window)
//   FxPlus.util(name, fn)                             // static on $
//
// groupMode: "chain" (fan out, return group) | "first" (first element's result)
//          | "collect" (merge returned elements into a new set)
//          | (args, group) => one of the above — decided per call.

import { log } from "./logger.js";
import { FxPlusError, FxDom, FxEnv } from "./kit.js";
import { FxReplay } from "./replay.js";
import { FxContext } from "./context.js";

export class FxPlus {
  static VERSION = "1.0.0";

  static #handleExt = new Map(); // name -> { fn, groupMode }
  static #groupExt = new Map();  // name -> fn
  static #rootExt = new Map();   // name -> fn
  static #utils = new Map();     // name -> fn
  static #TRAVERSAL = ["find", "children", "parent", "closest", "next", "prev"];
  static #installed = false;
  static #orig$ = null;
  static #plus$ = null;

  // ── registration ─────────────────────────────────────────────────────
  static handle(name, fn, groupMode = "chain") {
    if (this.#handleExt.has(name)) log.debug(`handle .${name}() re-registered`);
    this.#handleExt.set(name, { fn, groupMode });
  }

  static group(name, fn) { this.#groupExt.set(name, fn); }
  static root(name, fn) { this.#rootExt.set(name, fn); }

  static util(name, fn) {
    this.#utils.set(name, fn);
    if (this.#installed && this.#plus$) this.#applyUtil(this.#plus$, name, fn);
  }

  // ── classification ───────────────────────────────────────────────────
  static kindOf(res) {
    if (!res || typeof res !== "object") return null;
    if (Array.isArray(res.elements)) return "group";
    if (typeof document !== "undefined" && (res.el === document || res.el === window)) return "root";
    if (res.el instanceof Element) return "handle";
    return null;
  }

  // ── decoration ───────────────────────────────────────────────────────
  static decorate(res) {
    try {
      if (res == null) return res;
      if (res.__fxp) return res;
      const kind = this.kindOf(res);
      if (!kind) return res;
      Object.defineProperty(res, "__fxp", { value: true, configurable: true, enumerable: false });

      for (const name of this.#TRAVERSAL) {
        if (typeof res[name] === "function") {
          const orig = res[name].bind(res);
          this.#define(res, name, (...args) => this.decorate(orig(...args)));
        }
      }

      if (kind === "group") {
        if (typeof res.each === "function") {
          const origEach = res.each.bind(res);
          this.#define(res, "each", (fn) => { origEach((h, i) => fn(this.decorate(h), i)); return res; });
        }
        for (const [name, def] of this.#handleExt) {
          if (!this.#groupExt.has(name)) this.#attachGroupDerived(res, name, def);
        }
        for (const [name, fn] of this.#groupExt) this.#attach(res, name, fn);
      } else if (kind === "handle") {
        for (const [name, def] of this.#handleExt) this.#attach(res, name, def.fn);
      } else {
        for (const [name, fn] of this.#rootExt) this.#attach(res, name, fn);
      }
      return res;
    } catch (e) {
      log.error("decorate failed:", e);
      return res;
    }
  }

  /** Wrap raw element(s) into a decorated null | Handle | Group (FX convention). */
  static wrap(els) {
    const $ = this.#orig$ || globalThis.$;
    if (typeof $ !== "function") return null;
    if (els == null) return null;
    const arr = Array.isArray(els) ? els.filter((e) => e instanceof Element) : [els];
    if (!arr.length) return null;
    return this.decorate($(arr.length === 1 ? arr[0] : arr));
  }

  static #attach(target, name, fn) {
    const prev = typeof target[name] === "function" ? target[name].bind(target) : null;
    this.#define(target, name, (...args) => {
      try {
        return fn(target, args, prev);
      } catch (e) {
        if (FxReplay.isSuspend(e)) throw e; // suspends must reach the replay boundary
        log.error(`$.${name}() failed:`, e);
        return target; // never break a chain
      }
    });
  }

  static #attachGroupDerived(g, name, def) {
    this.#define(g, name, (...args) => {
      try {
        const mode = typeof def.groupMode === "function" ? def.groupMode(args, g) : def.groupMode;
        const handles = g.elements.map((h) => this.decorate(h));
        if (mode === "first") {
          return handles.length ? handles[0][name](...args) : undefined;
        }
        if (mode === "collect") {
          const acc = [];
          for (const h of handles) acc.push(...FxDom.elementsOf(h[name](...args)));
          return this.wrap(FxDom.unique(acc));
        }
        for (const h of handles) h[name](...args); // "chain"
        return g;
      } catch (e) {
        if (FxReplay.isSuspend(e)) throw e; // suspends must reach the replay boundary
        log.error(`group $.${name}() failed:`, e);
        return g;
      }
    });
  }

  static #define(target, name, value) {
    try {
      Object.defineProperty(target, name, { value, configurable: true, writable: true, enumerable: false });
    } catch (e) {
      log.warn(`cannot attach .${name}():`, e);
    }
  }

  static #applyUtil(plus, name, fn) {
    try { plus[name] = fn; } catch (e) { log.warn(`cannot add $.${name}:`, e); }
  }

  // ── install ──────────────────────────────────────────────────────────
  static install() {
    if (this.#installed) return this.#plus$;
    const orig = globalThis.$;
    if (typeof orig !== "function") {
      throw new FxPlusError("fx-mini's $ not found — import fx/fx-mini.js before fx/fx-mini-plus.js");
    }
    this.#orig$ = orig;

    const self = this;
    const plus = function (sel, ctx) {
      try {
        if (typeof sel === "function") {                    // $(fn) → DOM ready (replay boundary)
          const run = () => { try { FxReplay.invoke(sel, undefined, [plus]); } catch (e) { log.error("$(fn) ready callback failed:", e); } };
          if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
          else queueMicrotask(run);
          return self.decorate(orig(document));
        }
        if (typeof sel === "string" && FxDom.isHtml(sel)) { // $("<li>…") → create detached
          const created = self.wrap(FxDom.parseHTML(sel));
          if (created && ctx && FxEnv.isNode(ctx)) return self.decorate(orig(FxDom.elementsOf(created), ctx));
          return created;
        }
        // Second argument: an FX NODE keeps its two-way-bind meaning (kernel
        // behavior); anything else is a selection CONTEXT — an HTML string
        // (stamped clones), a live element/handle/group, a context selector,
        // or a node-first api binding (fetched as html).
        if (ctx != null && !FxEnv.isNode(ctx)) {
          return self.wrap(FxContext.selectElements(sel, ctx));
        }
        return self.decorate(orig(sel, ctx));
      } catch (e) {
        if (FxReplay.isSuspend(e)) throw e;                 // let boundaries replay
        log.error("$(...) failed:", e);
        return null;
      }
    };

    for (const k of Object.getOwnPropertyNames(orig)) {     // carry $.apply op-applier etc.
      if (k === "length" || k === "name" || k === "prototype") continue;
      try { plus[k] = orig[k]; } catch { /* read-only — skip */ }
    }
    Object.defineProperty(plus, "__fxPlus", { value: true, enumerable: false });
    for (const [name, fn] of this.#utils) this.#applyUtil(plus, name, fn);
    this.#buildFnBridge(plus);

    globalThis.$ = plus;
    globalThis.$dom = plus;
    this.#plus$ = plus;
    this.#installed = true;
    log.info(`FX Mini Plus v${this.VERSION} installed — ${this.#handleExt.size} handle methods, ${this.#utils.size} utilities`);
    return plus;
  }

  /** jQuery-style plugin bridge: `$.fn.highlight = function (color) {…}`. */
  static #buildFnBridge(plus) {
    const store = Object.create(null);
    plus.fn = new Proxy(store, {
      set: (t, name, fn) => {
        if (typeof name !== "string" || typeof fn !== "function") {
          log.warn("$.fn assignments need a string name and a function");
          return true;
        }
        t[name] = fn;
        FxPlus.handle(name, (h, args) => {
          const out = fn.apply(h, args);
          return out === undefined ? h : out;
        }, "chain");
        log.info(`$.fn.${name} plugin registered`);
        return true;
      },
    });
  }

  static get installed() { return this.#installed; }
  static get original$() { return this.#orig$; }
}
