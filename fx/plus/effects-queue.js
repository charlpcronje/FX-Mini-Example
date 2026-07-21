// fx/plus/effects-queue.js
//
// FxEffectQueue — the per-element animation queue behind the effects module.
// Tasks run strictly one-at-a-time per element (jQuery's fx queue semantics):
// a task is `{ start(done) -> { cancel(jumpToEnd) } | null }`; calling `done`
// exactly once releases the queue for the next task.

import { log } from "./logger.js";

export class FxEffectQueue {
  static #state = new WeakMap(); // Element -> { tasks: Task[], running: {cancel} | null }

  static state(el) {
    let st = this.#state.get(el);
    if (!st) { st = { tasks: [], running: null }; this.#state.set(el, st); }
    return st;
  }

  /** Queue a task; starts immediately when the element is idle. */
  static push(el, task) {
    const st = this.state(el);
    st.tasks.push(task);
    if (!st.running) this.#next(el);
  }

  static #next(el) {
    const st = this.state(el);
    const task = st.tasks.shift();
    if (!task) { st.running = null; return; }
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      st.running = null;
      queueMicrotask(() => this.#next(el)); // avoid deep sync recursion on 0ms chains
    };
    try {
      st.running = task.start(done) || { cancel: () => done() };
      if (finished) st.running = null; // task completed synchronously inside start()
    } catch (e) {
      log.error("effect task failed to start:", e);
      done();
    }
  }

  /**
   * Stop the element's current animation.
   * @param {boolean} clearQueue Also drop everything still queued.
   * @param {boolean} jumpToEnd  Snap to the animation's end state (runs its commit + callback).
   */
  static stop(el, clearQueue = false, jumpToEnd = false) {
    const st = this.state(el);
    if (clearQueue) st.tasks.length = 0;
    const running = st.running;
    if (running) {
      try { running.cancel(jumpToEnd); }
      catch (e) { log.warn("effect cancel failed:", e); }
    }
  }

  /** jQuery .finish(): clear the queue and jump the current animation to its end. */
  static finish(el) {
    this.stop(el, true, true);
  }

  static isAnimating(el) {
    const st = this.#state.get(el);
    return !!(st && (st.running || st.tasks.length));
  }
}

export default FxEffectQueue;
