// fx/plus/fxc-compile.js
//
// FxcCompile — turns an `<fxc:name>` declaration into a component definition:
//   • template extraction (style/script pulled out of the markup)
//   • `${prop:name|default}` tokens compiled to kernel `$${"path.name"|"default"}`
//     interpolation with the instance's node path baked in at stamp time
//   • `this:`-scoped styles WITHOUT shadow DOM (rewritten to the host tag and
//     injected once per component; `$${…}` inside CSS stays reactive)
//   • `<script>` (inline or src=, loaded by the sync module loader) compiled
//     with the kernel's export transform — `export default class extends fxc`

import { log } from "./logger.js";
import { FxEnv } from "./kit.js";
import { transformModuleExports } from "../fx-mini.js";

const PROP_TOKEN = /\$\{prop:([\w-]+)(?:\|([^}]*))?\}/g;

export class FxcCompile {
  /** Parse every <fxc:*> declaration inside an HTML string. */
  static parseAll(htmlText) {
    const defs = [];
    try {
      const tpl = document.createElement("template");
      tpl.innerHTML = String(htmlText ?? "");
      for (const el of Array.from(tpl.content.querySelectorAll("*"))) {
        const tag = el.tagName.toLowerCase();
        if (tag.startsWith("fxc:")) defs.push(this.parseDecl(el, tag.slice(4)));
      }
    } catch (e) {
      log.error("fxc: parsing component declarations failed:", e);
    }
    return defs.filter(Boolean);
  }

  /** Parse one declaration element into a definition object. */
  static parseDecl(declEl, name) {
    try {
      const def = {
        name,
        tag: `fxc-${name}`,
        as: (declEl.getAttribute("as") || "").trim() || null,
        shadow: declEl.getAttribute("shadow") === "true",
        attrs: {},
        props: new Set(),
        templateHtml: "",
        klass: null,
        css: "",
      };
      if (def.as === name) def.as = null; // redundant, per spec

      for (const a of declEl.getAttributeNames()) {
        if (["as", "shadow", "name"].includes(a)) continue;
        def.attrs[a] = declEl.getAttribute(a);
      }

      const work = declEl.cloneNode(true);
      const styleEl = work.querySelector("style");
      const scriptEl = work.querySelector("script");
      if (styleEl) {
        if (styleEl.getAttribute("shadow") === "true") def.shadow = true;
        def.css = this.#collectCss(styleEl, def);
        styleEl.remove();
      }
      if (scriptEl) {
        def.klass = this.compileClass(scriptEl.getAttribute("src"), scriptEl.textContent, def);
        scriptEl.remove();
      }
      def.templateHtml = work.innerHTML;

      this.#discoverProps(def);
      if (!def.shadow && def.css) this.injectStyle(def);
      return def;
    } catch (e) {
      log.error(`fxc: bad declaration <fxc:${name}>:`, e);
      return null;
    }
  }

  /** Rewrite ${prop:x|d} → $${"<base>.x" | "d"} for a concrete instance path. */
  static bindProps(text, basePath) {
    return String(text ?? "").replace(PROP_TOKEN, (_m, prop, def) =>
      def !== undefined
        ? `$\${"${basePath}.${prop}" | "${def.replace(/"/g, "'")}"}`
        : `$\${"${basePath}.${prop}"}`);
  }

  static #discoverProps(def) {
    const scan = (text) => {
      for (const m of String(text ?? "").matchAll(PROP_TOKEN)) def.props.add(m[1]);
    };
    scan(def.templateHtml);
    for (const v of Object.values(def.attrs)) scan(v);
  }

  static #collectCss(styleEl, def) {
    let css = styleEl.textContent || "";
    const src = styleEl.getAttribute("src");
    if (src) {
      try { css = FxEnv.fx.moduleLoader.loadSync(src) + "\n" + css; }
      catch (e) { log.warn(`fxc: <style src="${src}"> failed to load:`, e); }
    }
    // `this:h3 { … }` → `fxc-name h3 { … }`; bare `this` → `fxc-name`
    return css.replace(/this\s*:/g, `${def.tag} `).replace(/\bthis\b/g, def.tag);
  }

  /** Inject the (already scoped) css once per component; hydrate it so $${…} in CSS is live. */
  static injectStyle(def) {
    try {
      if (document.head.querySelector(`style[data-fxc="${def.name}"]`)) return;
      const el = document.createElement("style");
      el.setAttribute("data-fxc", def.name);
      el.textContent = def.css;
      document.head.appendChild(el);
      try { FxEnv.hydrate?.(el); } catch { /* css stays static */ }
    } catch (e) {
      log.error(`fxc: style injection for <${def.tag}> failed:`, e);
    }
  }

  /** Compile the component class (inline text or src=, via the sync loader). */
  static compileClass(src, inlineText, def) {
    let code = String(inlineText ?? "").trim();
    if (src) {
      try { code = FxEnv.fx.moduleLoader.loadSync(src); }
      catch (e) { log.error(`fxc: <script src="${src}"> failed to load:`, e); return null; }
    }
    if (!code) return null;
    try {
      const stripped = code
        .replace(/^import\s+[^;]+;?\s*$/gm, "")
        .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, "")
        // Kernel-bug workaround: transformModuleExports mistakes the `extends`
        // of an ANONYMOUS default class for its name. Normalize anonymous
        // default exports before handing over.
        .replace(/(?<![_\w])export\s+default\s+class(?=\s+extends\b|\s*\{)/, "module.exports.default = class")
        .replace(/(?<![_\w])export\s+default\s+function(?=\s*[(*])/, "module.exports.default = function");
      const body = transformModuleExports(stripped) + `\n//# sourceURL=fxc://${def.name}.js`;
      const module = { exports: {} };
      const fn = new Function("module", "exports", "fx", "fxc", "$$", body);
      fn(module, module.exports, FxEnv.fx, globalThis.fxc, globalThis.$$);
      const exported = module.exports.default
        ?? Object.values(module.exports).find((v) => typeof v === "function");
      if (typeof exported !== "function") {
        log.warn(`fxc: <fxc:${def.name}> script exported no class — using base fxc`);
        return null;
      }
      if (!exported.name) { // anonymous `export default class extends fxc {}` — the graft needs a name
        try { Object.defineProperty(exported, "name", { value: `Fxc_${def.name.replace(/[^\w]/g, "_")}` }); }
        catch { /* non-configurable — kernel will fall back */ }
      }
      return exported;
    } catch (e) {
      log.error(`fxc: compiling <fxc:${def.name}> script failed:`, e);
      return null;
    }
  }
}

export default FxcCompile;
