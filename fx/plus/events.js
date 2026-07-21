// fx/plus/events.js
//
// A real event registry under $ — fixing the two things fx-mini's .on/.off
// can't do (removing delegated handlers, removing ALL handlers) and adding
// the jQuery features teams actually use:
//   • namespaces:  .on("click.menu", fn) / .off(".menu") / .trigger("click.menu")
//   • .one() — self-removing handlers (delegation-compatible)
//   • .hover(enter, leave)
//   • shortcuts: .click(fn) … and native triggering: .click(), .focus() …
// Works on handles, groups, $(document) and $(window).

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxReplay } from "./replay.js";

export class FxEvents {
  static #reg = new WeakMap(); // EventTarget -> Map<type, Set<rec>>

  /** "click.a.b keyup.a" → [{type:"click", ns:["a","b"]}, {type:"keyup", ns:["a"]}] */
  static parse(evt) {
    return String(evt ?? "").split(/\s+/).filter(Boolean).map((token) => {
      const [type, ...ns] = token.split(".");
      return { type, ns: ns.filter(Boolean) };
    });
  }

  static #bucket(target, type, create) {
    let byType = this.#reg.get(target);
    if (!byType && create) { byType = new Map(); this.#reg.set(target, byType); }
    if (!byType) return null;
    let set = byType.get(type);
    if (!set && create) { set = new Set(); byType.set(type, set); }
    return set ?? null;
  }

  static add(target, evt, selector, handler, options, once = false) {
    if (typeof handler !== "function") { log.warn(".on(): handler is not a function"); return; }
    for (const { type, ns } of this.parse(evt)) {
      if (!type) continue;
      const rec = { type, ns, selector: selector || null, handler, once,
        capture: !!(options === true || options?.capture), options };
      rec.wrapped = (ev) => {
        try {
          const trigNs = ev.__fxNs;
          if (Array.isArray(trigNs) && trigNs.length && !trigNs.every((n) => rec.ns.includes(n))) return;
          let ctx = target;
          if (rec.selector) {
            const hit = ev.target?.closest?.(rec.selector);
            if (!hit || (target instanceof Element && !target.contains(hit))) return;
            ctx = hit;
          }
          if (rec.once) this.#drop(target, rec);
          // Replay boundary: $.ajax (and kernel @-loads) inside the handler
          // SUSPEND + replay instead of blocking the UI thread or crashing.
          FxReplay.invoke(handler, ctx, [ev]);
        } catch (e) {
          log.error(`"${type}" handler failed:`, e);
        }
      };
      this.#bucket(target, type, true).add(rec);
      target.addEventListener(type, rec.wrapped, options);
    }
  }

  static #drop(target, rec) {
    try {
      target.removeEventListener(rec.type, rec.wrapped, rec.options);
      this.#bucket(target, rec.type, false)?.delete(rec);
    } catch (e) { log.warn("event unbind failed:", e); }
  }

  /** off() | off(".ns") | off("click") | off("click.ns") | off("click", fn) */
  static remove(target, evt, handler) {
    const byType = this.#reg.get(target);
    if (!byType) return;
    const specs = evt === undefined ? [{ type: "", ns: [] }] : this.parse(evt);
    for (const { type, ns } of specs) {
      const types = type ? [type] : Array.from(byType.keys());
      for (const t of types) {
        for (const rec of Array.from(byType.get(t) ?? [])) {
          if (ns.length && !ns.every((n) => rec.ns.includes(n))) continue;
          if (handler && rec.handler !== handler) continue;
          this.#drop(target, rec);
        }
      }
    }
  }

  static trigger(target, evt, detail) {
    for (const { type, ns } of this.parse(evt)) {
      if (!type) continue;
      try {
        const ev = new CustomEvent(type, { bubbles: true, cancelable: true, detail });
        if (ns.length) ev.__fxNs = ns;
        target.dispatchEvent(ev);
      } catch (e) { log.error(`trigger("${type}") failed:`, e); }
    }
  }
}

// ── overrides + additions, shared by handles and roots ───────────────
function onImpl(t, [a, b, c, d]) {
  if (typeof a === "object" && a !== null) { // .on({ click: fn, keyup: fn })
    for (const k of Object.keys(a)) FxEvents.add(t.el, k, null, a[k], b);
    return t;
  }
  if (typeof b === "string") FxEvents.add(t.el, a, b, c, d);
  else FxEvents.add(t.el, a, null, b, c);
  return t;
}

function oneImpl(t, [a, b, c, d]) {
  if (typeof b === "string") FxEvents.add(t.el, a, b, c, d, true);
  else FxEvents.add(t.el, a, null, b, c, true);
  return t;
}

function offImpl(t, [evt, handler]) { FxEvents.remove(t.el, evt, handler); return t; }
function triggerImpl(t, [evt, detail]) { FxEvents.trigger(t.el, evt, detail); return t; }

for (const [name, fn] of [["on", onImpl], ["one", oneImpl], ["off", offImpl], ["trigger", triggerImpl]]) {
  FxPlus.handle(name, fn, "chain");
  FxPlus.root(name, fn);
}

FxPlus.handle("hover", (h, [enter, leave]) => {
  if (typeof enter === "function") FxEvents.add(h.el, "mouseenter", null, enter);
  if (typeof (leave ?? enter) === "function") FxEvents.add(h.el, "mouseleave", null, leave ?? enter);
  return h;
}, "chain");

// ── shortcut methods: bind with a handler, natively trigger without ──
const NO_BUBBLE = new Set(["mouseenter", "mouseleave", "focus", "blur"]);

function nativeTrigger(el, type) {
  try {
    if (type === "focus" && typeof el.focus === "function") return el.focus();
    if (type === "blur" && typeof el.blur === "function") return el.blur();
    if (type === "click" && typeof el.click === "function") return el.click();
    if (type === "select" && typeof el.select === "function") return el.select();
    if (type === "submit" && typeof el.requestSubmit === "function") return el.requestSubmit();
    el.dispatchEvent(new Event(type, { bubbles: !NO_BUBBLE.has(type), cancelable: true }));
  } catch (e) { log.error(`.${type}() native trigger failed:`, e); }
}

export const EVENT_SHORTCUTS = [
  "click", "dblclick", "mousedown", "mouseup", "mouseenter", "mouseleave", "mousemove",
  "focus", "blur", "focusin", "focusout", "change", "select", "submit", "input",
  "keydown", "keypress", "keyup", "contextmenu", "scroll", "resize",
];

for (const type of EVENT_SHORTCUTS) {
  const impl = (t, [handler, opts]) => {
    if (typeof handler === "function") FxEvents.add(t.el, type, null, handler, opts);
    else if (t.el instanceof Element) nativeTrigger(t.el, type);
    else FxEvents.trigger(t.el, type); // window/document: dispatch plain event
    return t;
  };
  FxPlus.handle(type, impl, "chain");
  FxPlus.root(type, impl);
}

export default FxEvents;
