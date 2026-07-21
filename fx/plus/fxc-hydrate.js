// fx/plus/fxc-hydrate.js
//
// FxcHydrator — the declarative HTML extras:
//
//   <header import="/header.html">                      load + insert a partial
//   <div import="company.clients@/clients.json">        api-load INTO a node
//   <ul each="company.clients" as="client">             reactive list, in HTML
//     <li>${client:name}</li>
//   </ul>
//
// `each`/`as` compile onto FxListBinder (keyed reactive rendering) and the
// `${name:field}` tokens are HTML-escaped item lookups (dotted paths allowed).
// Wraps the global $hydrate, so dynamically inserted markup (.html(),
// bindEach rows, stamped fxc templates) gets the same treatment.

import { log } from "./logger.js";
import { FxEnv } from "./kit.js";
import { FxListBinder } from "./list.js";
import { FxcRegistry } from "./fxc.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cleanPath = (s) => String(s ?? "").trim()
  .replace(/^\$\$\{\s*/, "").replace(/^\$\{\s*/, "").replace(/\}\s*$/, "")
  .replace(/^["']|["']$/g, "").trim();
const dotted = (obj, path) => String(path).split(".").reduce((v, k) => (v == null ? undefined : v[k]), obj);

export class FxcHydrator {
  static #wrapped = false;

  /** Process import= attributes and each/as loops under `root`. */
  static scan(root) {
    const r = root instanceof Element ? root : (typeof document !== "undefined" ? document.body : null);
    if (!r) return;
    FxcRegistry.scanInline(r); // inline <fxc:*> declarations register first
    for (const el of [r, ...Array.from(r.querySelectorAll("[import]"))]) {
      if (el instanceof Element && el.hasAttribute?.("import")) this.#import(el);
    }
    for (const el of [r, ...Array.from(r.querySelectorAll("[each]"))]) {
      if (el instanceof Element && el.hasAttribute?.("each")) this.#each(el);
    }
  }

  static #import(el) {
    if (el.tagName === "IMPORT" || el.__fxcImported) return; // kernel owns <import src>
    el.__fxcImported = true;
    const spec = (el.getAttribute("import") || "").trim();
    if (!spec) return;
    try {
      if (spec.includes("@")) {
        FxEnv.$$(spec).get();                       // node-first api load → node fills
      } else if (/\.(html?|txt|md|svg)$/i.test(spec)) {
        const $ = globalThis.$;
        const text = FxEnv.fx.moduleLoader.loadSync(spec);
        if ($ && typeof $ === "function") $(el).html(text);   // binding hygiene + hydration
        else el.innerHTML = text;
      } else {
        log.warn(`import="${spec}": use a text extension or a node@url spec`);
      }
    } catch (e) {
      if (e && e.tag === "FX:SUSPEND") throw e;     // replay boundaries handle it
      log.error(`import="${spec}" failed:`, e);
    }
  }

  static #each(el) {
    if (el.__fxcEach) return;
    el.__fxcEach = true;
    const path = cleanPath(el.getAttribute("each"));
    const asName = cleanPath(el.getAttribute("as") || "item").replace(/^(\w+).*$/, "$1") || "item";
    if (!path) { log.warn("each: node path required"); return; }
    const template = el.innerHTML.trim();
    if (!template) { log.warn(`each="${path}": row template (inner HTML) required`); return; }
    el.innerHTML = "";
    const fieldToken = new RegExp(`\\$\\{${asName}:([\\w.]+)(?:\\|([^}]*))?\\}`, "g");
    const selfToken = new RegExp(`\\$\\{${asName}\\}`, "g");
    const render = (item) => template
      .replace(fieldToken, (_m, field, def) => {
        const v = dotted(item, field);
        return esc(v ?? def ?? "");
      })
      .replace(selfToken, esc(typeof item === "object" ? JSON.stringify(item) : item));
    try {
      const node = FxEnv.$$(path);
      const binder = new FxListBinder(el, node, {
        render,
        key: (item, i) => (item && typeof item === "object" && "id" in item ? item.id : i),
      });
      el.__fxcBinder = binder;
    } catch (e) {
      log.error(`each="${path}" failed:`, e);
    }
  }

  /** Wrap the global $hydrate so dynamic content gets imports/each/fxc too. */
  static install() {
    if (this.#wrapped) return;
    this.#wrapped = true;
    const original = globalThis.$hydrate;
    globalThis.$hydrate = (root) => {
      try { original?.(root); } catch (e) { log.warn("$hydrate (kernel) failed:", e); }
      try { this.scan(root); } catch (e) {
        if (e && e.tag === "FX:SUSPEND") throw e;
        log.error("fxc hydrate extras failed:", e);
      }
    };
    const boot = () => { try { this.scan(document.body); } catch (e) { log.error("fxc boot scan failed:", e); } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }
}

export default FxcHydrator;
