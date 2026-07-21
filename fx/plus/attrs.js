// fx/plus/attrs.js
//
// Attribute/property/content upgrades:
//   .prop(name|map, value?)   — DOM properties (disabled, checked, …), reactive-capable
//   .removeAttr(names)        — space-separated attribute removal
//   .removeProp(name)
//   .text(node, fmt)          — reactive text WITH a formatter function
//   .html(value)              — override: disposes descendant bindings before the
//                               swap and hydrates $${…}/{…}/<import> in new markup
//   .toggleClass(name, node)  — override: class presence bound to a live node

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxEnv, FxReactive, FxBindings } from "./kit.js";
import { replaceHtmlLifecycle } from "../fx-mini.js";

const getterFirst = (args) => (args.length === 0 ? "first" : "chain");

// ── prop / removeAttr / removeProp ───────────────────────────────────
FxPlus.handle("prop", (h, [name, value]) => {
  if (typeof name === "object" && name !== null) {
    for (const k of Object.keys(name)) FxReactive.apply(h.el, name[k], (v) => { h.el[k] = v; });
    return h;
  }
  if (value === undefined) return h.el[name];
  FxReactive.apply(h.el, value, (v) => { h.el[name] = v; });
  return h;
}, (args) => (args.length === 1 && typeof args[0] === "string" ? "first" : "chain"));

FxPlus.handle("removeAttr", (h, [names]) => {
  String(names ?? "").split(/\s+/).filter(Boolean).forEach((n) => h.el.removeAttribute(n));
  return h;
}, "chain");

FxPlus.handle("removeProp", (h, [name]) => {
  try { delete h.el[name]; } catch { h.el[name] = undefined; }
  return h;
}, "chain");

// ── text with formatter (+ TRACKED reactive binds for leak hygiene) ──
FxPlus.handle("text", (h, args, prev) => {
  const [v, fmt] = args;
  if (args.length >= 2 && typeof fmt === "function") {
    FxReactive.apply(h.el, v, (nv) => {
      let out;
      try { out = fmt(nv); } catch (e) { log.error(".text(node, fmt) formatter failed:", e); out = nv; }
      h.el.textContent = String(out ?? "");
    });
    return h;
  }
  if (args.length === 0 || v === undefined) return prev ? prev() : h.el.textContent || "";
  if (FxEnv.isNode(v)) { // tracked (disposable) instead of fx-mini's forever-bind
    FxReactive.apply(h.el, v, (nv) => { h.el.textContent = String(nv ?? ""); });
    return h;
  }
  return prev ? (prev(v) ?? h) : h;
}, getterFirst);

// ── css / attr: tracked reactive binds, everything else delegates ────
const UNITLESS_CSS = new Set(["opacity", "z-index", "zIndex", "flex", "flex-grow", "flexGrow",
  "flex-shrink", "flexShrink", "order", "font-weight", "fontWeight", "line-height", "lineHeight"]);

function setCss(el, prop, nv) {
  const val = typeof nv === "number" && !UNITLESS_CSS.has(prop) ? `${nv}px` : String(nv);
  if (prop.startsWith("--")) el.style.setProperty(prop, val);
  else el.style[prop] = val;
}

FxPlus.handle("css", (h, args, prev) => {
  const [prop, v] = args;
  if (typeof prop === "string" && FxEnv.isNode(v)) {
    FxReactive.apply(h.el, v, (nv) => setCss(h.el, prop, nv));
    return h;
  }
  if (prop && typeof prop === "object" && Object.values(prop).some((x) => FxEnv.isNode(x))) {
    for (const [k, vv] of Object.entries(prop)) FxReactive.apply(h.el, vv, (nv) => setCss(h.el, k, nv));
    return h;
  }
  const out = prev ? prev(...args) : undefined;
  return (typeof prop === "object" || v !== undefined) ? h : out;
}, (args) => (typeof args[0] === "string" && args.length === 1 ? "first" : "chain"));

FxPlus.handle("attr", (h, args, prev) => {
  const [name, v] = args;
  if (typeof name === "string" && FxEnv.isNode(v)) {
    FxReactive.apply(h.el, v, (nv) => h.el.setAttribute(name, String(nv ?? "")));
    return h;
  }
  if (name && typeof name === "object" && Object.values(name).some((x) => FxEnv.isNode(x))) {
    for (const [k, vv] of Object.entries(name)) {
      FxReactive.apply(h.el, vv, (nv) => h.el.setAttribute(k, String(nv ?? "")));
    }
    return h;
  }
  const out = prev ? prev(...args) : undefined;
  return (typeof name === "object" || v !== undefined) ? h : out;
}, (args) => (typeof args[0] === "string" && args.length === 1 ? "first" : "chain"));

// ── html with binding hygiene + hydration ────────────────────────────
FxPlus.handle("html", (h, args, prev) => {
  const [v, opts] = args;
  if (args.length === 0 || v === undefined) return prev ? prev() : h.el.innerHTML;
  const hydrate = opts?.hydrate !== false;
  FxReactive.apply(h.el, v, (nv) => {
    FxBindings.disposeDescendants(h.el);            // kill watchers of replaced markup
    replaceHtmlLifecycle(h.el, String(nv ?? ""));   // framework-canonical swap
    if (hydrate) {
      const run = FxEnv.hydrate;
      if (run) {
        try { run(h.el); } catch (e) { log.warn(".html() hydration failed:", e); }
      }
    }
  });
  return h;
}, getterFirst);

// ── toggleClass with a reactive state node ───────────────────────────
FxPlus.handle("toggleClass", (h, args, prev) => {
  const [name, state] = args;
  if (FxEnv.isNode(state)) {
    FxReactive.apply(h.el, state, (v) => {
      String(name ?? "").split(/\s+/).filter(Boolean)
        .forEach((c) => h.el.classList.toggle(c, Boolean(v)));
    });
    return h;
  }
  if (prev) return prev(...args) ?? h;
  h.el.classList.toggle(name, state);
  return h;
}, "chain");

export default true;
