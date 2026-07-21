// fx/plus/fxc.js
//
// fxc — the lightweight component model: real web components whose props ARE
// sub-nodes of the graph. Declare in any HTML file:
//
//   <fxc:button color="${prop:color|red}" as="button">
//     <h3><slot name="heading"></slot></h3>
//     <slot>${prop:label|Click}</slot>
//     <style> this:h3 { color: ${prop:color|red}; } </style>
//     <script> export default class extends fxc {
//       label = "Click";                       // fields = prop defaults
//       mount() { … } unmount() { … } propChange(name, value) { … }
//     } </script>
//   </fxc:button>
//
// Register with $fxc.load("/components.html") (sync, cached) — inline
// declarations in the page register automatically at boot. Use anywhere:
//
//   <fxc-button $color="#777" $node="button.blue">...</fxc-button>
//
// `$attr` seeds a prop; plain attrs stay attributes. Instances live at
// fxc.<name> (then fxc.<name>.1, .2 …) or the explicit `$node` path, and
// props are reactive sub-nodes: $$("fxc.button.blue.color").set("#0af")
// updates the DOM; user edits flow back into the graph. Lifecycle methods
// run inside replay boundaries, so $.ajax in mount() suspends, not blocks.

import { log } from "./logger.js";
import { FxEnv, FxBindings } from "./kit.js";
import { FxReplay } from "./replay.js";
import { FxcCompile } from "./fxc-compile.js";

/** Base controller — extend this in component <script> blocks. */
export class fxc {
  el = null;    // host element        (never grafted — kernel skips "el")
  node = null;  // instance node proxy (never grafted — kernel skips "node")
  mount() {}
  unmount() {}
  propChange(_name, _value) {}
}

export class FxcRegistry {
  static #defs = new Map();     // name -> def
  static #counters = new Map(); // name -> instances seen

  /** Load a component library file (sync, loader-cached) and register all. */
  static load(url) {
    try { return this.defineFrom(FxEnv.fx.moduleLoader.loadSync(url)); }
    catch (e) { log.error(`$fxc.load("${url}") failed:`, e); return []; }
  }

  /** Register every <fxc:*> declaration found in an HTML string. */
  static defineFrom(htmlText) {
    return FxcCompile.parseAll(htmlText).map((def) => this.define(def)).filter(Boolean);
  }

  static define(def) {
    if (this.#defs.has(def.name) || customElements.get(def.tag)) {
      log.warn(`fxc: <${def.tag}> already defined — skipped`);
      return null;
    }
    this.#defs.set(def.name, def);
    customElements.define(def.tag, this.#makeHost(def));
    log.info(`fxc: <${def.tag}> registered (props: ${[...def.props].join(", ") || "—"})`);
    return def.tag;
  }

  static get(name) { return this.#defs.get(name) ?? null; }
  static names() { return Array.from(this.#defs.keys()); }

  /** Register declarations written inline in the live document. */
  static scanInline(root = document) {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const tag = el.tagName.toLowerCase();
      if (!tag.startsWith("fxc:")) continue;
      const def = FxcCompile.parseDecl(el, tag.slice(4));
      if (def) this.define(def);
      el.remove();
    }
  }

  static #allocPath(host, def) {
    for (const a of ["$node", "node-path", "node_path"]) {
      const v = host.getAttribute(a);
      if (v && v.trim()) return `fxc.${v.trim()}`;
    }
    const n = this.#counters.get(def.name) ?? 0;
    this.#counters.set(def.name, n + 1);
    return n === 0 ? `fxc.${def.name}` : `fxc.${def.name}.${n}`;
  }

  static #makeHost(def) {
    const registry = this;
    return class extends HTMLElement {
      connectedCallback() {
        this.__fxcGone = false;
        if (this.__fxcReady) { registry.#life(this.__fxc, "mount"); return; }
        this.__fxcReady = true;
        try { registry.#setup(this, def); }
        catch (e) {
          if (FxReplay.isSuspend(e)) throw e;
          log.error(`<${def.tag}> setup failed:`, e);
        }
      }

      disconnectedCallback() {
        this.__fxcGone = true;
        queueMicrotask(() => {           // survive appendTo-style moves
          if (!this.__fxcGone || this.isConnected) return;
          registry.#life(this.__fxc, "unmount");
          FxBindings.disposeTree(this);
        });
      }
    };
  }

  static #life(controller, method, ...args) {
    if (!controller) return;
    try { FxReplay.invoke(controller[method], controller, args); }
    catch (e) { log.error(`fxc ${method}() failed:`, e); }
  }

  static #setup(host, def) {
    const $$ = FxEnv.$$;
    const path = host.__fxcPath = this.#allocPath(host, def);
    const node = $$(path);

    // 1. Controller instance grafted onto the node — fields become reactive
    //    sub-nodes with two-way sync; methods callable via $$(path).method().
    const Klass = def.klass ?? fxc;
    const controller = new Klass();
    controller.el = host;
    host.__fxc = controller;
    node.as(controller);
    controller.node = node;

    // 2. Seed props from usage: $color="#777" → fxc.<path>.color
    for (const a of host.getAttributeNames()) {
      if (!a.startsWith("$") || a === "$node") continue;
      node(a.slice(1)).set(host.getAttribute(a));
    }

    // 3. Stamp the template (light DOM by default; shadow when declared).
    const light = def.shadow ? null : Array.from(host.childNodes);
    let root = host;
    if (def.shadow) {
      root = host.attachShadow({ mode: "open" });
      if (def.css) {
        const style = document.createElement("style");
        style.textContent = def.css;
        root.appendChild(style);
      }
    } else {
      host.textContent = "";
      if (def.as) { root = document.createElement(def.as); host.appendChild(root); }
    }
    const stampRoot = def.as && !def.shadow ? root : (def.shadow ? root : host);
    stampRoot.insertAdjacentHTML("beforeend", FxcCompile.bindProps(def.templateHtml, path));
    for (const [k, v] of Object.entries(def.attrs)) {
      try { root.setAttribute(k, FxcCompile.bindProps(v, path)); } catch { /* bad attr name */ }
    }

    // 4. Light-DOM slot distribution (native slotting handles shadow mode).
    if (!def.shadow) this.#distribute(stampRoot, light);

    // 5. Hydrate: $${…}, {…} and the compiled prop bindings go live.
    try { FxEnv.hydrate?.(def.shadow ? root : host); }
    catch (e) { log.warn(`<${def.tag}> hydration failed:`, e); }

    // 6. propChange lifecycle — one watcher per prop (declared + class fields).
    const props = new Set(def.props);
    for (const k of Object.keys(controller)) {
      if (!["el", "node", "props"].includes(k) && typeof controller[k] !== "function") props.add(k);
    }
    for (const p of props) {
      const unwatch = node(p).watch(() => this.#life(controller, "propChange", p, node(p).get()));
      FxBindings.add(host, unwatch);
    }

    this.#life(controller, "mount");
  }

  static #distribute(root, light) {
    const named = new Map();
    const rest = [];
    for (const n of light ?? []) {
      const slotName = n instanceof Element ? n.getAttribute("slot") : null;
      if (slotName) {
        if (!named.has(slotName)) named.set(slotName, []);
        named.get(slotName).push(n);
      } else if (!(n.nodeType === 3 && !n.nodeValue.trim())) {
        rest.push(n);
      }
    }
    let defaultUsed = false;
    for (const slot of Array.from(root.querySelectorAll("slot"))) {
      const name = slot.getAttribute("name");
      let assigned = [];
      if (name) assigned = named.get(name) ?? [];
      else if (!defaultUsed) { assigned = rest; defaultUsed = rest.length > 0; }
      if (assigned.length) slot.replaceWith(...assigned);
      else slot.replaceWith(...Array.from(slot.childNodes)); // declared fallback
    }
  }
}

export default FxcRegistry;
