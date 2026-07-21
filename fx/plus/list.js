// fx/plus/list.js
//
// Reactive list rendering + array mutators for the node graph.
//
//   $("#todos").bindEach("app.todos", {
//     render: (t) => `<li class="todo" data-id="${t.id}">${t.text}</li>`,
//     key:    (t) => t.id,          // keyed diff: unchanged items keep their DOM
//     empty:  `<li class="muted">Nothing yet</li>`,
//   });
//
//   $list("app.todos").push({ id: 1, text: "hi" });   // set-through mutators
//   $list("app.todos").update(0, { done: true });
//   $list("app.todos").removeWhere(t => t.done);

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxEnv, FxBindings, FxDom } from "./kit.js";
import { FxData } from "./data.js";

/** Deterministic signature for change detection (sorted keys, cycle-safe). */
function signature(v) {
  try {
    const seen = new WeakSet();
    return JSON.stringify(v, (k, val) => {
      if (val && typeof val === "object") {
        if (seen.has(val)) return "[circular]";
        seen.add(val);
        if (!Array.isArray(val)) {
          const o = {};
          for (const key of Object.keys(val).sort()) o[key] = val[key];
          return o;
        }
      }
      return typeof val === "function" ? String(val) : val;
    });
  } catch { return String(v); }
}

export class FxListBinder {
  #container;
  #node;
  #render;
  #key;
  #empty;
  #hydrate;
  #entries = new Map(); // key -> { el, sig }
  #unwatch = null;

  constructor(container, node, opts) {
    this.#container = container;
    this.#node = node;
    this.#render = opts.render;
    this.#key = typeof opts.key === "function" ? opts.key : (_item, i) => i;
    this.#empty = opts.empty ?? null;
    this.#hydrate = opts.hydrate !== false;
    if (typeof this.#render !== "function") throw new Error("bindEach: opts.render(item, i) is required");
    this.render();
    this.#unwatch = node.watch(() => this.render());
  }

  #build(item, i) {
    const out = this.#render(item, i);
    if (out instanceof Element) return out;
    const els = FxDom.parseHTML(String(out ?? ""));
    if (els.length !== 1) {
      log.warn(`bindEach render must return ONE root element (got ${els.length}) — wrapping`);
      const wrap = document.createElement("div");
      els.forEach((e) => wrap.appendChild(e));
      return wrap;
    }
    return els[0];
  }

  render() {
    try {
      const items = this.#node.get();
      const list = Array.isArray(items) ? items : [];
      const next = new Map();

      if (!list.length) {
        for (const { el } of this.#entries.values()) FxBindings.disposeTree(el);
        this.#entries.clear();
        this.#container.innerHTML = this.#empty ?? "";
        return;
      }

      const fresh = [];
      const keysInOrder = [];
      list.forEach((item, i) => {
        let key = this.#key(item, i);
        if (next.has(key)) { log.warn(`bindEach: duplicate key "${key}" — suffixing`); key = `${key}::${i}`; }
        const sig = signature(item);
        const prev = this.#entries.get(key);
        let el;
        if (prev && prev.sig === sig) {
          el = prev.el;                                  // unchanged: keep DOM as-is
        } else {
          el = this.#build(item, i);
          if (prev) { FxBindings.disposeTree(prev.el); prev.el.replaceWith(el); }
          fresh.push(el);
        }
        next.set(key, { el, sig });
        keysInOrder.push(key);
      });

      for (const [key, entry] of this.#entries) {        // removals
        if (!next.has(key)) { FxBindings.disposeTree(entry.el); entry.el.remove(); }
      }
      if (!this.#entries.size) this.#container.innerHTML = ""; // clear empty-state markup

      let cursor = 0;                                    // ordering pass
      for (const key of keysInOrder) {
        const el = next.get(key).el;
        const at = this.#container.children[cursor];
        if (at !== el) this.#container.insertBefore(el, at ?? null);
        cursor++;
      }
      while (this.#container.children.length > keysInOrder.length) {
        this.#container.lastElementChild.remove();       // stray non-managed leftovers
      }

      this.#entries = next;
      if (this.#hydrate && fresh.length) FxDom.hydrate(fresh);
    } catch (e) {
      log.error("bindEach render failed:", e);
    }
  }

  refresh() { this.render(); }

  dispose() {
    try { this.#unwatch?.(); } catch { /* already gone */ }
    for (const { el } of this.#entries.values()) FxBindings.disposeTree(el);
    this.#entries.clear();
  }
}

/** Array mutators that write back through node.set() so every watcher fires. */
export class FxList {
  #node;

  constructor(pathOrNode) {
    this.#node = FxEnv.toNode(pathOrNode);
    if (!this.#node) throw new Error(`$list: could not resolve node for ${pathOrNode}`);
  }

  get node() { return this.#node; }
  get() { const v = this.#node.get(); return Array.isArray(v) ? v : []; }
  get length() { return this.get().length; }
  set(arr) { this.#node.set(Array.isArray(arr) ? arr : []); return this; }

  #write(mutate) {
    const arr = this.get().slice();
    mutate(arr);
    this.#node.set(arr);
    return this;
  }

  push(...items) { return this.#write((a) => a.push(...items)); }
  insert(i, item) { return this.#write((a) => a.splice(i, 0, item)); }
  removeAt(i) { return this.#write((a) => a.splice(i, 1)); }
  removeWhere(fn) { return this.set(this.get().filter((v, i) => !fn(v, i))); }
  clear() { return this.set([]); }
  move(from, to) {
    return this.#write((a) => {
      const [item] = a.splice(from, 1);
      a.splice(to, 0, item);
    });
  }
  update(i, patch) {
    return this.#write((a) => {
      if (i < 0 || i >= a.length) { log.warn(`$list.update(${i}): out of range`); return; }
      a[i] = typeof patch === "function" ? patch(a[i])
        : (a[i] && typeof a[i] === "object" ? { ...a[i], ...patch } : patch);
    });
  }
  updateWhere(fn, patch) {
    return this.set(this.get().map((v, i) => (fn(v, i)
      ? (typeof patch === "function" ? patch(v) : { ...v, ...patch })
      : v)));
  }
}

// ── wiring ───────────────────────────────────────────────────────────
FxPlus.handle("bindEach", (h, [nodeOrPath, optsOrRender]) => {
  const node = FxEnv.toNode(nodeOrPath);
  if (!node) { log.warn(".bindEach: could not resolve node", nodeOrPath); return h; }
  const opts = typeof optsOrRender === "function" ? { render: optsOrRender } : (optsOrRender || {});
  FxData.get(h.el, "fxListBinder")?.dispose?.();                 // re-bind replaces
  const binder = new FxListBinder(h.el, node, opts);
  FxData.set(h.el, "fxListBinder", binder);
  FxBindings.add(h.el, () => binder.dispose());
  return h;
}, "chain");

export function list(pathOrNode) { return new FxList(pathOrNode); }
FxPlus.util("list", list);

export default FxListBinder;
