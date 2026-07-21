// fx/plus/kit.js
//
// Shared low-level kit for FX Mini Plus:
//   FxPlusError — typed error for the whole extension layer
//   FxEnv       — lazy, validated access to the fx-mini globals ($$, fx, $hydrate)
//   FxBindings  — per-element registry of reactive unbinders (leak hygiene)
//   FxReactive  — "value or live node" application helper (tracked watchers)
//   FxDom       — HTML parsing / content normalisation / element utilities

import { log } from "./logger.js";

export class FxPlusError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "FxPlusError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Lazy accessors for the globals fx-mini publishes at boot. */
export class FxEnv {
  static get $$() {
    const d = globalThis.$$;
    if (typeof d !== "function") throw new FxPlusError("fx-mini not booted: global $$ is missing");
    return d;
  }

  static get fx() {
    const f = globalThis.fx;
    if (!f || !f.root) throw new FxPlusError("fx-mini not booted: global fx is missing");
    return f;
  }

  static get hydrate() {
    return typeof globalThis.$hydrate === "function" ? globalThis.$hydrate : null;
  }

  /** Is `x` an FX node proxy (same duck-check fx-mini itself uses)? */
  static isNode(x) {
    return !!x && typeof x === "function" && typeof x.node === "function" && typeof x.watch === "function";
  }

  /** Coerce a node proxy OR a dotted path string to a node proxy (else null). */
  static toNode(x) {
    try {
      if (FxEnv.isNode(x)) return x;
      if (typeof x === "string" && x.length) return FxEnv.$$(x);
    } catch (e) {
      log.error("FxEnv.toNode failed for", x, e);
    }
    return null;
  }
}

/**
 * FxBindings — remembers every reactive unbinder created for an element so
 * that removing/emptying/re-rendering that element DISPOSES its watchers
 * instead of leaking them (plain fx-mini binds are forever).
 */
export class FxBindings {
  static #store = new WeakMap(); // Element -> Set<() => void>

  static add(el, dispose) {
    if (!el || typeof dispose !== "function") return;
    let set = this.#store.get(el);
    if (!set) { set = new Set(); this.#store.set(el, set); }
    set.add(dispose);
  }

  static count(el) { return this.#store.get(el)?.size ?? 0; }

  /** Dispose the bindings registered on `el` itself. */
  static dispose(el) {
    const set = this.#store.get(el);
    if (!set) return 0;
    this.#store.delete(el);
    let n = 0;
    for (const fn of set) {
      try { fn(); n++; } catch (e) { log.warn("binding dispose threw:", e); }
    }
    return n;
  }

  /** Dispose bindings of `el` AND every descendant. */
  static disposeTree(el) {
    let n = this.dispose(el);
    n += this.disposeDescendants(el);
    return n;
  }

  /** Dispose bindings of the descendants only (used before innerHTML swaps). */
  static disposeDescendants(el) {
    let n = 0;
    try {
      if (el && typeof el.querySelectorAll === "function") {
        for (const child of el.querySelectorAll("*")) n += this.dispose(child);
      }
    } catch (e) {
      log.warn("disposeDescendants failed:", e);
    }
    return n;
  }
}

/**
 * FxReactive — the "Setter" contract used across the plus layer: a plain value
 * applies once; a node proxy (or dotted path) applies now AND on every change,
 * with the unwatcher registered against the element for later disposal.
 */
export class FxReactive {
  /**
   * @param {Element|null} el        Owner element for binding registration.
   * @param {*} valueOrNode          Plain value, node proxy, or (for `allowPath`) a path string.
   * @param {(v:*) => void} applyFn  Called with the resolved value.
   * @param {{allowPath?: boolean}} [opts]
   * @returns {(() => void)|null}    The unwatcher when reactive, else null.
   */
  static apply(el, valueOrNode, applyFn, opts = {}) {
    const node = FxEnv.isNode(valueOrNode)
      ? valueOrNode
      : (opts.allowPath && typeof valueOrNode === "string" ? FxEnv.toNode(valueOrNode) : null);
    if (!node) {
      try { applyFn(valueOrNode); } catch (e) { log.error("reactive apply failed:", e); }
      return null;
    }
    const push = () => {
      try { applyFn(node.get()); } catch (e) { log.error("reactive push failed:", e); }
    };
    push();
    const unwatch = node.watch(push);
    if (el) FxBindings.add(el, unwatch);
    return unwatch;
  }
}

/** DOM parsing + content normalisation shared by $(html), manipulation and lists. */
export class FxDom {
  /** Does this selector string actually look like an HTML fragment? */
  static isHtml(s) {
    return typeof s === "string" && /^\s*<[\w!]/.test(s);
  }

  /** Parse an HTML string into detached elements (scripts stay inert). */
  static parseHTML(html) {
    try {
      const tpl = document.createElement("template");
      tpl.innerHTML = String(html ?? "");
      return Array.from(tpl.content.children);
    } catch (e) {
      log.error("parseHTML failed:", e);
      return [];
    }
  }

  /** Normalise any content-ish argument to an array of DOM Nodes. */
  static toNodes(content) {
    if (content == null) return [];
    if (Array.isArray(content)) return content.flatMap((c) => this.toNodes(c));
    if (typeof content === "string") {
      return this.isHtml(content) ? this.parseHTML(content) : [document.createTextNode(content)];
    }
    if (typeof content === "number" || typeof content === "boolean") {
      return [document.createTextNode(String(content))];
    }
    if (content instanceof Node) return [content];
    if (Array.isArray(content.elements)) return content.elements.map((h) => h.el).filter(Boolean); // Group
    if (content.el instanceof Node) return [content.el];                                           // Handle
    log.warn("FxDom.toNodes: unsupported content", content);
    return [];
  }

  /** Deep-clone a node list (used when inserting into multiple targets). */
  static cloneNodes(nodes) {
    return nodes.map((n) => n.cloneNode(true));
  }

  /** Extract raw Elements from a handle/group/element/array result. */
  static elementsOf(x) {
    if (x == null) return [];
    if (Array.isArray(x)) return x.flatMap((v) => this.elementsOf(v));
    if (x instanceof Element) return [x];
    if (Array.isArray(x.elements)) return x.elements.map((h) => h.el).filter((e) => e instanceof Element);
    if (x.el instanceof Element) return [x.el];
    return [];
  }

  /** Dedupe and (when possible) order elements by document position. */
  static unique(els) {
    const arr = Array.from(new Set(els));
    try {
      arr.sort((a, b) => {
        if (a === b) return 0;
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
    } catch { /* detached nodes — keep insertion order */ }
    return arr;
  }

  /** Run fx-mini's declarative hydration over freshly inserted nodes. */
  static hydrate(nodes) {
    const h = FxEnv.hydrate;
    if (!h) return;
    for (const n of Array.isArray(nodes) ? nodes : [nodes]) {
      if (!(n instanceof Element)) continue;
      try { h(n); } catch (e) { log.warn("hydrate of inserted content failed:", e); }
    }
  }
}
