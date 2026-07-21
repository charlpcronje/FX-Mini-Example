// fx/plus/effects.js
//
// jQuery's effects on top of the Web Animations API — the calling API stays
// 100% synchronous and chainable; the browser runs the frames off-thread.
//   .show/.hide/.toggle([dur][,easing][,cb])
//   .fadeIn/.fadeOut/.fadeToggle/.fadeTo   .slideDown/.slideUp/.slideToggle
//   .animate(props[,dur][,easing][,cb])    (supports "+=/-=" and scrollTop/Left)
//   .stop([clearQueue][,jumpToEnd]) .finish() .delay(ms)
// Honors prefers-reduced-motion (durations collapse to 0).

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxData } from "./data.js";
import { FxEffectQueue } from "./effects-queue.js";
import { FxReplay } from "./replay.js";

const SPEEDS = { fast: 200, slow: 600, def: 400 };
const EASINGS = { swing: "cubic-bezier(0.4, 0, 0.2, 1)", linear: "linear" };
const UNITLESS = new Set(["opacity", "zIndex", "fontWeight", "lineHeight", "flexGrow", "flexShrink", "order"]);
const SIZE_PROPS = ["height", "width", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "marginTop", "marginBottom", "marginLeft", "marginRight"];
const SLIDE_PROPS = ["height", "paddingTop", "paddingBottom", "marginTop", "marginBottom"];
const displayCache = new Map(); // tagName -> default display

export class FxEffects {
  static reduced() {
    try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  }

  /** (dur?, easing?, cb?) in any jQuery-legal shape → {duration, easing, cb}. */
  static options(args) {
    let duration = SPEEDS.def, easing = EASINGS.swing, cb = null;
    for (const a of args) {
      if (typeof a === "function") cb = a;
      else if (typeof a === "number") duration = a;
      else if (typeof a === "string") {
        if (a in SPEEDS) duration = SPEEDS[a];
        else easing = EASINGS[a] ?? a;
      }
    }
    if (this.reduced()) duration = 0;
    return { duration: Math.max(0, duration), easing, cb };
  }

  static camel(p) { return p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
  static unit(prop, v) { return typeof v === "number" && !UNITLESS.has(prop) ? `${v}px` : String(v); }
  static isHidden(el) { return getComputedStyle(el).display === "none"; }

  static defaultDisplay(el) {
    const tag = el.tagName;
    if (!displayCache.has(tag)) {
      const probe = document.createElement(tag);
      document.body.appendChild(probe);
      let d = getComputedStyle(probe).display;
      probe.remove();
      if (!d || d === "none") d = "block";
      displayCache.set(tag, d);
    }
    return displayCache.get(tag);
  }

  static showNow(el) {
    if (el.style.display === "none") el.style.display = "";
    if (this.isHidden(el)) el.style.display = FxData.get(el, "fxDisplay") || this.defaultDisplay(el);
  }

  static hideNow(el) {
    if (!this.isHidden(el)) FxData.set(el, "fxDisplay", getComputedStyle(el).display);
    el.style.display = "none";
  }

  /** One queued WAAPI run. `build()` runs at dequeue time and may return null (no-op). */
  static task(el, build, cb) {
    return {
      start: (done) => {
        let spec = null;
        try { spec = build(); } catch (e) { log.error("effect build failed:", e); }
        const finishUp = () => {
          try { spec?.commit?.(); } catch (e) { log.error("effect commit failed:", e); }
          // Replay boundary: completion callbacks may $.ajax without blocking.
          if (cb) { try { FxReplay.invoke(cb, el, []); } catch (e) { log.error("effect callback failed:", e); } }
          done();
        };
        if (!spec || !Object.keys(spec.props).length) { finishUp(); return null; }
        const names = Object.keys(spec.props);
        const from = {}, to = {};
        for (const p of names) { from[p] = spec.props[p][0]; to[p] = spec.props[p][1]; }
        let anim = null;
        try {
          anim = el.animate([from, to], { duration: spec.duration, easing: spec.easing, fill: "forwards" });
        } catch (e) {
          log.error(".animate() rejected keyframes:", e);
          finishUp();
          return null;
        }
        anim.onfinish = () => { finishUp(); try { anim.cancel(); } catch { /* released */ } };
        return {
          cancel: (jump) => {
            anim.onfinish = null;
            if (jump) { try { anim.finish(); } catch { /* detached */ } finishUp(); try { anim.cancel(); } catch { } }
            else {
              try {
                const cs = getComputedStyle(el);
                for (const p of names) el.style[p] = cs[p]; // freeze mid-flight
              } catch { /* detached mid-animation */ }
              try { anim.cancel(); } catch { }
              done();
            }
          },
        };
      },
    };
  }

  /** Build a grow-from-zero (show) or shrink-to-zero (hide) spec over `propNames`.
   *  Pre-animation INLINE styles are captured and restored on commit, so an
   *  element styled inline (height:40px) comes back exactly as it was. */
  static sizeSpec(el, propNames, dir, duration, easing) {
    if (dir === "in" ? !this.isHidden(el) : this.isHidden(el)) return null;
    if (dir === "in") this.showNow(el);
    const cs = getComputedStyle(el);
    const saved = {};
    for (const p of [...propNames, "opacity", "overflow"]) saved[p] = el.style[p];
    const props = { opacity: dir === "in" ? [0, cs.opacity] : [cs.opacity, 0] };
    for (const p of propNames) {
      const v = cs[p];
      props[p] = dir === "in" ? ["0px", v] : [v, "0px"];
    }
    el.style.overflow = "hidden";
    return {
      props, duration, easing,
      commit: () => {
        for (const p of Object.keys(saved)) el.style[p] = saved[p];
        if (dir === "out") this.hideNow(el);
      },
    };
  }

  static fadeSpec(el, dir, duration, easing, target) {
    const cs = getComputedStyle(el);
    const savedOpacity = el.style.opacity;
    if (dir === "in") {
      if (!this.isHidden(el) && parseFloat(cs.opacity) === 1) return null;
      this.showNow(el);
      return { props: { opacity: [this.isHidden(el) ? 0 : cs.opacity, target ?? 1] }, duration, easing,
        commit: () => { el.style.opacity = savedOpacity; } };
    }
    if (dir === "out") {
      if (this.isHidden(el)) return null;
      return { props: { opacity: [cs.opacity, 0] }, duration, easing,
        commit: () => { el.style.opacity = savedOpacity; this.hideNow(el); } };
    }
    return { props: { opacity: [cs.opacity, target] }, duration, easing,
      commit: () => { el.style.opacity = String(target); } };
  }

  /** Scroll tween task (scrollTop/scrollLeft can't go through WAAPI). */
  static scrollTask(el, targets, duration, cb) {
    return {
      start: (done) => {
        const start = {}, delta = {};
        for (const p of Object.keys(targets)) { start[p] = el[p]; delta[p] = targets[p] - el[p]; }
        const t0 = performance.now();
        let raf = 0, finished = false;
        const finishUp = (snap) => {
          if (finished) return;
          finished = true;
          cancelAnimationFrame(raf);
          if (snap) for (const p of Object.keys(targets)) el[p] = targets[p];
          if (cb) { try { FxReplay.invoke(cb, el, []); } catch (e) { log.error("scroll callback failed:", e); } }
          done();
        };
        const step = (now) => {
          const t = duration ? Math.min(1, (now - t0) / duration) : 1;
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          for (const p of Object.keys(targets)) el[p] = start[p] + delta[p] * ease;
          if (t < 1) raf = requestAnimationFrame(step);
          else finishUp(true);
        };
        raf = requestAnimationFrame(step);
        return { cancel: (jump) => finishUp(jump) };
      },
    };
  }
}

// ── handle methods ───────────────────────────────────────────────────
const fx = (name, impl) => FxPlus.handle(name, impl, "chain");

for (const [name, dir, propNames] of [
  ["show", "in", SIZE_PROPS], ["hide", "out", SIZE_PROPS],
  ["slideDown", "in", SLIDE_PROPS], ["slideUp", "out", SLIDE_PROPS],
]) {
  fx(name, (h, args) => {
    if (!args.length && (name === "show" || name === "hide")) {          // instant classics
      name === "show" ? FxEffects.showNow(h.el) : FxEffects.hideNow(h.el);
      return h;
    }
    const { duration, easing, cb } = FxEffects.options(args);
    FxEffectQueue.push(h.el, FxEffects.task(h.el, () => FxEffects.sizeSpec(h.el, propNames, dir, duration, easing), cb));
    return h;
  });
}

fx("toggle", (h, args) => {
  if (typeof args[0] === "boolean") { args[0] ? FxEffects.showNow(h.el) : FxEffects.hideNow(h.el); return h; }
  if (!args.length) { FxEffects.isHidden(h.el) ? FxEffects.showNow(h.el) : FxEffects.hideNow(h.el); return h; }
  return FxEffects.isHidden(h.el) ? h.show(...args) : h.hide(...args);
});

fx("fadeIn", (h, args) => {
  const { duration, easing, cb } = FxEffects.options(args);
  FxEffectQueue.push(h.el, FxEffects.task(h.el, () => FxEffects.fadeSpec(h.el, "in", duration, easing), cb));
  return h;
});

fx("fadeOut", (h, args) => {
  const { duration, easing, cb } = FxEffects.options(args);
  FxEffectQueue.push(h.el, FxEffects.task(h.el, () => FxEffects.fadeSpec(h.el, "out", duration, easing), cb));
  return h;
});

fx("fadeToggle", (h, args) => (FxEffects.isHidden(h.el) ? h.fadeIn(...args) : h.fadeOut(...args)));

fx("fadeTo", (h, [duration, target, ...rest]) => {
  const { easing, cb } = FxEffects.options(rest);
  const dur = FxEffects.options([duration]).duration;
  FxEffectQueue.push(h.el, FxEffects.task(h.el, () => {
    FxEffects.showNow(h.el);
    return FxEffects.fadeSpec(h.el, "to", dur, easing, Number(target));
  }, cb));
  return h;
});

fx("slideToggle", (h, args) => (FxEffects.isHidden(h.el) ? h.slideDown(...args) : h.slideUp(...args)));

fx("animate", (h, [props, ...rest]) => {
  if (!props || typeof props !== "object") { log.warn(".animate(): props object required"); return h; }
  const { duration, easing, cb } = FxEffects.options(rest);
  const cssTargets = {}, scrollTargets = {};
  for (const key of Object.keys(props)) {
    const p = FxEffects.camel(key);
    (p === "scrollTop" || p === "scrollLeft" ? scrollTargets : cssTargets)[p] = props[key];
  }
  const hasCss = Object.keys(cssTargets).length > 0;
  const scrollCb = hasCss ? null : cb; // callback fires once, on the primary task
  if (Object.keys(scrollTargets).length) {
    const resolved = {};
    for (const p of Object.keys(scrollTargets)) {
      const m = /^([+-])=(.+)$/.exec(String(scrollTargets[p]));
      resolved[p] = m ? h.el[p] + (m[1] === "-" ? -1 : 1) * parseFloat(m[2]) : parseFloat(scrollTargets[p]) || 0;
    }
    FxEffectQueue.push(h.el, FxEffects.scrollTask(h.el, resolved, duration, scrollCb));
  }
  if (hasCss) {
    FxEffectQueue.push(h.el, FxEffects.task(h.el, () => {
      const cs = getComputedStyle(h.el);
      const spec = { props: {}, duration, easing, commit: () => {} };
      const finals = {};
      for (const p of Object.keys(cssTargets)) {
        let target = cssTargets[p];
        const m = /^([+-])=(.+)$/.exec(String(target));
        if (m) target = parseFloat(cs[p]) + (m[1] === "-" ? -1 : 1) * parseFloat(m[2]);
        const to = FxEffects.unit(p, target);
        spec.props[p] = [cs[p], to];
        finals[p] = to;
      }
      spec.commit = () => { for (const p of Object.keys(finals)) h.el.style[p] = finals[p]; };
      return spec;
    }, cb));
  }
  return h;
});

fx("stop", (h, [clearQueue, jumpToEnd]) => { FxEffectQueue.stop(h.el, !!clearQueue, !!jumpToEnd); return h; });
fx("finish", (h) => { FxEffectQueue.finish(h.el); return h; });
fx("delay", (h, [ms]) => {
  FxEffectQueue.push(h.el, {
    start: (done) => {
      const t = setTimeout(done, Math.max(0, Number(ms) || 0));
      return { cancel: () => { clearTimeout(t); done(); } };
    },
  });
  return h;
});

export default FxEffects;
