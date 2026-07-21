// fx/plus/reactive.js
//
// The reactive superpowers layer — where $ and $$ properly fuse:
//   $computed(target, deps, fn)   — derived nodes: bindable like any other node
//   .bind(node, (v, h) => …)      — run ANY updater when a node changes
//   .showWhen(node[, opts])       — declarative visibility (optionally animated)
//   .hideWhen(node[, opts])
//   .enableWhen(node[, map])      — disabled-prop binding for forms
//   .classWhen(name, node[, map]) — class presence bound to a node
//   .pipe(evt, node[, opts])      — event stream → node value ({ map, debounce })

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxEnv, FxBindings, FxReactive } from "./kit.js";
import { FxForms } from "./forms.js";
import { FxReplay } from "./replay.js";

export class FxComputed {
  #target;
  #deps;
  #fn;
  #unwatchers = [];
  #disposed = false;

  /**
   * @param {string|object} target  Node (or path) that receives the derived value.
   * @param {Array<string|object>} deps  Nodes/paths the value is derived from.
   * @param {(...values) => *} fn   Pure derivation — receives dep values in order.
   */
  constructor(target, deps, fn) {
    this.#target = FxEnv.toNode(target);
    this.#deps = (Array.isArray(deps) ? deps : [deps]).map((d) => FxEnv.toNode(d)).filter(Boolean);
    this.#fn = fn;
    if (!this.#target || !this.#deps.length || typeof fn !== "function") {
      throw new Error("$computed(target, deps, fn): bad arguments");
    }
    this.recompute();
    for (const dep of this.#deps) this.#unwatchers.push(dep.watch(() => this.recompute()));
  }

  get node() { return this.#target; }

  /** Replay boundary: a derivation may $.ajax — it suspends and re-derives. */
  recompute() {
    FxReplay.invoke(() => this.#recomputeCore(), this, []);
  }

  #recomputeCore() {
    if (this.#disposed) return;
    let next;
    try { next = this.#fn(...this.#deps.map((d) => d.get())); }
    catch (e) {
      if (FxReplay.isSuspend(e)) throw e;                      // let the boundary replay us
      log.error("$computed derivation failed:", e);
      return;
    }
    try {
      const prev = this.#target.get();
      if (Object.is(prev, next)) return;                       // loop/echo guard
      if (typeof prev === "object" && typeof next === "object"
        && JSON.stringify(prev) === JSON.stringify(next)) return;
      this.#target.set(next);
    } catch (e) { log.error("$computed set failed:", e); }
  }

  dispose() {
    this.#disposed = true;
    for (const u of this.#unwatchers) { try { u(); } catch { /* already gone */ } }
    this.#unwatchers.length = 0;
  }
}

/** $computed("cart.total", ["cart.items"], items => …) → the target node proxy. */
export function computed(target, deps, fn) {
  const c = new FxComputed(target, deps, fn);
  const node = c.node;
  try { node.dispose = () => c.dispose(); } catch { /* proxy refuses — dispose via instance */ }
  return node;
}

// ── handle methods ───────────────────────────────────────────────────
FxPlus.handle("bind", (h, [nodeOrPath, fn]) => {
  const node = FxEnv.toNode(nodeOrPath);
  if (!node || typeof fn !== "function") { log.warn(".bind(node, fn): bad arguments"); return h; }
  FxReactive.apply(h.el, node, (v) => fn.call(h, v, h));
  return h;
}, "chain");

function visibility(h, nodeOrPath, opts, invert) {
  const node = FxEnv.toNode(nodeOrPath);
  if (!node) { log.warn(".showWhen/.hideWhen: could not resolve node", nodeOrPath); return h; }
  const map = typeof opts?.map === "function" ? opts.map : (v) => Boolean(v);
  const duration = opts?.duration;
  const effect = opts?.effect ?? "fade"; // "fade" | "slide" | "plain"
  let first = true;
  FxReactive.apply(h.el, node, (v) => {
    const on = invert ? !map(v) : Boolean(map(v));
    if (first || duration == null) {
      on ? h.show() : h.hide();
    } else if (effect === "slide") {
      on ? h.slideDown(duration) : h.slideUp(duration);
    } else if (effect === "plain") {
      on ? h.show(duration) : h.hide(duration);
    } else {
      on ? h.fadeIn(duration) : h.fadeOut(duration);
    }
    first = false;
  });
  return h;
}

FxPlus.handle("showWhen", (h, [nodeOrPath, opts]) => visibility(h, nodeOrPath, opts, false), "chain");
FxPlus.handle("hideWhen", (h, [nodeOrPath, opts]) => visibility(h, nodeOrPath, opts, true), "chain");

FxPlus.handle("enableWhen", (h, [nodeOrPath, map]) => {
  const node = FxEnv.toNode(nodeOrPath);
  if (!node) { log.warn(".enableWhen: could not resolve node", nodeOrPath); return h; }
  const fn = typeof map === "function" ? map : (v) => Boolean(v);
  FxReactive.apply(h.el, node, (v) => { h.el.disabled = !fn(v); });
  return h;
}, "chain");

FxPlus.handle("classWhen", (h, [name, nodeOrPath, map]) => {
  const node = FxEnv.toNode(nodeOrPath);
  if (!node) { log.warn(".classWhen: could not resolve node", nodeOrPath); return h; }
  const fn = typeof map === "function" ? map : (v) => Boolean(v);
  FxReactive.apply(h.el, node, (v) => {
    String(name ?? "").split(/\s+/).filter(Boolean)
      .forEach((c) => h.el.classList.toggle(c, Boolean(fn(v))));
  });
  return h;
}, "chain");

FxPlus.handle("pipe", (h, [evt, nodeOrPath, opts]) => {
  const node = FxEnv.toNode(nodeOrPath);
  if (!node) { log.warn(".pipe: could not resolve node", nodeOrPath); return h; }
  const map = typeof opts?.map === "function" ? opts.map : null;
  const debounce = Number(opts?.debounce) || 0;
  let timer = null;
  const read = () => {
    const raw = h.el.matches("input, select, textarea") ? FxForms.controlValue(h.el) : h.el.textContent;
    return map ? map(raw, h.el) : raw;
  };
  const push = () => {
    try { node.set(read()); } catch (e) { log.error(".pipe push failed:", e); }
  };
  const listener = () => {
    if (!debounce) return push();
    clearTimeout(timer);
    timer = setTimeout(push, debounce);
  };
  for (const type of String(evt ?? "input").split(/\s+/).filter(Boolean)) {
    h.el.addEventListener(type, listener);
    FxBindings.add(h.el, () => h.el.removeEventListener(type, listener));
  }
  return h;
}, "chain");

// ── unbind: manual disposal of everything bound to the element ───────
FxPlus.handle("unbind", (h, [deep]) => {
  const n = deep ? FxBindings.disposeTree(h.el) : FxBindings.dispose(h.el);
  log.debug(`.unbind() disposed ${n} binding(s)`);
  return h;
}, "chain");

FxPlus.util("computed", computed);

export default FxComputed;
