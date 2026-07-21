// fx/plus/forms.js
//
// Forms as first-class reactive citizens:
//   .serialize() / .serializeArray()   — jQuery-exact successful-controls rules
//   .values() / .setValues(obj)        — plain-object snapshot of a form
//   .bindForm("app.form")              — EVERY named control two-way bound to
//                                        $$("app.form.<name>") in one call
//   .unbindForm()
// Plus a .val() upgrade: select[multiple] gets/sets arrays.

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxEnv, FxBindings, FxReactive } from "./kit.js";

export class FxForms {
  static isSubmittable(el) {
    if (!el.name || el.disabled) return false;
    const t = (el.type || "").toLowerCase();
    return !["submit", "button", "reset", "image", "file"].includes(t)
      && !["FIELDSET", "OUTPUT", "BUTTON"].includes(el.tagName);
  }

  static controls(form) {
    return Array.from(form.querySelectorAll("input[name], select[name], textarea[name]"))
      .filter((el) => this.isSubmittable(el));
  }

  /** Current value of one control (checkbox → bool, multi-select → array). */
  static controlValue(el) {
    const t = (el.type || "").toLowerCase();
    if (t === "checkbox") return el.checked;
    if (t === "radio") return el.checked ? el.value : undefined;
    if (el instanceof HTMLSelectElement && el.multiple) {
      return Array.from(el.selectedOptions).map((o) => o.value);
    }
    if (t === "number" || t === "range") return el.value === "" ? "" : Number(el.value);
    return el.value;
  }

  static setControl(el, v) {
    const t = (el.type || "").toLowerCase();
    if (t === "checkbox") { el.checked = Boolean(v); return; }
    if (t === "radio") { el.checked = String(v) === el.value; return; }
    if (el instanceof HTMLSelectElement && el.multiple) {
      const wanted = new Set((Array.isArray(v) ? v : [v]).map(String));
      for (const o of el.options) o.selected = wanted.has(o.value);
      return;
    }
    const next = v == null ? "" : String(v);
    if (el.value !== next) el.value = next; // avoid cursor jumps on identical writes
  }

  /** Radio groups collapse to one logical field per name. */
  static fields(form) {
    const byName = new Map();
    for (const el of this.controls(form)) {
      if (!byName.has(el.name)) byName.set(el.name, []);
      byName.get(el.name).push(el);
    }
    return byName;
  }

  static values(form) {
    const out = {};
    for (const [name, els] of this.fields(form)) {
      const radios = els.filter((e) => (e.type || "").toLowerCase() === "radio");
      if (radios.length === els.length && radios.length) {
        out[name] = radios.find((r) => r.checked)?.value ?? null;
      } else if (els.length === 1) {
        out[name] = this.controlValue(els[0]);
      } else {
        out[name] = els.map((e) => this.controlValue(e));
      }
    }
    return out;
  }

  static serializeArray(form) {
    const out = [];
    for (const el of this.controls(form)) {
      const t = (el.type || "").toLowerCase();
      if ((t === "checkbox" || t === "radio") && !el.checked) continue;
      if (el instanceof HTMLSelectElement && el.multiple) {
        for (const o of el.selectedOptions) out.push({ name: el.name, value: o.value });
      } else {
        out.push({ name: el.name, value: el.value });
      }
    }
    return out;
  }

  static serialize(form) {
    return this.serializeArray(form)
      .map(({ name, value }) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join("&");
  }
}

// ── handle methods ───────────────────────────────────────────────────
const formOf = (h) => (h.el instanceof HTMLFormElement ? h.el : h.el.closest("form")) ?? h.el;

FxPlus.handle("serialize", (h) => FxForms.serialize(formOf(h)), "first");
FxPlus.handle("serializeArray", (h) => FxForms.serializeArray(formOf(h)), "first");
FxPlus.handle("values", (h) => FxForms.values(formOf(h)), "first");

FxPlus.handle("setValues", (h, [obj]) => {
  const form = formOf(h);
  if (!obj || typeof obj !== "object") return h;
  for (const [name, els] of FxForms.fields(form)) {
    if (name in obj) els.forEach((el) => FxForms.setControl(el, obj[name]));
  }
  return h;
}, "chain");

FxPlus.handle("bindForm", (h, [pathOrNode, opts]) => {
  const form = formOf(h);
  const base = FxEnv.toNode(pathOrNode);
  if (!base) { log.warn(".bindForm(): could not resolve node for", pathOrNode); return h; }
  h.unbindForm();
  const events = opts?.live === false ? ["change"] : ["input", "change"];

  for (const [name, els] of FxForms.fields(form)) {
    const node = base(name);
    let pushing = false;

    const controlToNode = () => {
      if (pushing) return;
      const radios = els.filter((e) => (e.type || "").toLowerCase() === "radio");
      const v = radios.length === els.length && radios.length
        ? radios.find((r) => r.checked)?.value ?? null
        : FxForms.controlValue(els[0]);
      pushing = true;
      try { node.set(v); } finally { pushing = false; }
    };

    const nodeToControls = (v) => {
      if (pushing) return;
      pushing = true;
      try { els.forEach((el) => FxForms.setControl(el, v)); } finally { pushing = false; }
    };

    const existing = node.get();
    existing === undefined || existing === null ? controlToNode() : nodeToControls(existing);

    // NOTE: fx-mini watchers receive the internal value BAG — always re-read via .get().
    const unwatch = node.watch(() => nodeToControls(node.get()));
    FxBindings.add(form, unwatch);
    for (const el of els) {
      for (const evt of events) {
        el.addEventListener(evt, controlToNode);
        FxBindings.add(form, () => el.removeEventListener(evt, controlToNode));
      }
    }
  }
  log.debug(`.bindForm() wired ${FxForms.fields(form).size} field(s)`);
  return h;
}, "chain");

FxPlus.handle("unbindForm", (h) => {
  FxBindings.dispose(formOf(h));
  return h;
}, "chain");

// ── .val() upgrade: multi-select arrays (delegates everything else) ──
FxPlus.handle("val", (h, args, prev) => {
  const el = h.el;
  if (el instanceof HTMLSelectElement && el.multiple) {
    if (args.length === 0 || args[0] === undefined) return FxForms.controlValue(el);
    FxReactive.apply(el, args[0], (v) => FxForms.setControl(el, v));
    return h;
  }
  if (args.length === 0 || args[0] === undefined) return prev ? prev() : undefined;
  return prev ? (prev(...args) ?? h) : h;
}, (args) => (args.length === 0 ? "first" : "chain"));

export default FxForms;
