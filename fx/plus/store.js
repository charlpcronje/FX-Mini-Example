// fx/plus/store.js
//
// State that survives and rewinds — still 100% synchronous:
//   $persist("app.settings")        — localStorage-backed subtree: loads now,
//                                     auto-saves on every mutation beneath it
//   $history.track("app.todos")    — undo/redo time travel over any subtree
//   $history.undo() / .redo()
// Both ride fx-mini's batched structure-event bus (fx.onStructure), so child
// writes like $$("app.settings.theme").set(…) are caught without polling.

import { log } from "./logger.js";
import { FxPlus } from "./core.js";
import { FxEnv } from "./kit.js";

/** Is `node` (an FXNode) inside the subtree rooted at `rootNode`? */
function isUnder(fxCore, node, rootNode) {
  let cur = node;
  let hops = 0;
  while (cur && hops++ < 64) {
    if (cur.__id === rootNode.__id) return true;
    cur = fxCore.findParentFast(cur);
  }
  return false;
}

function snapshotOf(node) {
  try { return JSON.stringify(node.get() ?? null); }
  catch (e) { log.error("snapshot failed:", e); return "null"; }
}

export class FxPersist {
  #node;
  #key;
  #storage;
  #debounce;
  #timer = null;
  #unsub = null;
  #applying = false;

  constructor(pathOrNode, opts = {}) {
    this.#node = FxEnv.toNode(pathOrNode);
    if (!this.#node) throw new Error(`$persist: could not resolve node for ${pathOrNode}`);
    const path = typeof pathOrNode === "string" ? pathOrNode : "node";
    this.#key = opts.key ?? `fx:${path}`;
    this.#storage = opts.storage ?? (opts.session ? sessionStorage : localStorage);
    this.#debounce = Number(opts.debounce ?? 80);
    this.load();
    const fxCore = FxEnv.fx;
    const rootNode = this.#node.node();
    this.#unsub = fxCore.onStructure((e) => {
      if (this.#applying) return;
      if ((e.kind === "mutate" || e.kind === "create") && isUnder(fxCore, e.node, rootNode)) {
        this.#schedule();
      }
    });
  }

  #schedule() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.save(), this.#debounce);
  }

  load() {
    try {
      const raw = this.#storage.getItem(this.#key);
      if (raw == null) return false;
      this.#applying = true;
      try { this.#node.set(JSON.parse(raw)); } finally { setTimeout(() => { this.#applying = false; }, 20); }
      return true;
    } catch (e) {
      log.warn(`$persist load("${this.#key}") failed:`, e);
      return false;
    }
  }

  save() {
    try {
      this.#storage.setItem(this.#key, snapshotOf(this.#node));
      return true;
    } catch (e) {
      log.error(`$persist save("${this.#key}") failed (quota?):`, e);
      return false;
    }
  }

  clear() {
    try { this.#storage.removeItem(this.#key); } catch (e) { log.warn("$persist clear failed:", e); }
  }

  dispose() {
    clearTimeout(this.#timer);
    try { this.#unsub?.(); } catch { /* already gone */ }
  }
}

export class FxHistory {
  static #tracks = new Map(); // path -> track
  static #order = [];         // paths by most-recent change (for path-less undo)
  static #unsub = null;

  static track(path, opts = {}) {
    if (this.#tracks.has(path)) return this.#tracks.get(path);
    const node = FxEnv.toNode(path);
    if (!node) throw new Error(`$history.track: could not resolve node for ${path}`);
    const track = {
      path, node, rootNode: node.node(),
      stack: [snapshotOf(node)], idx: 0,
      limit: Math.max(2, Number(opts.limit ?? 100)),
      applying: false, timer: null,
    };
    this.#tracks.set(path, track);
    this.#ensureBus();
    log.debug(`$history tracking "${path}"`);
    return track;
  }

  static #ensureBus() {
    if (this.#unsub) return;
    const fxCore = FxEnv.fx;
    this.#unsub = fxCore.onStructure((e) => {
      if (e.kind !== "mutate" && e.kind !== "create") return;
      for (const track of this.#tracks.values()) {
        if (track.applying || !isUnder(fxCore, e.node, track.rootNode)) continue;
        clearTimeout(track.timer);
        track.timer = setTimeout(() => this.#capture(track), 120);
      }
    });
  }

  static #capture(track) {
    if (track.applying) return;
    const snap = snapshotOf(track.node);
    if (snap === track.stack[track.idx]) return;      // no effective change
    track.stack.splice(track.idx + 1);                // drop the redo tail
    track.stack.push(snap);
    if (track.stack.length > track.limit) track.stack.shift();
    track.idx = track.stack.length - 1;
    this.#order = this.#order.filter((p) => p !== track.path);
    this.#order.push(track.path);
  }

  static #pick(path) {
    if (path) return this.#tracks.get(path) ?? null;
    for (let i = this.#order.length - 1; i >= 0; i--) {
      const t = this.#tracks.get(this.#order[i]);
      if (t) return t;
    }
    return this.#tracks.values().next().value ?? null;
  }

  static #apply(track, idx) {
    clearTimeout(track.timer);
    track.applying = true;
    try {
      track.idx = idx;
      track.node.set(JSON.parse(track.stack[idx]));
    } catch (e) {
      log.error("$history apply failed:", e);
    } finally {
      setTimeout(() => { track.applying = false; }, 30); // outlive the 5ms event batch
    }
  }

  static undo(path) {
    const t = this.#pick(path);
    if (!t || t.idx <= 0) return false;
    this.#apply(t, t.idx - 1);
    return true;
  }

  static redo(path) {
    const t = this.#pick(path);
    if (!t || t.idx >= t.stack.length - 1) return false;
    this.#apply(t, t.idx + 1);
    return true;
  }

  static canUndo(path) { const t = this.#pick(path); return !!t && t.idx > 0; }
  static canRedo(path) { const t = this.#pick(path); return !!t && t.idx < t.stack.length - 1; }
  static depth(path) { const t = this.#pick(path); return t ? t.idx : 0; }

  static clear(path) {
    const t = this.#pick(path);
    if (!t) return;
    t.stack = [snapshotOf(t.node)];
    t.idx = 0;
  }

  static untrack(path) {
    const t = this.#tracks.get(path);
    if (t) clearTimeout(t.timer);
    this.#tracks.delete(path);
    this.#order = this.#order.filter((p) => p !== path);
  }
}

export function persist(pathOrNode, opts) { return new FxPersist(pathOrNode, opts); }

FxPlus.util("persist", persist);
FxPlus.util("history", FxHistory);

export default FxHistory;
