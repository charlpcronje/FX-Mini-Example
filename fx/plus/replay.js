// fx/plus/replay.js
//
// FxReplay — the plus layer's bridge to fx-mini's FXSuspend/replay machinery.
//
// The kernel's contract: code READS synchronously, but a value that isn't
// available yet throws FXSuspend (an Error carrying a promise); an outer
// wrapper catches it, waits, and REPLAYS the whole function. A memo makes the
// I/O idempotent across replays, so requests fire exactly once.
//
// The plus layer applies the same contract to $-land:
//   • FxReplay.invoke(fn, …) is the replay boundary — event handlers, $(fn)
//     ready callbacks, effect-completion callbacks and $computed derivations
//     all run through it, so ANY FXSuspend thrown inside (from $.ajax, or from
//     the kernel's own @-loader) suspends instead of crashing.
//   • FxAjax consults FxReplay.active: inside a boundary it fetches in the
//     background and suspends (UI thread stays free); outside one it falls
//     back to the classic blocking sync XHR, so top-level/console calls keep
//     working unchanged.
//
// Replay rule (same as the kernel's): code BEFORE the first suspending call
// re-runs on replay — keep it idempotent (DOM writes are; counters aren't),
// and call ev.preventDefault() before your first server call.

import { log } from "./logger.js";
import { FxTx } from "./tx.js";

export class FxReplay {
  static #depth = 0;      // >0 → we're inside a replay-capable invocation
  static #pending = 0;    // operations counted into the current replay cycle
  static #memo = new Map();     // requestKey -> settled result (exactly-once I/O)
  static #inflight = new Map(); // requestKey -> in-flight promise (dedupe)

  /** Are we currently inside a replay boundary (so suspending is safe)? */
  static get active() { return this.#depth > 0; }

  /** Can the environment suspend at all (kernel booted + fetch available)? */
  static get canSuspend() {
    return typeof globalThis.FXSuspend === "function" && typeof fetch === "function";
  }

  /** Duck-check matching the kernel's isSuspend (cross-module safe). */
  static isSuspend(e) {
    return !!e && typeof e === "object" && e.tag === "FX:SUSPEND";
  }

  /** Build a kernel FXSuspend for `promise` (null when the kernel is absent). */
  static suspension(promise) {
    const S = globalThis.FXSuspend;
    if (typeof S !== "function") return null;
    return new S(Promise.resolve(promise).catch(() => undefined));
  }

  /**
   * Run `fn` as a replay boundary — the plus-layer twin of the kernel's
   * invokeWithSuspendReplay. On FXSuspend: wait for its promise, then re-run
   * `fn` from the top with the same this/args. The memo survives until the
   * LAST suspended operation completes a full run, then clears — that is what
   * makes POST/PUT/DELETE fire exactly once across replays.
   *
   * Each boundary is also a TRANSACTION (FxTx): graph writes made by an
   * attempt are journaled, and when the op resumes after a suspend the
   * previous attempt's writes are rolled back before the re-run — so
   * `count.set(count.get() + 1)` before a suspending $.get lands exactly
   * once. Rollback + re-run share one microtask (nothing paints in between);
   * during the wait itself the attempt's writes stay visible (optimistic UI).
   */
  static invoke(fn, thisArg, args = []) {
    if (typeof fn !== "function") return undefined;
    let counted = false;
    const op = FxTx.createOp();
    const leave = () => {
      if (!counted) return;
      counted = false;
      this.#pending--;
      if (this.#pending === 0) { this.#memo.clear(); this.#inflight.clear(); }
    };
    const run = () => {
      if (!counted) { counted = true; this.#pending++; }
      this.#depth++;
      FxTx.push(op);
      try {
        FxTx.beginAttempt(op);           // attempt N+1: undo attempt N's writes
        const result = fn.apply(thisArg, args);
        leave();
        return result;
      } catch (e) {
        if (FxReplay.isSuspend(e)) {
          // Stay counted: the memo must outlive every replay of this op.
          e.promise.then(() => queueMicrotask(run), () => queueMicrotask(run));
          return undefined;
        }
        leave();
        throw e;
      } finally {
        FxTx.pop(op);
        this.#depth--;
      }
    };
    return run();
  }

  /** Wrap `fn` so every future call runs through the replay boundary. */
  static wrap(fn) {
    if (typeof fn !== "function") return fn;
    const self = this;
    return function (...args) { return self.invoke(fn, this, args); };
  }

  // ── request memo (used by FxAjax; keys = method+url+body) ───────────
  static memoHas(key) { return this.#memo.has(key); }
  static memoGet(key) { return this.#memo.get(key); }
  static memoSet(key, value) { this.#memo.set(key, value); }

  static inflightHas(key) { return this.#inflight.has(key); }
  static inflightGet(key) { return this.#inflight.get(key); }
  static inflightSet(key, promise) { this.#inflight.set(key, promise); }
  static inflightDelete(key) { this.#inflight.delete(key); }

  /** Diagnostics for $fxp: current cycle state. */
  static stats() {
    return { active: this.active, pending: this.#pending, memo: this.#memo.size, inflight: this.#inflight.size };
  }
}

export default FxReplay;
