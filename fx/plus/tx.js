// fx/plus/tx.js
//
// FxTx — replay transactions. Solves the classic replay hazard:
//
//     $$("app.count").set($$("app.count").get() + 1);   // ← would run twice
//     const d = $$("app.data@/api").get();              // suspend → replay
//
// Every replay boundary (FxReplay.invoke) owns an OP with an inverse write
// journal. All fx graph writes made during an attempt are journaled (first
// touch records the node's prior __value/__type BY REFERENCE — the kernel
// replaces value bags on every write, so references are exact snapshots).
// When the op resumes for attempt N+1, attempt N's writes are rolled back
// newest-first, then the code re-runs from clean state — so read-modify-write
// sequences produce their effect EXACTLY ONCE, and replays read the same
// pre-state they read the first time.
//
// Timing makes it invisible: writes stay visible DURING the wait (optimistic
// UI like "loading…" renders), and the rollback + re-run happen in one
// microtask at resume — before the browser paints.
//
// Concurrency: if another handler wrote the same node while this op was
// suspended, the reference check (current !== what we wrote) detects it and
// that node's rollback is skipped — the newer write wins, and our replay
// re-derives on top of it.
//
// There is NO ceremony for the developer. The two natural rules:
//   1. State lives in the graph (that's FX) → exactly-once automatically.
//   2. Fire-and-forget effects (beacons, logging) go AFTER the request —
//      code after the last suspending call only runs on the completing
//      pass, so it executes exactly once by construction.

import { log } from "./logger.js";

export class FxTx {
  static enabled = true;      // $fxp.tx.enabled = false → journaling off
  static #stack = [];         // active ops (innermost boundary owns the writes)
  static #hooked = false;
  static #rollingBack = false;

  static get current() {
    return this.#stack.length ? this.#stack[this.#stack.length - 1] : null;
  }

  static get depth() { return this.#stack.length; }

  static createOp() {
    return {
      journal: new Map(),   // FXNode -> { prior, priorType, wrote }
      order: [],            // touch order (rolled back in reverse)
      attempt: 0,
    };
  }

  static push(op) { this.#stack.push(op); }

  static pop(op) {
    const i = this.#stack.lastIndexOf(op);
    if (i >= 0) this.#stack.splice(i, 1);
  }

  /**
   * Patch the FXCore instance so every graph write (fx.set / fx.valStore —
   * the funnel ALL proxy writes go through, including setPath and grafts)
   * is journaled into the active op. Installed once at boot.
   */
  static hookGraph(fx) {
    if (this.#hooked) return;
    if (!fx || typeof fx.set !== "function" || typeof fx.valStore !== "function") {
      log.warn("FxTx.hookGraph: fx core not available — replay transactions disabled");
      return;
    }
    this.#hooked = true;
    const self = this;
    for (const method of ["set", "valStore"]) {
      const original = fx[method].bind(fx);
      fx[method] = function (node, value, ...rest) {
        const op = self.enabled && !self.#rollingBack ? self.current : null;
        if (op && node && node.__id) {
          if (!op.journal.has(node)) {
            op.journal.set(node, { prior: node.__value, priorType: node.__type, wrote: undefined });
            op.order.push(node);
          }
        }
        const result = original(node, value, ...rest);
        if (op && node && node.__id) {
          const rec = op.journal.get(node);
          if (rec) rec.wrote = node.__value; // reference to the bag we produced
        }
        return result;
      };
    }
    log.debug("FxTx: graph write journal hooked into fx.set/valStore");
  }

  /**
   * Called at the start of every attempt. Attempt 1 is a no-op; attempt N+1
   * first UNDOES attempt N's journaled writes (newest-first, watcher-notified,
   * conflict-checked), then clears the journal for the fresh run.
   */
  static beginAttempt(op) {
    op.attempt++;
    if (!op.order.length) return;
    this.#rollingBack = true;
    try {
      for (let i = op.order.length - 1; i >= 0; i--) {
        const node = op.order[i];
        const rec = op.journal.get(node);
        if (!rec) continue;
        if (node.__value !== rec.wrote) {
          // Someone else wrote this node while we were suspended — theirs wins;
          // our replay will re-derive on top of the newer value.
          log.warn("FxTx: concurrent write during suspend — rollback of one node skipped");
          continue;
        }
        const old = node.__value;
        node.__value = rec.prior;
        node.__type = rec.priorType;
        if (node.__watchers) {
          for (const cb of Array.from(node.__watchers)) {
            try { cb(node.__value, old); } catch (e) { log.error("watcher failed during rollback:", e); }
          }
        }
        try { globalThis.fx?.emitStructure?.({ kind: "mutate", node }); } catch { /* bus optional */ }
      }
    } finally {
      this.#rollingBack = false;
      op.journal.clear();
      op.order.length = 0;
    }
  }

  static stats() {
    const op = this.current;
    return {
      enabled: this.enabled,
      depth: this.#stack.length,
      journaled: op ? op.order.length : 0,
      attempt: op ? op.attempt : 0,
    };
  }
}

export default FxTx;
