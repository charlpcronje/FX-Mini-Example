// fx/plus/logger.js
//
// FxLogger — the SINGLE logger for every FX Mini Plus module. All plus code
// routes diagnostics through the one exported `log` instance, so log level,
// formatting and history live in exactly one place.
//
//   log.level = "debug";              // "debug" | "info" | "warn" | "error" | "silent"
//   localStorage.setItem("fx:log", "debug");   // persisted override, read at boot
//   log.dump();                       // last 200 entries (ring buffer)

export class FxLogger {
  static LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

  #level;
  #prefix;
  #buffer;
  #max;

  /**
   * @param {string} prefix   Tag prepended to every entry.
   * @param {string} level    Minimum level that reaches the console.
   * @param {number} maxBuffer Ring-buffer capacity for `.dump()`.
   */
  constructor(prefix = "[FX+]", level = "warn", maxBuffer = 200) {
    this.#prefix = prefix;
    this.#buffer = [];
    this.#max = maxBuffer;
    this.#level = FxLogger.LEVELS[level] ?? FxLogger.LEVELS.warn;
  }

  get level() {
    const entry = Object.entries(FxLogger.LEVELS).find(([, v]) => v === this.#level);
    return entry ? entry[0] : "warn";
  }

  set level(name) {
    if (name in FxLogger.LEVELS) this.#level = FxLogger.LEVELS[name];
    else this.#emit("warn", [`unknown log level "${name}" (kept "${this.level}")`]);
  }

  debug(...args) { this.#emit("debug", args); }
  info(...args)  { this.#emit("info", args); }
  warn(...args)  { this.#emit("warn", args); }
  error(...args) { this.#emit("error", args); }

  /** Snapshot of the ring buffer: [{ time, level, args }]. */
  dump() { return this.#buffer.slice(); }

  /** Empty the ring buffer. */
  clear() { this.#buffer.length = 0; }

  #emit(levelName, args) {
    try {
      this.#buffer.push({ time: Date.now(), level: levelName, args });
      if (this.#buffer.length > this.#max) this.#buffer.splice(0, this.#buffer.length - this.#max);
      if (FxLogger.LEVELS[levelName] < this.#level) return;
      const fn = levelName === "debug" ? console.debug
        : levelName === "info" ? console.info
        : levelName === "warn" ? console.warn
        : console.error;
      fn(this.#prefix, ...args);
    } catch {
      /* logging must never throw into application code */
    }
  }
}

/** Resolve the boot log level: localStorage "fx:log" wins, default "warn". */
function bootLevel() {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem("fx:log");
      if (v && v in FxLogger.LEVELS) return v;
    }
  } catch { /* storage blocked (private mode / sandbox) — fall through */ }
  return "warn";
}

/** The single shared logger instance. Import THIS everywhere. */
export const log = new FxLogger("[FX+]", bootLevel());

export default log;
