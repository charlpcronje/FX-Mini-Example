// fx/plus/traversal.js
//
// Missing jQuery traversal + set-filtering methods.
//
// Handle:  .parents([sel]) .parentsUntil(stop[,sel]) .siblings([sel])
//          .nextAll([sel]) .prevAll([sel]) .nextUntil(stop[,sel]) .prevUntil(stop[,sel])
//          .is(sel|fn|el|handle) .index([sel]) .add(sel|content)
// Both:    .filter(sel|fn) .not(sel|fn) .has(sel|el) .eq(i) .first() .last()
//          .slice(a[,b]) .map(fn) .get([i]) .toArray() .even() .odd()
//
// FX conventions kept: no match → null, one match → Handle, many → Group.

import { FxPlus } from "./core.js";
import { FxDom } from "./kit.js";

const matches = (el, sel) => { try { return el.matches(sel); } catch { return false; } };

/** Normalise a filter argument (selector | fn(i, el) | Element | Handle) to a predicate. */
function predicate(arg) {
  if (typeof arg === "function") return (el, i) => Boolean(arg.call(el, i, el));
  if (typeof arg === "string") return (el) => matches(el, arg);
  const els = new Set(FxDom.elementsOf(arg));
  return (el) => els.has(el);
}

function walk(el, dir, stopSel, filterSel) {
  const out = [];
  let cur = el[dir];
  while (cur) {
    if (stopSel && matches(cur, stopSel)) break;
    if (!filterSel || matches(cur, filterSel)) out.push(cur);
    cur = cur[dir];
  }
  return out;
}

// ── ancestry / siblings (group mode: collect + dedupe) ───────────────
FxPlus.handle("parents", (h, [sel]) => {
  const out = [];
  let cur = h.el.parentElement;
  while (cur && cur !== document.documentElement.parentElement) {
    if (!sel || matches(cur, sel)) out.push(cur);
    cur = cur.parentElement;
  }
  return FxPlus.wrap(out);
}, "collect");

FxPlus.handle("parentsUntil", (h, [stopSel, sel]) => {
  const out = [];
  let cur = h.el.parentElement;
  while (cur && cur !== document.documentElement.parentElement) {
    if (stopSel && matches(cur, stopSel)) break;
    if (!sel || matches(cur, sel)) out.push(cur);
    cur = cur.parentElement;
  }
  return FxPlus.wrap(out);
}, "collect");

FxPlus.handle("siblings", (h, [sel]) => {
  const out = Array.from(h.el.parentElement?.children ?? [])
    .filter((c) => c !== h.el && (!sel || matches(c, sel)));
  return FxPlus.wrap(out);
}, "collect");

FxPlus.handle("nextAll", (h, [sel]) => FxPlus.wrap(walk(h.el, "nextElementSibling", null, sel)), "collect");
FxPlus.handle("prevAll", (h, [sel]) => FxPlus.wrap(walk(h.el, "previousElementSibling", null, sel)), "collect");
FxPlus.handle("nextUntil", (h, [stop, sel]) => FxPlus.wrap(walk(h.el, "nextElementSibling", stop, sel)), "collect");
FxPlus.handle("prevUntil", (h, [stop, sel]) => FxPlus.wrap(walk(h.el, "previousElementSibling", stop, sel)), "collect");

// ── predicates / position ────────────────────────────────────────────
FxPlus.handle("is", (h, [arg]) => predicate(arg)(h.el, 0), "first");

FxPlus.group("is", (g, [arg]) => {
  const p = predicate(arg);
  return g.elements.some((h, i) => p(h.el, i));
});

FxPlus.handle("index", (h, [sel]) => {
  if (sel === undefined) return Array.from(h.el.parentElement?.children ?? []).indexOf(h.el);
  const pool = typeof sel === "string"
    ? Array.from(document.querySelectorAll(sel))
    : FxDom.elementsOf(sel);
  return pool.indexOf(h.el);
}, "first");

// ── set building ─────────────────────────────────────────────────────
FxPlus.handle("add", (h, [arg]) => {
  const extra = typeof arg === "string" && !FxDom.isHtml(arg)
    ? Array.from(document.querySelectorAll(arg))
    : FxDom.elementsOf(FxDom.toNodes(arg));
  return FxPlus.wrap(FxDom.unique([h.el, ...extra]));
}, "collect");

FxPlus.group("add", (g, [arg]) => {
  const extra = typeof arg === "string" && !FxDom.isHtml(arg)
    ? Array.from(document.querySelectorAll(arg))
    : FxDom.elementsOf(FxDom.toNodes(arg));
  return FxPlus.wrap(FxDom.unique([...g.elements.map((h) => h.el), ...extra]));
});

// ── filtering — handle versions ──────────────────────────────────────
FxPlus.handle("filter", (h, [arg]) => (predicate(arg)(h.el, 0) ? h : null), "collect");
FxPlus.handle("not", (h, [arg]) => (predicate(arg)(h.el, 0) ? null : h), "collect");
FxPlus.handle("has", (h, [arg]) => {
  const found = typeof arg === "string"
    ? h.el.querySelector(arg) != null
    : FxDom.elementsOf(arg).some((el) => h.el.contains(el) && el !== h.el);
  return found ? h : null;
}, "collect");

FxPlus.handle("eq", (h, [i]) => (i === 0 || i === -1 ? h : null), "collect");
FxPlus.handle("first", (h) => h, "collect");
FxPlus.handle("last", (h) => h, "collect");
FxPlus.handle("toArray", (h) => [h.el], "first");
FxPlus.handle("get", (h, [i]) => (i === undefined ? [h.el] : (i === 0 || i === -1 ? h.el : undefined)), "first");
FxPlus.handle("slice", (h, [a, b]) => FxPlus.wrap([h.el].slice(a, b)), "collect");
FxPlus.handle("map", (h, [fn]) => [fn.call(h.el, 0, h.el)], "first");
FxPlus.handle("even", (h) => h, "collect");
FxPlus.handle("odd", () => null, "collect");

// ── filtering — group versions (index-aware) ─────────────────────────
const els = (g) => g.elements.map((h) => h.el);

FxPlus.group("filter", (g, [arg]) => {
  const p = predicate(arg);
  return FxPlus.wrap(els(g).filter((el, i) => p(el, i)));
});

FxPlus.group("not", (g, [arg]) => {
  const p = predicate(arg);
  return FxPlus.wrap(els(g).filter((el, i) => !p(el, i)));
});

FxPlus.group("has", (g, [arg]) => FxPlus.wrap(els(g).filter((el) => {
  if (typeof arg === "string") return el.querySelector(arg) != null;
  return FxDom.elementsOf(arg).some((t) => el.contains(t) && t !== el);
})));

FxPlus.group("eq", (g, [i]) => {
  const list = els(g);
  const idx = i < 0 ? list.length + i : i;
  return FxPlus.wrap(list[idx] ?? null);
});

FxPlus.group("first", (g) => FxPlus.wrap(els(g)[0] ?? null));
FxPlus.group("last", (g) => FxPlus.wrap(els(g)[els(g).length - 1] ?? null));
FxPlus.group("toArray", (g) => els(g));
FxPlus.group("get", (g, [i]) => {
  const list = els(g);
  if (i === undefined) return list;
  return list[i < 0 ? list.length + i : i];
});
FxPlus.group("slice", (g, [a, b]) => FxPlus.wrap(els(g).slice(a, b)));
FxPlus.group("map", (g, [fn]) => els(g).map((el, i) => fn.call(el, i, el)));
FxPlus.group("index", (g, [sel]) => {
  const first = g.elements[0];
  return first ? FxPlus.decorate(first).index(sel) : -1;
});
FxPlus.group("even", (g) => FxPlus.wrap(els(g).filter((_, i) => i % 2 === 0)));
FxPlus.group("odd", (g) => FxPlus.wrap(els(g).filter((_, i) => i % 2 === 1)));

export default true;
