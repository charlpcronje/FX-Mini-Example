// fx/plus/manipulation.js
//
// The most-used missing jQuery DOM manipulation methods, with two upgrades:
//   • every removal path disposes the subtree's reactive bindings (no leaks),
//   • every insertion hydrates fx-mini's $${…}/{…}/<import> templating in the
//     new markup, so declarative reactivity works in dynamic content too.
//
// .prepend .before .after .appendTo .prependTo .insertBefore .insertAfter
// .remove .detach .empty .clone .replaceWith .wrap .wrapInner .unwrap

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxDom, FxBindings } from "./kit.js";

/** Insert `content` around/into `el` via `placer`, hydrating what was added. */
function insert(el, content, placer) {
  const nodes = FxDom.toNodes(content);
  if (!nodes.length) return;
  placer(el, nodes);
  FxDom.hydrate(nodes);
}

/** Resolve an insertion target (selector/element/handle/group) to elements. */
function targetsOf(target) {
  if (typeof target === "string") {
    const res = (FxPlus.original$ || globalThis.$)(target);
    return FxDom.elementsOf(res);
  }
  return FxDom.elementsOf(FxDom.toNodes(target));
}

/** "…To"-style inversion: put el into/next to every target (clones after first). */
function insertInto(h, target, placer) {
  const targets = targetsOf(target);
  if (!targets.length) { log.warn("insertion target matched nothing:", target); return h; }
  const inserted = [];
  targets.forEach((t, i) => {
    const node = i === 0 ? h.el : h.el.cloneNode(true);
    placer(t, node);
    inserted.push(node);
    FxDom.hydrate(node);
  });
  return FxPlus.wrap(inserted) ?? h;
}

// ── content insertion ────────────────────────────────────────────────
FxPlus.handle("prepend", (h, contents) => {
  contents.forEach((c) => insert(h.el, c, (el, nodes) => el.prepend(...nodes)));
  return h;
}, "chain");

FxPlus.handle("before", (h, contents) => {
  contents.forEach((c) => insert(h.el, c, (el, nodes) => el.before(...nodes)));
  return h;
}, "chain");

FxPlus.handle("after", (h, contents) => {
  contents.forEach((c) => insert(h.el, c, (el, nodes) => el.after(...nodes)));
  return h;
}, "chain");

FxPlus.handle("appendTo", (h, [target]) => insertInto(h, target, (t, n) => t.append(n)), "collect");
FxPlus.handle("prependTo", (h, [target]) => insertInto(h, target, (t, n) => t.prepend(n)), "collect");
FxPlus.handle("insertBefore", (h, [target]) => insertInto(h, target, (t, n) => t.before(n)), "collect");
FxPlus.handle("insertAfter", (h, [target]) => insertInto(h, target, (t, n) => t.after(n)), "collect");

// ── removal (with binding hygiene) ───────────────────────────────────
FxPlus.handle("remove", (h, [selector]) => {
  if (selector && !h.el.matches(selector)) return h;
  FxBindings.disposeTree(h.el);
  h.el.remove();
  return h;
}, "chain");

FxPlus.handle("detach", (h) => {
  h.el.remove(); // bindings/data survive — element can be re-inserted
  return h;
}, "chain");

FxPlus.handle("empty", (h) => {
  FxBindings.disposeDescendants(h.el);
  h.el.replaceChildren();
  return h;
}, "chain");

// ── clone / replace ──────────────────────────────────────────────────
FxPlus.handle("clone", (h) => {
  const copy = h.el.cloneNode(true);
  return FxPlus.wrap(copy);
}, "collect");

FxPlus.handle("replaceWith", (h, [content]) => {
  const nodes = FxDom.toNodes(content);
  FxBindings.disposeTree(h.el);
  h.el.replaceWith(...nodes);
  FxDom.hydrate(nodes);
  return h;
}, "chain");

// ── wrapping ─────────────────────────────────────────────────────────
function wrapperFor(structure) {
  const nodes = FxDom.toNodes(structure);
  const root = nodes.find((n) => n instanceof Element);
  if (!root) return null;
  const clone = root.cloneNode(true);
  let deepest = clone;
  while (deepest.firstElementChild) deepest = deepest.firstElementChild;
  return { root: clone, deepest };
}

FxPlus.handle("wrap", (h, [structure]) => {
  const w = wrapperFor(structure);
  if (!w) { log.warn(".wrap(): wrapper produced no element"); return h; }
  h.el.replaceWith(w.root);
  w.deepest.appendChild(h.el);
  return h;
}, "chain");

FxPlus.handle("wrapInner", (h, [structure]) => {
  const w = wrapperFor(structure);
  if (!w) { log.warn(".wrapInner(): wrapper produced no element"); return h; }
  w.deepest.append(...Array.from(h.el.childNodes));
  h.el.appendChild(w.root);
  return h;
}, "chain");

FxPlus.handle("unwrap", (h, [selector]) => {
  const parent = h.el.parentElement;
  if (!parent || parent === document.body || parent === document.documentElement) return h;
  if (selector && !parent.matches(selector)) return h;
  FxBindings.dispose(parent);
  parent.replaceWith(...Array.from(parent.childNodes));
  return h;
}, "chain");

export default true;
