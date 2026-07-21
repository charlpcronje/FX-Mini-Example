// fx/plus/dimensions.js
//
// jQuery geometry, box-model aware and reactive-capable on the setters:
//   .width() .height() .innerWidth() .innerHeight()
//   .outerWidth([margin]) .outerHeight([margin])
//   .offset() .position() .scrollTop() .scrollLeft() .rect()
// Also works on $(window) / $(document) for the classic viewport queries.

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxReactive } from "./kit.js";

export class FxGeom {
  static cs(el) { return getComputedStyle(el); }
  static px(v) { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; }

  /** Content-box size (jQuery .width()/.height() semantics). */
  static content(el, dim) {
    const cs = this.cs(el);
    const size = this.px(cs[dim]);
    if (cs.boxSizing === "border-box") {
      const [a, b] = dim === "width" ? ["Left", "Right"] : ["Top", "Bottom"];
      return size - this.px(cs[`padding${a}`]) - this.px(cs[`padding${b}`])
        - this.px(cs[`border${a}Width`]) - this.px(cs[`border${b}Width`]);
    }
    return size;
  }

  static inner(el, dim) {
    return dim === "width" ? el.clientWidth : el.clientHeight;
  }

  static outer(el, dim, includeMargin) {
    let size = dim === "width" ? el.offsetWidth : el.offsetHeight;
    if (includeMargin) {
      const cs = this.cs(el);
      const [a, b] = dim === "width" ? ["Left", "Right"] : ["Top", "Bottom"];
      size += this.px(cs[`margin${a}`]) + this.px(cs[`margin${b}`]);
    }
    return size;
  }

  /** Set the CONTENT size (compensates for border-box). */
  static setContent(el, dim, value) {
    if (value == null || value === "") { el.style[dim] = ""; return; }
    if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value)) { el.style[dim] = value; return; }
    let n = parseFloat(value);
    if (Number.isNaN(n)) { log.warn(`.${dim}(): not a size:`, value); return; }
    const cs = this.cs(el);
    if (cs.boxSizing === "border-box") {
      const [a, b] = dim === "width" ? ["Left", "Right"] : ["Top", "Bottom"];
      n += this.px(cs[`padding${a}`]) + this.px(cs[`padding${b}`])
        + this.px(cs[`border${a}Width`]) + this.px(cs[`border${b}Width`]);
    }
    el.style[dim] = `${n}px`;
  }

  static offset(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, left: r.left + window.scrollX };
  }

  static setOffset(el, coords) {
    const cs = this.cs(el);
    if (cs.position === "static") el.style.position = "relative";
    const cur = this.offset(el);
    const curTop = this.px(cs.top) || 0;
    const curLeft = this.px(cs.left) || 0;
    if (coords.top !== undefined) el.style.top = `${coords.top - cur.top + curTop}px`;
    if (coords.left !== undefined) el.style.left = `${coords.left - cur.left + curLeft}px`;
  }

  static position(el) {
    const cs = this.cs(el);
    return {
      top: el.offsetTop - this.px(cs.marginTop),
      left: el.offsetLeft - this.px(cs.marginLeft),
    };
  }
}

const setterMode = (args) => (args.length === 0 ? "first" : "chain");

// ── width / height family ────────────────────────────────────────────
for (const dim of ["width", "height"]) {
  FxPlus.handle(dim, (h, [v]) => {
    if (v === undefined) return FxGeom.content(h.el, dim);
    FxReactive.apply(h.el, v, (nv) => FxGeom.setContent(h.el, dim, nv));
    return h;
  }, setterMode);

  const cap = dim[0].toUpperCase() + dim.slice(1);
  FxPlus.handle(`inner${cap}`, (h) => FxGeom.inner(h.el, dim), "first");
  FxPlus.handle(`outer${cap}`, (h, [margin]) => FxGeom.outer(h.el, dim, margin === true), "first");

  // viewport / document sizes on the root handle
  FxPlus.root(dim, (r) => {
    if (r.el === window) return dim === "width" ? window.innerWidth : window.innerHeight;
    const doc = document.documentElement;
    return dim === "width" ? doc.scrollWidth : doc.scrollHeight;
  });
  FxPlus.root(`inner${cap}`, (r) => (r.el === window ? (dim === "width" ? window.innerWidth : window.innerHeight) : FxGeom.inner(document.documentElement, dim)));
  FxPlus.root(`outer${cap}`, (r) => (r.el === window ? (dim === "width" ? window.outerWidth : window.outerHeight) : FxGeom.outer(document.documentElement, dim)));
}

// ── offset / position / rect ─────────────────────────────────────────
FxPlus.handle("offset", (h, [coords]) => {
  if (coords === undefined) return FxGeom.offset(h.el);
  FxGeom.setOffset(h.el, coords);
  return h;
}, setterMode);

FxPlus.handle("position", (h) => FxGeom.position(h.el), "first");
FxPlus.handle("rect", (h) => {
  const r = h.el.getBoundingClientRect();
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height, x: r.x, y: r.y };
}, "first");

// ── scrollTop / scrollLeft (elements + window/document) ──────────────
for (const [name, prop, winProp] of [["scrollTop", "scrollTop", "scrollY"], ["scrollLeft", "scrollLeft", "scrollX"]]) {
  FxPlus.handle(name, (h, [v]) => {
    if (v === undefined) return h.el[prop];
    FxReactive.apply(h.el, v, (nv) => { h.el[prop] = Number(nv) || 0; });
    return h;
  }, setterMode);

  FxPlus.root(name, (r, [v]) => {
    const scroller = document.scrollingElement || document.documentElement;
    if (v === undefined) return r.el === window ? window[winProp] : scroller[prop];
    try {
      const n = Number(v) || 0;
      if (name === "scrollTop") window.scrollTo(window.scrollX, n);
      else window.scrollTo(n, window.scrollY);
    } catch (e) { log.error(`${name}() on window failed:`, e); }
    return r;
  });
}

export default FxGeom;
