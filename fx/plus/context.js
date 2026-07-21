// fx/plus/context.js
//
// FxContext — the second argument of $: WHERE to select.
//
//   $("#user-card", $$("@/snippets.html"))       // HTML string → inert <template>,
//                                                //   selections come back as CLONES (stamps)
//   $("section", $("#card", snippets))           // Handle/Group → live scoped query
//   $(".item", "#sidebar")                       // selector string → scoped roots
//   $("#row", $$("@/snippets"))                  // api binding → fetched html (cached)
//
// An FX NODE as the second argument keeps its existing meaning (two-way bind:
// `$("#field", $$("form.email"))`) — that path never reaches this module.
//
// The snippet-library flow this enables: keep many fragments in ONE file,
// load it once (the kernel's @-loader caches text by URL), stamp copies out:
//
//   const snippets = $$("@/snippets.html");          // sync, cached
//   $("#user-card", snippets).removeAttr("id").appendTo("#list");
//
// HTML-string contexts parse once into a cached <template> (never touching the
// live DOM) and every selection clones — so the same snippet can be stamped
// any number of times. Live contexts (elements, handles, groups) do NOT clone.

import { log } from "./logger.js";
import { FxDom } from "./kit.js";

export class FxContext {
  static #templates = new Map(); // html string -> HTMLTemplateElement
  static #bindingHtml = new WeakMap(); // FxApiBinding -> fetched html string
  static MAX_TEMPLATES = 64;

  /**
   * Resolve `selector` inside `ctx`. Returns raw elements — clones for
   * parsed-HTML contexts, live elements for DOM contexts.
   */
  static selectElements(selector, ctx) {
    if (typeof selector !== "string" || !selector.trim()) {
      log.warn("$(selector, context): selector must be a non-empty string");
      return [];
    }
    const { roots, clone } = this.#roots(ctx);
    const found = [];
    for (const root of roots) {
      try { found.push(...root.querySelectorAll(selector)); }
      catch (e) { log.warn(`$(selector, context): bad selector "${selector}"`, e); return []; }
    }
    const unique = FxDom.unique(found);
    return clone ? unique.map((n) => n.cloneNode(true)) : unique;
  }

  static #roots(ctx) {
    // HTML string → cached inert template; selector string → scoped live roots.
    if (typeof ctx === "string") {
      if (FxDom.isHtml(ctx)) return { roots: [this.#template(ctx).content], clone: true };
      try { return { roots: Array.from(document.querySelectorAll(ctx)), clone: false }; }
      catch (e) { log.warn(`$(sel, context): bad context selector "${ctx}"`, e); return { roots: [], clone: false }; }
    }
    // Node-first api binding → fetch as html once (may SUSPEND inside a
    // boundary — the replay re-enters and hits the cache), then stamp.
    if (ctx && ctx.__fxApiBinding === true) {
      let html = this.#bindingHtml.get(ctx);
      if (html === undefined) {
        html = String(ctx.get(null, { dataType: "html", schema: { template: "data" } }) ?? "");
        this.#bindingHtml.set(ctx, html);
      }
      return { roots: [this.#template(html).content], clone: true };
    }
    if (ctx instanceof Element || ctx instanceof Document || ctx instanceof DocumentFragment) {
      return { roots: [ctx], clone: false };
    }
    if (Array.isArray(ctx?.elements)) {                       // Group → live
      return { roots: ctx.elements.map((h) => h.el).filter((e) => e instanceof Element), clone: false };
    }
    if (ctx?.el instanceof Element) return { roots: [ctx.el], clone: false };  // Handle → live
    if (ctx?.el === document || ctx?.el === window) return { roots: [document], clone: false };
    log.warn("$(sel, context): unsupported context — falling back to document", ctx);
    return { roots: [document], clone: false };
  }

  static #template(html) {
    let tpl = this.#templates.get(html);
    if (!tpl) {
      tpl = document.createElement("template");
      tpl.innerHTML = html;
      if (this.#templates.size >= this.MAX_TEMPLATES) {
        const oldest = this.#templates.keys().next().value;   // simple FIFO eviction
        this.#templates.delete(oldest);
      }
      this.#templates.set(html, tpl);
    }
    return tpl;
  }

  /** Diagnostics for $fxp. */
  static stats() { return { templates: this.#templates.size, max: this.MAX_TEMPLATES }; }
}

export default FxContext;
