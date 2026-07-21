// fx/fx-mini.ts
var HAS_DENO = typeof globalThis.Deno !== "undefined";
var HAS_NODE = typeof globalThis.process !== "undefined" && globalThis.process.versions?.node;
var IS_SERVER = HAS_DENO || HAS_NODE;
var nowId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
var isHttp = (u) => /^https?:\/\//i.test(u);
var isRel = (u) => u.startsWith("/") && !u.startsWith("//");
var toNumIfStr = (v) => typeof v === "string" && v.trim() !== "" && isFinite(v) ? parseFloat(v) : v;
var safeJson = (v) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
var prop = (o, k, v, enumerable = false) => Object.defineProperty(o, k, { value: v, configurable: true, writable: false, enumerable });
var GRAFT_SKIP_KEYS = /* @__PURE__ */ new Set(["el", "node", "props"]);
var isGraftableValue = (v) => {
  if (typeof v === "function") return false;
  if (v === null || typeof v !== "object") return true;
  if (Array.isArray(v)) return true;
  if (v[FX_PROXY_MARKER] === true) return false;
  const ctor = v.constructor;
  return !ctor || ctor.name === "Object";
};
var FX_PROXY_MARKER = Symbol.for("fx:proxy");
var isProxy = (v) => !!v && v[FX_PROXY_MARKER] === true;
function isUIThread() {
  return typeof window !== "undefined" && !(typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope);
}
async function uiFriendlyWait(i32, idx, expected, timeout = Infinity) {
  const anyAtomics = Atomics;
  if (typeof anyAtomics.waitAsync === "function") {
    const res = anyAtomics.waitAsync(i32, idx, expected, timeout);
    if (res?.async === false) return res.value;
    return await res.value;
  }
  const start = performance.now();
  while (true) {
    if (Atomics.load(i32, idx) !== expected) return "ok";
    if (timeout !== Infinity && performance.now() - start >= timeout) return "timed-out";
    await new Promise(requestAnimationFrame);
  }
}
var FXSuspend = class extends Error {
  promise;
  tag = "FX:SUSPEND";
  constructor(p) {
    super("FX:SUSPEND");
    this.promise = p;
  }
};
function isSuspend(e) {
  return !!e && typeof e === "object" && e.tag === "FX:SUSPEND";
}
function schedule(fn) {
  Promise.resolve().then(fn);
}
var httpMemo = /* @__PURE__ */ new Map();
var httpMemoActive = 0;
function invokeWithSuspendReplay(fn, thisArg, args) {
  let counted = false;
  const leave = () => {
    if (counted) {
      counted = false;
      if (--httpMemoActive === 0) httpMemo.clear();
    }
  };
  const run = () => {
    if (!counted) {
      counted = true;
      httpMemoActive++;
    }
    try {
      const r = fn.apply(thisArg, args);
      leave();
      return r;
    } catch (e) {
      if (isSuspend(e)) {
        e.promise.then(() => schedule(run), () => schedule(run));
        return void 0;
      }
      leave();
      throw e;
    }
  };
  return run();
}
globalThis.FXSuspend = FXSuspend;
var SyncModuleLoader = class {
  getNodeModules() {
    if (!HAS_NODE) {
      throw new Error("Node modules requested outside Node environment");
    }
    const globalRequire = globalThis.require || globalThis.module?.require;
    if (!globalRequire) {
      throw new Error("require is not available in this runtime");
    }
    return {
      fs: globalRequire("fs"),
      path: globalRequire("path")
    };
  }
  worker = null;
  sab = null;
  lock = null;
  len = null;
  buf = null;
  cache = /* @__PURE__ */ new Map();
  TIMEOUT_MS = 15e3;
  cspMode = false;
  moduleIntegrity = /* @__PURE__ */ new Map();
  constructor() {
    this.cspMode = this.detectCSP();
    if (typeof SharedArrayBuffer !== "undefined" && !HAS_DENO && !HAS_NODE && !this.cspMode) {
      this.initWorker();
    }
  }
  detectCSP() {
    try {
      new Function("return true")();
      return false;
    } catch (e) {
      console.info("[FX] CSP detected: unsafe-eval blocked. Using CSP-compatible mode.");
      return true;
    }
  }
  initWorker() {
    this.sab = new SharedArrayBuffer(2 * 1024 * 1024);
    this.lock = new Int32Array(this.sab, 0, 1);
    this.len = new Int32Array(this.sab, 4, 1);
    this.buf = new Uint8Array(this.sab, 8);
    const code = `
        const te = new TextEncoder();
        self.onmessage = async (e) => {
          const { id, url, sab } = e.data || {};
          const lock = new Int32Array(sab, 0, 1);
          const len  = new Int32Array(sab, 4, 1);
          const buf  = new Uint8Array(sab, 8);
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("HTTP " + res.status);
            const txt = await res.text();
            const enc = te.encode(txt);
            if (enc.length > buf.length) { Atomics.store(lock, 0, -id); Atomics.notify(lock, 0, 1); return; }
            buf.set(enc); len[0] = enc.length; Atomics.store(lock, 0, id);
          } catch(_e) { Atomics.store(lock, 0, -id); }
          Atomics.notify(lock, 0, 1);
        };
      `;
    if (typeof globalThis.Deno !== "undefined") {
      const dataUrl = `data:application/javascript,${encodeURIComponent(code)}`;
      this.worker = new Worker(dataUrl, { type: "module" });
    } else {
      this.worker = new Worker(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
    }
  }
  async fetchIntoCache(url, timeoutMs = this.TIMEOUT_MS) {
    if (!this.worker || !this.sab || !this.lock || !this.len || !this.buf) {
      if (IS_SERVER && (url.startsWith("./") || url.startsWith("/") || url.startsWith("../"))) {
        const filePath = url.startsWith("/") ? `.${url}` : url;
        try {
          let text3;
          if (HAS_DENO) {
            text3 = globalThis.Deno.readTextFileSync(filePath);
          } else {
            const { fs } = this.getNodeModules();
            text3 = fs.readFileSync(filePath, "utf8");
          }
          this.cache.set(url, text3);
          return text3;
        } catch (e) {
          throw new Error(`[FX] File not found: ${filePath}`);
        }
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`[FX] HTTP ${res.status} for ${url}`);
      const text2 = await res.text();
      this.cache.set(url, text2);
      return text2;
    }
    const id = Math.floor(Math.random() * 1e9);
    Atomics.store(this.lock, 0, 0);
    this.worker.postMessage({ id, url, sab: this.sab });
    if (isUIThread()) {
      const st = await uiFriendlyWait(this.lock, 0, 0, timeoutMs);
      if (st !== "ok") throw new Error("[FX] Module load timeout " + url);
    } else {
      const r = Atomics.wait(this.lock, 0, 0, timeoutMs);
      if (r === "timed-out") throw new Error("[FX] Module load timeout " + url);
    }
    const signal = Atomics.load(this.lock, 0);
    if (signal !== id) throw new Error("[FX] Worker error or buffer too small for " + url);
    const n = this.len[0];
    const text = new TextDecoder().decode(this.buf.subarray(0, n));
    Atomics.store(this.lock, 0, 0);
    this.cache.set(url, text);
    return text;
  }
  async loadAsync(url, timeoutMs = this.TIMEOUT_MS) {
    if (this.cache.has(url)) return this.cache.get(url);
    return await this.fetchIntoCache(url, timeoutMs);
  }
  // UI: never block — start fetch and SUSPEND; Proxy will replay. Worker/Node: safe blocking.
  loadSync(url) {
    if (this.cache.has(url)) return this.cache.get(url);
    if (this.cspMode) {
      console.warn(`[FX] CSP mode: Cannot load ${url} synchronously. Use async loading instead.`);
      return `/* FX_CSP_MODE: ${url} */
export default { __fx_csp_blocked: true, __fx_module_url: "${url}" };`;
    }
    if (isUIThread()) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, false);
        xhr.send();
        if (xhr.status === 200 || xhr.status === 0) {
          this.cache.set(url, xhr.responseText);
          return xhr.responseText;
        }
      } catch {
      }
      const p = this.fetchIntoCache(url).catch(() => {
      });
      throw new globalThis.FXSuspend(p);
    }
    if (IS_SERVER && (url.startsWith("./") || url.startsWith("/") || url.startsWith("../"))) {
      const filePath = url.startsWith("/") ? `.${url}` : url;
      try {
        let text;
        if (HAS_DENO) {
          text = globalThis.Deno.readTextFileSync(filePath);
        } else {
          const { fs } = this.getNodeModules();
          text = fs.readFileSync(filePath, "utf8");
        }
        this.cache.set(url, text);
        return text;
      } catch {
        throw new Error(`[FX] File not found: ${filePath}`);
      }
    }
    let got = "";
    (async () => {
      got = await this.fetchIntoCache(url);
    })();
    if (this.cache.has(url)) return this.cache.get(url);
    throw new Error("[FX] worker loadSync unexpected fallthrough");
  }
  // Add async loading method for CSP environments
  async loadModule(url) {
    if (IS_SERVER) {
      return import(url);
    } else {
      try {
        return await import(url);
      } catch (e) {
        return new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.type = "module";
          script.src = url;
          script.onload = () => resolve(null);
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
    }
  }
  // Add integrity checking for loaded modules
  setIntegrity(url, hash) {
    this.moduleIntegrity.set(url, hash);
  }
  getIntegrity(url) {
    return this.moduleIntegrity.get(url);
  }
};
var FXCore = class _FXCore {
  root;
  moduleLoader;
  // parent map for O(1) ancestry checks
  __parentMap = /* @__PURE__ */ new Map();
  // structure event bus (batched)
  __structureListeners = /* @__PURE__ */ new Set();
  __batchTimer = null;
  __batchedEvents = [];
  constructor() {
    this.root = this.createNode(null);
    this.moduleLoader = new SyncModuleLoader();
    this.ensureSystemRoots();
    this.installDefaults();
  }
  ensureSystemRoots() {
    const mk = (n) => {
      if (!this.root.__nodes[n]) {
        const c = this.createNode(this.root.__id);
        this.root.__nodes[n] = c;
        this.__parentMap.set(c.__id, this.root);
      }
    };
    ["app", "config", "plugins", "modules", "atomics", "dom", "session", "system", "cache", "code", "views", "fs", "history"].forEach(mk);
  }
  installDefaults() {
    const configNode = this.setPath("config.fx", {}, this.root);
    this.set(configNode, {
      selectors: {
        // attribute resolution order
        attrResolution: ["meta", "type", "raw", "child"],
        // allowed attribute operators
        enabledAttrOps: ["=", "!=", "^=", "$=", "*="],
        // enable :has()
        enableHas: false,
        // .class matches both __type and __proto
        classMatchesType: true
      },
      groups: {
        reactiveDefault: true,
        debounceMs: 20
      },
      performance: {
        enableParentMap: true,
        structureBatchMs: 5
      }
    });
  }
  onStructure(cb) {
    this.__structureListeners.add(cb);
    return () => this.__structureListeners.delete(cb);
  }
  emitStructure(e) {
    const ms = fxCfg("performance.structureBatchMs", 5);
    this.__batchedEvents.push(e);
    if (ms <= 0) return this.__flushStructure();
    if (this.__batchTimer) return;
    this.__batchTimer = setTimeout(() => this.__flushStructure(), ms);
  }
  __flushStructure() {
    const list = this.__batchedEvents.splice(0);
    clearTimeout(this.__batchTimer);
    this.__batchTimer = null;
    for (const ev of list) for (const cb of Array.from(this.__structureListeners)) {
      try {
        cb(ev);
      } catch {
      }
    }
  }
  createNode(parentId) {
    return {
      __id: nowId(),
      __parent_id: parentId,
      __nodes: /* @__PURE__ */ Object.create(null),
      __value: void 0,
      __type: null,
      // Fix #5: __proto is now Map<string, BehaviorTable>
      __proto: /* @__PURE__ */ new Map(),
      __effects: [],
      __watchers: /* @__PURE__ */ new Set()
    };
  }
  graftObject(host, obj) {
    for (const k of Object.keys(obj)) this.setPath(k, obj[k], host);
  }
  // Max depth for set → watcher → set reentry chains
  static MAX_SET_DEPTH = 10;
  __setDepth = 0;
  _finishSet(node, old) {
    if (this.__setDepth >= _FXCore.MAX_SET_DEPTH) {
      console.warn(`[FX] set() depth limit (${_FXCore.MAX_SET_DEPTH}) reached \u2014 breaking watcher chain on node ${node.__id}`);
      return;
    }
    this.__setDepth++;
    try {
      this.triggerEffects(node, "after.set", "__value", node.__value);
      node.__watchers.forEach((cb) => {
        try {
          cb(node.__value, old);
        } catch (e) {
          console.error(e);
        }
      });
      this.emitStructure({ kind: "mutate", node });
    } finally {
      this.__setDepth--;
    }
  }
  set(node, value) {
    const old = node.__value;
    this.triggerEffects(node, "before.set", "__value", value);
    if (value && typeof value === "object") {
      const maybe = value.node?.() ?? value;
      if (maybe?.__id && maybe.__nodes) {
        node.__type = "FXNode";
        node.__value = { raw: maybe, FXNode: maybe, string: `[FXNode ${maybe.__id}]`, boolean: true };
        return this._finishSet(node, old);
      }
    }
    if (value && typeof value === "object" && value.constructor?.name !== "Object") {
      const cname = value.constructor?.name ?? "Instance";
      node.__type = cname;
      node.__value = { [cname]: value, raw: value, string: safeJson(value), boolean: true };
      return this._finishSet(node, old);
    }
    if (value && typeof value === "object" && value.constructor?.name === "Object") {
      node.__type = "object";
      this.graftObject(node, value);
      node.__value = void 0;
      return this._finishSet(node, old);
    }
    const bag = { raw: value, num: toNumIfStr(value), string: String(value), boolean: Boolean(value) };
    node.__type = typeof bag.num === "number" && !Number.isNaN(bag.num) ? "num" : "raw";
    node.__value = bag;
    return this._finishSet(node, old);
  }
  /**
   * valStore: store the argument literally in __value[__type] without
   * grafting. Used by the proxy `.val(arg)` setter so a node can hold a
   * reference to another proxy or a plain JS object whose properties are
   * walked at read time.
   *
   * - Proxy   → __type = "node",   __value.node   = <proxy>
   * - Object  → __type = "object", __value.object = <object>  (NOT grafted)
   * - Else    → fall through to set() (scalar / class instance / FXNode).
   */
  valStore(node, value) {
    if (isProxy(value)) {
      const old = node.__value;
      this.triggerEffects(node, "before.set", "__value", value);
      const fxNode = value.node();
      node.__type = "node";
      node.__value = {
        raw: fxNode,
        node: value,
        string: `[FXNode ${fxNode.__id}]`,
        boolean: true
      };
      return this._finishSet(node, old);
    }
    if (value && typeof value === "object" && value.__id && value.__nodes) {
      return this.set(node, value);
    }
    if (value && typeof value === "object" && value.constructor?.name === "Object") {
      const old = node.__value;
      this.triggerEffects(node, "before.set", "__value", value);
      node.__type = "object";
      node.__value = {
        raw: value,
        object: value,
        string: safeJson(value),
        boolean: true
      };
      return this._finishSet(node, old);
    }
    return this.set(node, value);
  }
  /**
   * walkPath: navigate `keys` from `start`, preferring __value[__type]
   * over __nodes at every step.
   *
   * Returns one of:
   *   { kind: "node",  node }                             — landed on a real FXNode
   *   { kind: "value", value, ownerNode }                 — landed inside a JS object (read-only)
   *   { kind: "missing", lastNode, remaining }            — couldn't resolve and create=false
   *
   * Resolution rule (per Charl's spec):
   *   1. Look at cur.__value[__type]:
   *        - proxy/FXNode → delegate (continue from inner node, do not advance i)
   *        - plain object → walk into the object as far as possible
   *   2. Fall back to cur.__nodes[seg].
   *   3. With create=true, create the __nodes child if missing (write side).
   */
  walkPath(start, keys, opts = {}) {
    let cur = start;
    let i = 0;
    const guard = /* @__PURE__ */ new Set();
    while (i < keys.length) {
      const k = keys[i];
      const v = cur.__value;
      if (v && typeof v === "object" && cur.__type) {
        const bag = v[cur.__type];
        if (isProxy(bag)) {
          const inner = bag.node();
          const cycleKey = `${cur.__id}->${inner.__id}@${i}`;
          if (!guard.has(cycleKey)) {
            guard.add(cycleKey);
            cur = inner;
            continue;
          }
        }
        if (bag && typeof bag === "object" && bag.__id && bag.__nodes !== void 0 && bag !== v) {
          const inner = bag;
          const cycleKey = `${cur.__id}->${inner.__id}@${i}`;
          if (!guard.has(cycleKey)) {
            guard.add(cycleKey);
            cur = inner;
            continue;
          }
        }
        if (bag && typeof bag === "object" && bag.constructor?.name === "Object" && k in bag) {
          let obj = bag;
          let j = i;
          while (j < keys.length) {
            const k22 = keys[j];
            if (typeof obj !== "object" || obj === null) break;
            if (!(k22 in obj)) break;
            const next = obj[k22];
            if (j === keys.length - 1) {
              return { kind: "value", value: next, ownerNode: cur };
            }
            if (typeof next !== "object" || next === null) {
              break;
            }
            obj = next;
            j++;
          }
          return this._walkNodesOnly(cur, keys, i, opts);
        }
      }
      if (i === keys.length - 1 && cur.__type && cur.__proto?.has(cur.__type) && !cur.__nodes[k]) {
        const inst = cur.__proto.get(cur.__type);
        const member = inst?.[k];
        if (typeof member === "function") {
          return { kind: "value", value: member.bind(inst), ownerNode: cur };
        }
      }
      const k2 = keys[i];
      if (cur.__nodes[k2]) {
        cur = cur.__nodes[k2];
        i++;
        continue;
      }
      if (opts.create) {
        const created = this.createNode(cur.__id);
        cur.__nodes[k2] = created;
        this.__parentMap.set(created.__id, cur);
        this.emitStructure({ kind: "create", node: created, parent: cur, key: k2 });
        cur = created;
        i++;
        continue;
      }
      return { kind: "missing", lastNode: cur, remaining: keys.slice(i) };
    }
    return { kind: "node", node: cur };
  }
  val(node) {
    if (!node) {
      console.error("[FX] val() called with undefined/null node");
      console.trace();
      return void 0;
    }
    const v = node.__value;
    if (v == null) return v;
    if (typeof v === "object" && "raw" in v) {
      const t = node.__type;
      if (t && v[t] !== void 0) return v[t];
      return v.raw;
    }
    return v;
  }
  /**
   * linkTarget: if `node` is a pure LINK to another graph node — i.e. its
   * __value type-bag holds a node proxy (valStore, __type="node") or a raw
   * FXNode reference (set(), __type="FXNode") — return that target FXNode.
   * Otherwise return null.
   *
   * This is what makes grafted class METHODS resolve THROUGH a link:
   *   $$("dest", $$("src"));      // dest links to src
   *   $$("dest").fullname();      // get-trap delegates to src's proxy
   * Field reads already delegate via walkPath; this closes the method side.
   */
  linkTarget(node) {
    const v = node.__value;
    if (!v || typeof v !== "object") return null;
    const t = node.__type;
    if (!t) return null;
    const bag = v[t];
    if (!bag) return null;
    if (bag[FX_PROXY_MARKER] === true) {
      const inner = bag.node();
      return inner && inner !== node ? inner : null;
    }
    if (typeof bag === "object" && bag.__id && bag.__nodes !== void 0 && bag !== node) {
      return bag;
    }
    return null;
  }
  /**
   * Fix #4: Settle — reconstruct a plain JS object from a structural node's children.
   * Recursively walks __nodes and reads leaf values, producing a snapshot object.
   */
  settle(node) {
    const childKeys = Object.keys(node.__nodes);
    if (childKeys.length === 0) return this.val(node);
    const out = {};
    for (const k of childKeys) {
      const child = node.__nodes[k];
      const childValue = this.val(child);
      const grandKeys = Object.keys(child.__nodes);
      if (childValue == null && child.__type === "object" && grandKeys.length > 0) {
        out[k] = this.settle(child);
      } else if (grandKeys.length > 0 && childValue == null) {
        out[k] = this.settle(child);
      } else {
        out[k] = childValue;
      }
    }
    return out;
  }
  resolvePath(path, start) {
    const keys = path.split(".").filter(Boolean);
    let cur = start;
    for (const k of keys) {
      if (!cur) return;
      const v = this.val(cur);
      if (v?.__id) cur = v;
      if (!cur?.__nodes[k]) return;
      cur = cur.__nodes[k];
    }
    return cur;
  }
  setPath(path, value, start) {
    const keys = path.split(".").filter(Boolean);
    let cur = start;
    for (const k of keys) {
      if (!cur.__nodes[k]) {
        const created = this.createNode(cur.__id);
        cur.__nodes[k] = created;
        this.__parentMap.set(created.__id, cur);
        this.emitStructure({ kind: "create", node: created, parent: cur, key: k });
      }
      cur = cur.__nodes[k];
    }
    if (value !== void 0) this.set(cur, value);
    return cur;
  }
  /**
   * Inner helper: walk keys[fromIdx..end] using ONLY __nodes (no __value
   * lookup), creating children along the way when opts.create is true.
   * Used as the fallback path when walkPath's object-walk runs out: the full
   * remaining path materialises in __nodes mirroring the value-side path.
   */
  _walkNodesOnly(start, keys, fromIdx, opts) {
    let cur = start;
    for (let i = fromIdx; i < keys.length; i++) {
      const k = keys[i];
      if (cur.__nodes[k]) {
        cur = cur.__nodes[k];
        continue;
      }
      if (opts.create) {
        const created = this.createNode(cur.__id);
        cur.__nodes[k] = created;
        this.__parentMap.set(created.__id, cur);
        this.emitStructure({ kind: "create", node: created, parent: cur, key: k });
        cur = created;
        continue;
      }
      return { kind: "missing", lastNode: cur, remaining: keys.slice(i) };
    }
    return { kind: "node", node: cur };
  }
  findParentFast(n) {
    if (!fxCfg("performance.enableParentMap", true)) return null;
    return this.__parentMap.get(n.__id) || null;
  }
  triggerEffects(node, event, key, value) {
    const proxy = this.createNodeProxy(node);
    for (const eff of node.__effects) {
      try {
        eff(event, proxy, key, value);
      } catch (e) {
        console.error(e);
      }
    }
  }
  // #endregion fx::core
  // #region fx::proxy
  createNodeProxy(node) {
    const self2 = this;
    const isOpts = (o) => o && typeof o === "object" && "default" in o;
    const isEmpty = (v, opts) => {
      const rules = opts?.emptyAs ?? ["undefined", "null"];
      for (const r of rules) {
        if (r === "undefined" && v === void 0) return true;
        if (r === "null" && v === null) return true;
        if (r === "NaN" && typeof v === "number" && Number.isNaN(v)) return true;
        if (r === "" && v === "") return true;
        if (r === 0 && v === 0) return true;
        if (r === false && v === false) return true;
      }
      return false;
    };
    const cast = (v, opts) => {
      const c = opts?.cast;
      if (!c) return v;
      if (typeof c === "function") return c(v);
      switch (c) {
        case "number":
          return typeof v === "number" ? v : v === "" || v == null ? NaN : Number(v);
        case "string":
          return String(v);
        case "boolean":
          return Boolean(v);
        case "json":
          try {
            return typeof v === "string" ? JSON.parse(v) : v;
          } catch {
            return v;
          }
        default:
          return v;
      }
    };
    const ensureChild = (p, k, create) => {
      let c = p.__nodes[k];
      if (!c && create) c = self2.setPath(k, void 0, p);
      return c;
    };
    const baseFn = (path, value) => {
      if (Array.isArray(path)) {
        const R = (p) => baseFn(p);
        const mp = {
          __isMulti: true,
          paths: path,
          val(v) {
            if (v === void 0) return path.map((p) => R(p).val());
            path.forEach((p) => R(p).val(v));
            return mp;
          },
          set(v) {
            if (Array.isArray(v)) path.forEach((p, i) => R(p).set(v[i]));
            else path.forEach((p) => R(p).set(v));
            return mp;
          },
          get(child) {
            if (typeof child === "string") return baseFn(path.map((p) => `${p}.${child}`));
            return path.map((p) => R(p).get());
          },
          child(name) {
            return baseFn(path.map((p) => `${p}.${name}`));
          },
          proto(...a) {
            path.forEach((p) => R(p).proto(...a));
            return mp;
          },
          inherit(...a) {
            path.forEach((p) => R(p).inherit(...a));
            return mp;
          },
          watch(cb) {
            const u = path.map((p) => R(p).watch(cb));
            return () => u.forEach((f) => f());
          },
          node() {
            return path.map((p) => R(p).node());
          },
          nodes() {
            return path.map((p) => R(p));
          },
          each(fn) {
            path.forEach((p, i) => fn(R(p), i));
            return mp;
          }
        };
        if (value !== void 0) mp.val(value);
        return mp;
      }
      const keys = path.split(".").filter(Boolean);
      if (value !== void 0) {
        const r2 = self2.walkPath(node, keys, { create: true });
        if (r2.kind === "node") {
          const proxy3 = self2.createNodeProxy(r2.node);
          proxy3.val(value);
          return proxy3;
        }
        const target = self2.setPath(path, void 0, node);
        const proxy2 = self2.createNodeProxy(target);
        proxy2.val(value);
        return proxy2;
      }
      const r = self2.walkPath(node, keys, { create: true });
      if (r.kind === "node") return self2.createNodeProxy(r.node);
      if (r.kind === "value") {
        const phantom = self2.createNode(null);
        self2.set(phantom, r.value);
        phantom.__phantom = true;
        phantom.__phantomOwner = r.ownerNode;
        return self2.createNodeProxy(phantom);
      }
      return self2.createNodeProxy(node);
    };
    const builtViews = { str: "string", num: "num", bool: "boolean", raw: "raw" };
    const proxy = new Proxy(baseFn, {
      apply(_t, thisArg, args) {
        const v = self2.val(node);
        if (typeof v === "function") return v.apply(thisArg, args);
        return baseFn(args[0], args[1]);
      },
      get(_t, key, receiver) {
        if (key === FX_PROXY_MARKER) return true;
        if (typeof key === "symbol") return void 0;
        if (key === "val") {
          return function(a, b) {
            const setter = !(a && isOpts(a));
            if (setter && arguments.length >= 1) {
              const value = a, opts2 = b && isOpts(b) ? b : void 0;
              const toSet = isEmpty(value, opts2) ? opts2?.default : value;
              self2.valStore(node, cast(toSet, opts2));
              return receiver;
            }
            const opts = a && isOpts(a) ? a : void 0;
            let v = self2.val(node);
            if (isEmpty(v, opts)) v = opts?.default;
            return cast(v, opts);
          };
        }
        if (key === "set") {
          return (value, b, c) => {
            let child;
            let opts;
            if (typeof b === "string") {
              child = b;
              opts = isOpts(c) ? c : void 0;
            } else {
              opts = isOpts(b) ? b : void 0;
            }
            if (opts?.child && !child) child = opts.child;
            if (isProxy(value)) {
              const prev = node.__linkFrom;
              if (prev) try {
                prev.unwatch();
              } catch {
              }
              const fromNode = value.node();
              const unwatch = value.watch((_nv) => self2.set(node, self2.val(fromNode)));
              node.__linkFrom = { unwatch };
              self2.set(node, self2.val(fromNode));
              return receiver;
            }
            const toSet = isEmpty(value, opts) ? opts?.default : value;
            const cv = cast(toSet, opts);
            if (child) {
              const create = opts?.createIfMissing ?? true;
              const cnode = ensureChild(node, child, create);
              if (cnode) self2.set(cnode, cv);
              return receiver;
            }
            self2.set(node, cv);
            return receiver;
          };
        }
        if (key === "has") {
          return (path) => {
            if (!path) return true;
            const keys = path.split(".").filter(Boolean);
            const r = self2.walkPath(node, keys, { create: false });
            return r.kind !== "missing";
          };
        }
        if (key === "inherit") {
          return (...behaviors) => {
            for (const b of behaviors) {
              if (b?.name) {
                node.__proto.set(b.name, b);
                if (typeof b.effect === "function") node.__effects.push(b.effect);
              }
            }
            return receiver;
          };
        }
        if (key === "get") {
          return (a, b, c) => {
            let def = void 0, child, opts;
            if (typeof a === "string" && !isOpts(b)) {
              child = a;
              def = b;
              opts = isOpts(c) ? c : void 0;
            } else {
              def = a;
              if (typeof b === "string") child = b;
              opts = isOpts(b) ? b : isOpts(c) ? c : void 0;
            }
            if (opts && opts.default !== void 0 && def === void 0) def = opts.default;
            if (child) {
              const create = opts?.createIfMissing ?? true;
              const cnode = ensureChild(node, child, create);
              if (!cnode) return void 0;
              return self2.createNodeProxy(cnode);
            }
            let v;
            if (node.__grafted && Object.keys(node.__nodes).length > 0) {
              v = self2.settle(node);
            } else {
              v = self2.val(node);
              if (v == null && Object.keys(node.__nodes).length > 0) {
                v = self2.settle(node);
              }
            }
            if (isEmpty(v, opts)) v = def;
            return cast(v, opts);
          };
        }
        if (key === "node") return () => node;
        if (key === "proxy") return () => self2.createNodeProxy(node);
        if (key === "embed") return () => node;
        if (key === "onto") return (target) => {
          const t = typeof target === "string" ? $$(target) : target;
          if (t && typeof t.val === "function") t.val(node);
          return receiver;
        };
        if (key === "type") return (newType) => {
          if (newType !== void 0) {
            node.__type = newType;
            return receiver;
          }
          return node.__type;
        };
        if (key === "as") {
          return (ctorOrName) => {
            const name = typeof ctorOrName === "string" ? ctorOrName : typeof ctorOrName === "function" ? ctorOrName.name : ctorOrName?.constructor?.name;
            if (!name) return null;
            const bag0 = node.__value;
            if (bag0 && typeof bag0 === "object" && !Array.isArray(bag0) && bag0[name] !== void 0) {
              return bag0[name];
            }
            if (typeof ctorOrName === "string") {
              const raw = self2.val(node);
              if (raw && raw.constructor && raw.constructor.name === name) return raw;
              if (node.__proto.has(name)) {
                const behavior = node.__proto.get(name);
                return new Proxy({}, {
                  get(_t2, prop2) {
                    if (behavior && typeof behavior[prop2] === "function") {
                      return (...args) => behavior[prop2].call(receiver, ...args);
                    }
                    if (node.__nodes[prop2]) return self2.createNodeProxy(node.__nodes[prop2]);
                    return void 0;
                  }
                });
              }
              return null;
            }
            try {
              const isConstructor = typeof ctorOrName === "function" && ctorOrName.constructor === Function;
              const inst = isConstructor ? new ctorOrName() : ctorOrName;
              if (!inst || typeof inst !== "object" && typeof inst !== "function") return null;
              let vbag = node.__value;
              if (!vbag || typeof vbag !== "object" || Array.isArray(vbag)) {
                const prev = vbag;
                vbag = {};
                if (prev !== void 0 && prev !== null) vbag.raw = prev;
                node.__value = vbag;
              }
              vbag[name] = inst;
              node.__proto.set(name, inst);
              node.__type = name;
              node.__grafted = true;
              for (const k of Object.keys(inst)) {
                if (GRAFT_SKIP_KEYS.has(k)) continue;
                let val;
                try {
                  val = inst[k];
                } catch {
                  continue;
                }
                if (!isGraftableValue(val)) continue;
                let childNode = node.__nodes[k];
                if (!childNode) {
                  childNode = self2.setPath(k, void 0, node);
                  self2.set(childNode, val);
                } else {
                  const existing = self2.val(childNode);
                  if (existing === void 0 || existing === null) self2.set(childNode, val);
                }
                const desc = Object.getOwnPropertyDescriptor(inst, k);
                if (desc && desc.configurable === false) continue;
                const cn = childNode;
                try {
                  Object.defineProperty(inst, k, {
                    get() {
                      return self2.val(cn);
                    },
                    set(v) {
                      self2.set(cn, v);
                    },
                    enumerable: true,
                    configurable: true
                  });
                } catch {
                }
              }
              return inst;
            } catch (e) {
              console.warn(`[FX] .as(${name}) graft failed:`, e);
              return null;
            }
          };
        }
        if (key === "proto") return (a, b) => {
          if (a === void 0) return Array.from(node.__proto.keys());
          if (typeof a === "string" && b === void 0) return node.__proto.get(a);
          const inst = typeof a === "string" ? b : a;
          const name = typeof a === "string" ? a : a?.constructor?.name;
          if (!inst || !name) return receiver;
          receiver.as(inst);
          if (typeof a === "string" && a !== inst?.constructor?.name) {
            node.__proto.set(a, inst);
            if (node.__value && typeof node.__value === "object") node.__value[a] = inst;
          }
          return receiver;
        };
        if (key === "watch") return (cb) => {
          node.__watchers.add(cb);
          return () => node.__watchers.delete(cb);
        };
        if (key === "nodes") {
          return () => {
            const out = {};
            for (const ck in node.__nodes) out[ck] = self2.createNodeProxy(node.__nodes[ck]);
            return out;
          };
        }
        if (key in builtViews) return () => {
          const v = node.__value;
          if (v && typeof v === "object") return v[builtViews[key]];
          return v;
        };
        if (node.__proto?.has(key)) {
          const api = node.__proto.get(key);
          return new Proxy(api, {
            get(t, k) {
              const m = t[k];
              return typeof m === "function" ? m.bind(receiver) : m;
            }
          });
        }
        {
          const target = self2.linkTarget(node);
          if (target) {
            const tProto = target.__proto;
            const localEmpty = node.__nodes[key] && self2.val(node.__nodes[key]) == null && Object.keys(node.__nodes[key].__nodes).length === 0;
            const targetHasMember = tProto?.has(key) || target.__type && tProto?.has(target.__type) && typeof tProto.get(target.__type)?.[key] === "function" || target.__nodes[key] !== void 0;
            if (targetHasMember || localEmpty) {
              return self2.createNodeProxy(target)[key];
            }
          }
        }
        const cur = self2.val(node);
        if (cur?.__id) return self2.createNodeProxy(cur)[key];
        if (node.__nodes[key]) return self2.createNodeProxy(node.__nodes[key]);
        if (node.__type && node.__proto?.has(node.__type)) {
          const behavior = node.__proto.get(node.__type);
          const m = behavior && behavior[key];
          if (typeof m === "function") {
            return (...a) => m.apply(behavior, a);
          }
        }
        return baseFn[key];
      },
      // Fix #2: Proxy set trap — enables $$.a.b.c = "val" assignment syntax
      set(_t, key, value) {
        if (typeof key === "symbol") return false;
        let child = node.__nodes[key];
        if (!child) {
          child = self2.createNode(node.__id);
          node.__nodes[key] = child;
          self2.__parentMap.set(child.__id, node);
          self2.emitStructure({ kind: "create", node: child, parent: node, key });
        }
        if (isProxy(value)) {
          self2.valStore(child, value);
        } else {
          self2.set(child, value);
        }
        return true;
      }
    });
    return proxy;
  }
  proxy(path) {
    const root = this.createNodeProxy(this.root);
    return path ? root(path) : root;
  }
  // #endregion fx::proxy
};
var fx;
var fxCfg = (path, fallback) => {
  if (!fx || !fx.root) return fallback;
  const sysNode = fx.resolvePath(`system.fx.${path}`, fx.root);
  if (sysNode) {
    const sys = fx.val(sysNode);
    if (sys !== void 0) return sys;
  }
  const cfgNode = fx.resolvePath(`config.fx.${path}`, fx.root);
  if (cfgNode) {
    const cfg = fx.val(cfgNode);
    if (cfg !== void 0) return cfg;
  }
  return fallback;
};
function attachNamespaceToNode(fx2, node, ns, opts) {
  const typeName = opts.type;
  if (!node.__nodes) node.__nodes = /* @__PURE__ */ Object.create(null);
  const shape = ns?.default && typeof ns.default === "object" ? { ...ns.default, ...Object.fromEntries(Object.entries(ns).filter(([k]) => k !== "default")) } : ns;
  if (!node.__value || typeof node.__value !== "object" || !("raw" in node.__value)) {
    node.__value = { raw: node.__value, string: String(node.__value), boolean: Boolean(node.__value) };
  }
  const bag = node.__value;
  bag[typeName] ??= {};
  if (node.__type == null) node.__type = typeName;
  else if (node.__type !== typeName && !node.__proto.has(typeName)) node.__proto.set(typeName, {});
  const attachFnToNode = (k, fn) => {
    const sub = node.__nodes[k] || (node.__nodes[k] = fx2.createNode(node.__id));
    sub.__value = (...a) => fn(...a);
    prop(node, k, (...a) => fn(...a));
  };
  const attachValToNode = (k, v) => {
    const sub = node.__nodes[k] || (node.__nodes[k] = fx2.createNode(node.__id));
    sub.__value = v;
    Object.defineProperty(node, k, { configurable: true, enumerable: false, get: () => v });
  };
  const attachIntoTypeSurface = (k, v) => {
    const surface = bag[typeName];
    if (typeof v === "function") surface[k] = v.bind(surface);
    else surface[k] = v;
  };
  const onConflict = opts.onConflict ?? "warn-and-namespace";
  const allowMixin = (k) => {
    if (node.__nodes[k]) {
      if (onConflict === "overwrite") return true;
      if (onConflict === "warn-and-namespace") {
        if (k !== "default") {
          console.warn(`[FX] Mixin conflict on '${k}' (type '${typeName}'); preserving existing; available via .val().${typeName}.${k}`);
        }
        return false;
      }
      return false;
    }
    return true;
  };
  for (const [k, v] of Object.entries(shape)) {
    attachIntoTypeSurface(k, v);
    if (opts.mode !== "type-only") {
      if (typeof v === "function") {
        if (allowMixin(k)) attachFnToNode(k, v);
      } else {
        if (!node.__nodes[k]) attachValToNode(k, v);
      }
    }
  }
  Object.defineProperty(node, typeName, {
    configurable: true,
    enumerable: false,
    get: () => node.__value[typeName]
  });
}
var toHeaders = (h) => {
  const out = new Headers();
  for (const k in h) out.set(k, h[k]);
  return out;
};
var deserialize = (x) => typeof x === "string" ? (() => {
  try {
    return JSON.parse(x);
  } catch {
    return x;
  }
})() : x;
function serverFetch(url, method, headers, body) {
  return fetch(url, {
    method,
    headers,
    body: body == null ? void 0 : typeof body === "string" || body instanceof Blob ? body : JSON.stringify(body)
  });
}
function FutureProxy(fx2, promise, opts = {}) {
  const { targetNode, globalName, onResolve } = opts;
  const state = { resolved: false, value: void 0, error: void 0 };
  promise.then((v) => {
    state.resolved = true;
    state.value = v;
    if (targetNode) fx2.set(targetNode, v);
    if (globalName) globalThis[globalName] = v;
    onResolve?.(v);
  }).catch((e) => {
    state.resolved = true;
    state.error = e;
    if (targetNode) fx2.set(targetNode, { error: String(e) });
  });
  const handler = {
    get(_t, prop2) {
      if (prop2 === "then") return (cb) => {
        !state.resolved ? promise.then(cb) : cb(state.value);
      };
      if (prop2 === "await") return () => promise;
      if (!state.resolved) return void 0;
      const v = state.value, out = v?.[prop2];
      return typeof out === "function" ? out.bind(v) : out;
    },
    apply(_t, _this, args) {
      if (!state.resolved) throw new Error("Future not resolved yet");
      if (typeof state.value === "function") return state.value(...args);
      throw new Error("Resolved value is not callable");
    }
  };
  const callable = function(...args) {
    if (!state.resolved) throw new Error("Future not resolved yet");
    if (typeof state.value === "function") return state.value(...args);
    return state.value;
  };
  return new Proxy(callable, handler);
}
function syncBrowserHttp(url, method, headers, body) {
  const xhr = new XMLHttpRequest();
  xhr.open(
    method,
    url,
    false
    /* synchronous */
  );
  const bodyString = body == null ? void 0 : typeof body === "string" ? body : JSON.stringify(body);
  const effectiveHeaders = { ...headers };
  const hasContentType = Object.keys(effectiveHeaders).some((h) => h.toLowerCase() === "content-type");
  if (bodyString !== void 0 && typeof body !== "string" && !hasContentType) {
    effectiveHeaders["Content-Type"] = "application/json";
  }
  for (const key in effectiveHeaders) {
    xhr.setRequestHeader(key, effectiveHeaders[key]);
  }
  xhr.send(bodyString);
  const responseContentType = xhr.getResponseHeader("content-type") || "";
  if (responseContentType.includes("application/json")) {
    try {
      return JSON.parse(xhr.responseText);
    } catch {
      return xhr.responseText;
    }
  }
  return deserialize(xhr.responseText);
}
function httpCall(url, method, args, fx2, node, forcedGlobal) {
  const { headers = {}, body, global } = args || {};
  const g = forcedGlobal || global;
  if (IS_SERVER) {
    const p2 = serverFetch(url, method, headers, body).then(async (r) => {
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("application/json")) return r.json();
      return r.text();
    }).then(deserialize);
    return FutureProxy(fx2, p2, { targetNode: node, globalName: g });
  }
  const sameOrigin = isRel(url) ? url : `/fx/proxy?url=${encodeURIComponent(url)}`;
  if (typeof XMLHttpRequest !== "undefined") {
    const memoKey = httpMemoActive > 0 ? `${method} ${url} ${body == null ? "" : typeof body === "string" ? body : JSON.stringify(body)}` : "";
    const apply = (value2) => {
      if (node) fx2.set(node, value2);
      if (g) globalThis[g] = value2;
      return value2;
    };
    if (memoKey && httpMemo.has(memoKey)) return apply(httpMemo.get(memoKey));
    const value = syncBrowserHttp(sameOrigin, method, headers, body);
    if (memoKey) httpMemo.set(memoKey, value);
    return apply(value);
  }
  const p = fetch(sameOrigin, {
    method,
    headers: toHeaders(headers),
    body: body == null ? void 0 : typeof body === "string" || body instanceof Blob ? body : JSON.stringify(body)
  }).then(async (r) => {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) return r.json();
    return r.text();
  }).then(deserialize);
  return FutureProxy(fx2, p, { targetNode: node, globalName: g });
}
function stripTypeScript(src) {
  const lines = src.split("\n");
  const result = [];
  let skipDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (skipDepth > 0) {
      skipDepth += (trimmed.match(/\{/g) || []).length;
      skipDepth -= (trimmed.match(/\}/g) || []).length;
      result.push("");
      continue;
    }
    if (/^(export\s+)?interface\s+/.test(trimmed)) {
      if (trimmed.includes("{")) {
        skipDepth = (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;
      }
      result.push("");
      continue;
    }
    if (/^(export\s+)?type\s+\w+/.test(trimmed) && !/^typeof\b/.test(trimmed)) {
      if (trimmed.includes("{") && !trimmed.includes("}")) {
        skipDepth = 1;
      }
      result.push("");
      continue;
    }
    if (/^(export\s+)?enum\s+/.test(trimmed)) {
      if (trimmed.includes("{") && !trimmed.includes("}")) {
        skipDepth = 1;
      }
      result.push("");
      continue;
    }
    if (/^declare\s+/.test(trimmed)) {
      result.push("");
      continue;
    }
    let cleaned = line;
    cleaned = cleaned.replace(/\b(private|protected|public|readonly)\s+/g, "");
    cleaned = cleaned.replace(/(\w)\?\s*:/g, "$1:");
    cleaned = cleaned.replace(/(\w)\s*:\s*(?:string|number|boolean|any|void|never|unknown|null|undefined|object|symbol|bigint|Record|Map|Set|Array|Promise|Function|Partial|Required|Readonly|Pick|Omit|Exclude|Extract|NonNullable|ReturnType|InstanceType|Parameters|ConstructorParameters)[\w<>\[\]|&?,\s]*/g, "$1");
    cleaned = cleaned.replace(/\)\s*:\s*[\w<>\[\]|&?,\s]+\s*(\{|=>)/g, ") $1");
    cleaned = cleaned.replace(/(const|let|var)\s+(\w+)\s*:\s*[\w<>\[\]|&?,\s]+\s*=/g, "$1 $2 =");
    cleaned = cleaned.replace(/(\w)<[\w\s,|&\[\]?:='"]+>\s*\(/g, "$1(");
    cleaned = cleaned.replace(/(new\s+\w+)<[\w\s,|&\[\]?:='"]+>\s*\(/g, "$1(");
    cleaned = cleaned.replace(/\s+as\s+[\w<>\[\]|&]+/g, "");
    cleaned = cleaned.replace(/(\w)!\./g, "$1.");
    cleaned = cleaned.replace(/(\w)!\s*([;,\)}\]])/g, "$1$2");
    cleaned = cleaned.replace(/catch\s*\(\s*(\w+)\s*:\s*\w+\s*\)/g, "catch ($1)");
    result.push(cleaned);
  }
  return result.join("\n");
}
function transformModuleExports(code) {
  const declNames = [];
  const listBindings = [];
  let out = code;
  out = out.replace(
    /(?<![_\w])export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"][^'"]+['"];?/g,
    (m) => {
      console.warn(`[FX] transformModuleExports: skipping unsupported re-export (use async import): ${m.trim()}`);
      return `/* [FX] skipped re-export: ${m.trim().replace(/\*\//g, "* /")} */`;
    }
  );
  out = out.replace(
    /(?<![_\w])export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/g,
    (m) => {
      console.warn(`[FX] transformModuleExports: skipping unsupported re-export (use async import): ${m.trim()}`);
      return `/* [FX] skipped re-export: ${m.trim().replace(/\*\//g, "* /")} */`;
    }
  );
  out = out.replace(
    /(?<![_\w])export\s+default\s+(async\s+)?(function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g,
    (_m, asyncKw = "", kind, name) => {
      declNames.push(name);
      listBindings.push({ exported: "default", local: name });
      return `${asyncKw}${kind} ${name}`;
    }
  );
  out = out.replace(/(?<![_\w])export\s+default\s+/g, "module.exports.default = ");
  out = out.replace(
    /(?<![_\w])export\s+((?:async\s+)?function\s*\*?)\s+([A-Za-z_$][\w$]*)/g,
    (_m, fnKw, name) => {
      declNames.push(name);
      return `${fnKw} ${name}`;
    }
  );
  out = out.replace(
    /(?<![_\w])export\s+(class)\s+([A-Za-z_$][\w$]*)/g,
    (_m, kw, name) => {
      declNames.push(name);
      return `${kw} ${name}`;
    }
  );
  out = out.replace(
    /(?<![_\w])export\s+(const|let|var)\s+([^\n;]+?)(;|$)/gm,
    (_m, kw, decls, tail) => {
      for (const name of collectDeclaratorNames(decls)) declNames.push(name);
      return `${kw} ${decls}${tail}`;
    }
  );
  out = out.replace(
    /(?<![_\w])export\s*\{([^}]*)\}\s*;?/g,
    (_m, body) => {
      for (const raw of body.split(",")) {
        const part = raw.trim();
        if (!part) continue;
        const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part);
        if (asMatch) {
          listBindings.push({ exported: asMatch[2], local: asMatch[1] });
        } else if (/^[A-Za-z_$][\w$]*$/.test(part)) {
          listBindings.push({ exported: part, local: part });
        }
      }
      return "";
    }
  );
  const tailParts = [];
  for (const name of declNames) {
    tailParts.push(`
;try{module.exports.${name} = ${name};}catch(_){}`);
  }
  for (const { exported, local } of listBindings) {
    tailParts.push(`
;try{module.exports[${JSON.stringify(exported)}] = ${local};}catch(_){}`);
  }
  return out + tailParts.join("");
}
function collectDeclaratorNames(decls) {
  const names = [];
  let depth = 0;
  let current = "";
  const flush = () => {
    const declarator = current.trim();
    current = "";
    if (!declarator) return;
    const target = declarator.split("=")[0].trim();
    const idMatch = /^([A-Za-z_$][\w$]*)$/.exec(target);
    if (idMatch) names.push(idMatch[1]);
  };
  for (let i = 0; i < decls.length; i++) {
    const ch = decls[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return names;
}
function exposeNamedExports(ns) {
  if (!ns || typeof ns !== "object") return;
  const hasDefault = Object.prototype.hasOwnProperty.call(ns, "default");
  const def = hasDefault ? ns.default : void 0;
  const defIsMergeTarget = def !== null && (typeof def === "object" || typeof def === "function");
  if (defIsMergeTarget) {
    for (const [k, v] of Object.entries(ns)) {
      if (k === "default") continue;
      if (k in def) continue;
      try {
        def[k] = v;
      } catch {
      }
    }
    try {
      prop(def, "ns", ns);
    } catch {
    }
  }
  if (!Object.prototype.hasOwnProperty.call(ns, "ns")) {
    try {
      prop(ns, "ns", ns);
    } catch {
    }
  }
}
var atBindingCache = /* @__PURE__ */ new Map();
function buildAtBinding(fx2, baseNode, spec) {
  const cacheKey = `${baseNode.__id}@${spec}`;
  if (atBindingCache.has(cacheKey)) {
    return atBindingCache.get(cacheKey);
  }
  if (/\.(html?|txt|md|css|svg|xml)$/i.test(spec)) {
    try {
      const text = fx2.moduleLoader.loadSync(spec);
      atBindingCache.set(cacheKey, text);
      return text;
    } catch (e) {
      if (e?.tag === "FX:SUSPEND") throw e;
      console.warn(`[FX] @-load failed for text asset "${spec}":`, e);
      return "";
    }
  }
  const isModuleFile = /\.(m?js|tsx?|jsx)$/i.test(spec);
  const isApi = !isModuleFile && (isHttp(spec) || isRel(spec));
  const ctx = { node: baseNode, ns: void 0, opts: {}, loaded: false };
  function options(o) {
    ctx.opts = { ...ctx.opts, ...o };
    if (!ctx.loaded && !isApi) {
      loadModuleSync(spec);
    }
    return api;
  }
  function loadModuleSync(url) {
    if (ctx.loaded) return;
    let code;
    try {
      if (IS_SERVER && url.endsWith(".ts")) {
        const jsUrl = url.replace(/\.ts$/, ".js");
        try {
          code = fx2.moduleLoader.loadSync(jsUrl);
        } catch {
          code = fx2.moduleLoader.loadSync(url);
        }
      } else {
        code = fx2.moduleLoader.loadSync(url);
      }
    } catch (e) {
      if (e?.tag === "FX:SUSPEND") {
        throw e;
      }
      console.warn(`[FX] Failed to load module text for "${url}":`, e.message);
      ctx.loaded = true;
      ctx.ns = { default: null };
      return;
    }
    let jsCode = code;
    const looksLikeTS = code.includes("interface ") || code.includes(": string") || code.includes(": number") || code.includes("import type");
    const looksLikeCJS = code.includes("__toCommonJS") || code.includes("__defProp");
    if (IS_SERVER && looksLikeTS && !looksLikeCJS) {
      jsCode = stripTypeScript(code);
    }
    const isCJS = jsCode.includes("__toCommonJS") || jsCode.includes("module.exports") && !jsCode.includes("import ");
    const clientCode = isCJS ? jsCode : transformModuleExports(
      jsCode.replace(/^import\s+type\s+\{[^}]*\}\s+from\s+.*$/gm, "").replace(/^import\s+type\s+.*$/gm, "").replace(/^import\s+\{[^}]*\}\s+from\s+['"].*['"];?\s*$/gm, "").replace(/^import\s+\*\s+as\s+\w+\s+from\s+['"].*['"];?\s*$/gm, "").replace(/^import\s+\w+\s+from\s+['"].*['"];?\s*$/gm, "").replace(/^import\s+['"].*['"];?\s*$/gm, "")
    );
    const module = { exports: {} };
    const exports = module.exports;
    const requireShim = (id) => {
      if (HAS_DENO) {
        try {
          const { createRequire } = globalThis.Deno?.internal?.node || {};
          if (createRequire) return createRequire(import.meta.url)(id);
        } catch {
        }
        return {};
      }
      if (HAS_NODE) {
        return globalThis.require(id);
      }
      return {};
    };
    const sourceUrl = "fx://" + String(url).replace(/^@/, "").replace(/^\.?\//, "");
    const taggedCode = clientCode + "\n//# sourceURL=" + sourceUrl;
    try {
      const fn = new Function("module", "exports", "fx", "require", taggedCode);
      fn.call(exports, module, exports, fx2, requireShim);
    } catch (e) {
      if (e.message && e.message.includes("unsafe-eval")) {
        console.warn(`[FX] CSP blocks new Function for "${url}". Module loading disabled in strict CSP mode.`);
        ctx.ns = {
          default: null,
          __fx_csp_blocked: true,
          __fx_module_url: url,
          loadAsync: () => import(url)
        };
      } else {
        if (!ctx.loaded) {
          console.error(`[FX] Error executing module code for "${url}". Check for syntax errors.`, e);
        }
        ctx.ns = ctx.ns || { default: null };
      }
      ctx.loaded = true;
      return;
    }
    if (ctx.opts?.instantiateDefault) {
      const d = module.exports.default;
      const isClass = typeof d === "function" && /^class\s/.test(Function.prototype.toString.call(d));
      if (isClass) {
        const args = typeof ctx.opts.instantiateDefault === "object" ? ctx.opts.instantiateDefault.args ?? [] : [];
        module.exports.default = new d(...args);
      }
    }
    ctx.ns = module.exports;
    exposeNamedExports(ctx.ns);
    let instance = ctx.ns.default ?? ctx.ns;
    const shouldInvokeFactory = typeof instance === "function" && (ctx.opts?.type === "plugin" || !!ctx.opts?.global);
    if (shouldInvokeFactory) {
      const isClass = /^class\s/.test(Function.prototype.toString.call(instance));
      try {
        instance = isClass ? new instance(fx2, ctx.opts) : instance(fx2, ctx.opts);
      } catch (e) {
        console.warn(`[FX] Plugin factory threw for "${spec}":`, e);
      }
    }
    attachNamespaceToNode(fx2, ctx.node, ctx.ns, { type: ctx.opts?.type || "module", ...ctx.opts });
    if (ctx.opts?.global) {
      globalThis[ctx.opts.global] = instance;
    }
    ctx.loaded = true;
  }
  function exportsProxy() {
    const handler = {
      get(_t, prop2) {
        if (prop2 === "options") return options;
        invokeWithSuspendReplay(() => {
          if (!ctx.loaded && !isApi) {
            loadModuleSync(spec);
          }
        }, null, []);
        if (isApi && typeof prop2 === "string" && ["get", "post", "put", "patch", "delete", "fetch"].includes(prop2)) {
          const meth = prop2 === "fetch" ? "GET" : prop2.toUpperCase();
          if (ctx.node?.__nodes[prop2]) return fx2.createNodeProxy(ctx.node.__nodes[prop2]);
          return (args) => httpCall(spec, meth, args, fx2, ctx.node, ctx.opts.global);
        }
        const val = (ctx.ns?.default && ctx.ns.default[prop2]) ?? ctx.ns?.[prop2];
        if (typeof val === "function") {
          return new Proxy(val, {
            apply(target, thisArg, argArray) {
              return invokeWithSuspendReplay(target, ctx.ns.default ?? ctx.ns, argArray ?? []);
            }
          });
        }
        return val;
      },
      apply(_t, _this, args) {
        invokeWithSuspendReplay(() => {
          if (!ctx.loaded && !isApi) {
            loadModuleSync(spec);
          }
        }, null, []);
        const d = ctx.ns?.default;
        if (typeof d === "function") {
          return invokeWithSuspendReplay(d, ctx.ns.default ?? ctx.ns, args ?? []);
        }
        throw new Error("Default export is not callable.");
      }
    };
    const callable = function(...args) {
      invokeWithSuspendReplay(() => {
        if (!ctx.loaded && !isApi) {
          loadModuleSync(spec);
        }
      }, null, []);
      const d = ctx.ns?.default;
      if (typeof d === "function") return d(...args);
      throw new Error("Default export is not callable.");
    };
    return new Proxy(callable, handler);
  }
  function fetchApi(url) {
    const callable = {};
    callable.fetch = (args) => httpCall(url, "GET", args, fx2, ctx.node, ctx.opts.global);
    callable.get = (args) => ctx.node?.__nodes["get"] ? fx2.createNodeProxy(ctx.node.__nodes["get"]) : httpCall(url, "GET", args, fx2, ctx.node, ctx.opts.global);
    callable.post = (args) => ctx.node?.__nodes["post"] ? fx2.createNodeProxy(ctx.node.__nodes["post"]) : httpCall(url, "POST", args, fx2, ctx.node, ctx.opts.global);
    callable.put = (args) => ctx.node?.__nodes["put"] ? fx2.createNodeProxy(ctx.node.__nodes["put"]) : httpCall(url, "PUT", args, fx2, ctx.node, ctx.opts.global);
    callable.patch = (args) => ctx.node?.__nodes["patch"] ? fx2.createNodeProxy(ctx.node.__nodes["patch"]) : httpCall(url, "PATCH", args, fx2, ctx.node, ctx.opts.global);
    callable.delete = (args) => ctx.node?.__nodes["delete"] ? fx2.createNodeProxy(ctx.node.__nodes["delete"]) : httpCall(url, "DELETE", args, fx2, ctx.node, ctx.opts.global);
    callable.options = options;
    return callable;
  }
  const api = isApi ? fetchApi(spec) : exportsProxy();
  api.options = options;
  atBindingCache.set(cacheKey, api);
  return api;
}
function patchDollarAtSyntax(fx2) {
  const original = fx2.proxy();
  const baseDollar = (path, value) => {
    if (path.includes("@")) {
      const parts = path.split("@");
      const nodePath = parts[0];
      const spec = parts.slice(1).join("@");
      const node = nodePath ? fx2.setPath(nodePath, void 0, fx2.root) : fx2.root;
      return buildAtBinding(fx2, node, spec);
    }
    return original(path, value);
  };
  const dollar = new Proxy(baseDollar, {
    apply(_t, _this, args) {
      return invokeWithSuspendReplay(baseDollar, _this, args);
    },
    get(_t, key, receiver) {
      try {
        const val = Reflect.get(baseDollar, key, receiver);
        if (typeof val === "function") {
          return new Proxy(val, {
            apply(target, thisArg, argArray) {
              return invokeWithSuspendReplay(target, thisArg, argArray ?? []);
            }
          });
        }
        return val;
      } catch (e) {
        if (e?.tag === "FX:SUSPEND") {
          const suspend = e;
          return new Proxy(function() {
          }, {
            get() {
              throw suspend;
            },
            apply() {
              throw suspend;
            },
            construct() {
              throw suspend;
            }
          });
        }
        throw e;
      }
    }
  });
  globalThis.$$ = dollar;
  return dollar;
}
function isFXNode(x) {
  return x && typeof x === "function" && typeof x.node === "function";
}
var fragmentCleanups = /* @__PURE__ */ new WeakMap();
function disposeFragmentCleanups(el, store, warn) {
  const prev = store.get(el);
  if (!prev) return;
  store.delete(el);
  for (const dispose of prev) {
    try {
      dispose();
    } catch (e) {
      warn("[fx-dom-dollar] fragment cleanup threw:", e);
    }
  }
}
function replaceHtmlLifecycle(el, html, deps = {}) {
  const store = deps.cleanupStore ?? fragmentCleanups;
  const warn = deps.warn ?? ((...args) => console.warn(...args));
  const hydrate = deps.hydrate !== void 0 ? deps.hydrate : globalThis.$fxc?.hydrate?.bind(globalThis.$fxc) ?? null;
  disposeFragmentCleanups(el, store, warn);
  el.innerHTML = html;
  if (typeof hydrate === "function") {
    try {
      const cleanups = hydrate(el);
      if (Array.isArray(cleanups) && cleanups.length) store.set(el, cleanups);
    } catch (e) {
      warn("[fx-dom-dollar] $fxc.hydrate failed after .html() replace:", e);
    }
  }
}
function applyOpMap($, opMap) {
  if (!opMap || typeof opMap !== "object") return;
  for (const selector of Object.keys(opMap)) {
    const handle = $(selector);
    if (!handle) continue;
    const methods = opMap[selector];
    if (!methods || typeof methods !== "object") continue;
    for (const methodName of Object.keys(methods)) {
      const fn = handle[methodName];
      if (typeof fn !== "function") continue;
      const arg = methods[methodName];
      if (Array.isArray(arg)) fn.apply(handle, arg);
      else fn.call(handle, arg);
    }
  }
}
var UNITLESS = /* @__PURE__ */ new Set([
  "opacity",
  "z-index",
  "zIndex",
  "flex",
  "flex-grow",
  "flexGrow",
  "flex-shrink",
  "flexShrink",
  "order",
  "orphans",
  "widows",
  "font-weight",
  "fontWeight",
  "line-height",
  "lineHeight",
  "tab-size",
  "tabSize",
  "columns",
  "column-count",
  "columnCount",
  "fill-opacity",
  "fillOpacity",
  "stroke-opacity",
  "strokeOpacity",
  "stroke-miterlimit",
  "strokeMiterlimit"
]);
function needsUnit(prop2) {
  return !UNITLESS.has(prop2);
}
function autoPath(el) {
  if (el.id) return `#${el.id}`;
  const parts = [];
  let cur = el;
  while (cur && cur !== document.body) {
    let part = cur.tagName.toLowerCase();
    const parentEl = cur.parentElement;
    if (parentEl) {
      const idx = Array.from(parentEl.children).indexOf(cur);
      part += `:${idx}`;
    }
    parts.unshift(part);
    cur = parentEl;
  }
  return parts.join(".");
}
function domDollarPlugin(_fx) {
  const elToPath = /* @__PURE__ */ new WeakMap();
  const mounted = /* @__PURE__ */ new WeakSet();
  function mount(el) {
    if (!mounted.has(el)) {
      const path = "dom." + autoPath(el);
      elToPath.set(el, path);
      mounted.add(el);
      globalThis.$$(path).set(el);
      globalThis.$$(path).inherit(DomBehavior);
    }
    const p = elToPath.get(el);
    return globalThis.$$(p);
  }
  function applyReactive(valueOrNode, apply2) {
    if (isFXNode(valueOrNode)) {
      const src = valueOrNode;
      const push = () => apply2(src.get());
      push();
      src.watch(() => push());
    } else {
      apply2(valueOrNode);
    }
  }
  const DomBehavior = {
    name: "dom",
    css(prop2, v) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      const setOne = (k, vv) => applyReactive(vv, (nv) => {
        const val = typeof nv === "number" && needsUnit(k) ? `${nv}px` : String(nv);
        if (k.startsWith("--")) el.style.setProperty(k, val);
        else el.style[k] = val;
      });
      if (typeof prop2 === "string") {
        if (v === void 0) return getComputedStyle(el).getPropertyValue(prop2);
        setOne(prop2, v);
      } else {
        for (const [k, vv] of Object.entries(prop2)) setOne(k, vv);
      }
      return this;
    },
    attr(name, v) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      const setOne = (k, vv) => applyReactive(vv, (nv) => el.setAttribute(k, String(nv ?? "")));
      if (typeof name === "string") {
        if (v === void 0) return el.getAttribute(name);
        setOne(name, v);
      } else {
        for (const [k, vv] of Object.entries(name)) setOne(k, vv);
      }
      return this;
    },
    text(v) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return v === void 0 ? void 0 : this;
      if (v === void 0) return el.textContent || "";
      applyReactive(v, (nv) => {
        el.textContent = String(nv ?? "");
      });
      return this;
    },
    html(v) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return v === void 0 ? void 0 : this;
      if (v === void 0) return el.innerHTML;
      applyReactive(v, (nv) => {
        replaceHtmlLifecycle(el, String(nv ?? ""));
      });
      return this;
    },
    append(v) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      if (v === void 0) return this;
      applyReactive(v, (nv) => {
        el.insertAdjacentHTML("beforeend", String(nv ?? ""));
        try {
          globalThis.$fxc?.processImports?.(el);
        } catch {
        }
      });
      return this;
    },
    val(v) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return v === void 0 ? void 0 : this;
      if (v === void 0) {
        if (el instanceof HTMLInputElement) {
          return el.type === "checkbox" ? !!el.checked : el.value;
        }
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          return el.value;
        }
        return el.textContent ?? "";
      }
      applyReactive(v, (nv) => {
        if (el instanceof HTMLInputElement) {
          if (el.type === "checkbox") el.checked = !!nv;
          else el.value = nv ?? "";
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          el.value = nv ?? "";
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          el.textContent = nv == null ? "" : String(nv);
        }
      });
      return this;
    },
    addClass(...names) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      names.flatMap((n) => n.split(/\s+/)).filter(Boolean).forEach((c) => el.classList.add(c));
      return this;
    },
    removeClass(...names) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      names.flatMap((n) => n.split(/\s+/)).filter(Boolean).forEach((c) => el.classList.remove(c));
      return this;
    },
    toggleClass(name, state) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      el.classList.toggle(name, state ?? !el.classList.contains(name));
      return this;
    },
    on(evt, selectorOrHandler, handlerOrOpts, opts) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      let selector = null;
      let handler;
      let options;
      if (typeof selectorOrHandler === "string") {
        selector = selectorOrHandler;
        handler = handlerOrOpts;
        options = opts;
      } else {
        handler = selectorOrHandler;
        options = handlerOrOpts;
      }
      evt.split(/\s+/).forEach((e) => {
        if (selector) {
          const delegated = function(ev) {
            const target = ev.target?.closest?.(selector);
            if (target && el.contains(target)) handler.call(target, ev);
          };
          el.addEventListener(e, delegated, options);
        } else {
          el.addEventListener(e, handler, options);
        }
      });
      return this;
    },
    off(evt, handler) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      evt.split(/\s+/).forEach((e) => handler ? el.removeEventListener(e, handler) : null);
      return this;
    },
    trigger(evt, detail) {
      const el = this.get();
      if (!(el instanceof HTMLElement)) return this;
      el.dispatchEvent(new CustomEvent(evt, { bubbles: true, cancelable: true, detail }));
      return this;
    }
  };
  function makeHandle(el) {
    const h = {
      el,
      // Value-ish — setters return h for chaining, getters return the value
      val(v) {
        const n = mount(el);
        const r = DomBehavior.val.call(n, v);
        return v !== void 0 ? h : r;
      },
      text(v) {
        const n = mount(el);
        const r = DomBehavior.text.call(n, v);
        return v !== void 0 ? h : r;
      },
      html(v) {
        const n = mount(el);
        const r = DomBehavior.html.call(n, v);
        return v !== void 0 ? h : r;
      },
      append(v) {
        DomBehavior.append.call(mount(el), v);
        return h;
      },
      // Attributes / CSS
      attr(name, v) {
        const n = mount(el);
        const r = DomBehavior.attr.call(n, name, v);
        return typeof name === "object" || v !== void 0 ? h : r;
      },
      css(prop2, v) {
        const n = mount(el);
        const r = DomBehavior.css.call(n, prop2, v);
        return typeof prop2 === "object" || v !== void 0 ? h : r;
      },
      // Classes
      addClass(...names) {
        DomBehavior.addClass.call(mount(el), ...names);
        return h;
      },
      removeClass(...names) {
        DomBehavior.removeClass.call(mount(el), ...names);
        return h;
      },
      toggleClass(name, state) {
        DomBehavior.toggleClass.call(mount(el), name, state);
        return h;
      },
      hasClass(name) {
        const n = mount(el);
        const _el = n.get();
        return _el.classList.contains(name);
      },
      // Events
      on(evt, selectorOrHandler, handlerOrOpts, opts) {
        DomBehavior.on.call(mount(el), evt, selectorOrHandler, handlerOrOpts, opts);
        return h;
      },
      off(evt, handler) {
        DomBehavior.off.call(mount(el), evt, handler);
        return h;
      },
      trigger(evt, detail) {
        DomBehavior.trigger.call(mount(el), evt, detail);
        return h;
      },
      // Traversal (still lazy; mounts only returned elements)
      find(sel) {
        const found = el.querySelector(sel);
        return found ? makeHandle(found) : null;
      },
      children(sel) {
        const kids = Array.from(el.children);
        const filtered = sel ? kids.filter((k) => k.matches(sel)) : kids;
        return makeGroup(filtered);
      },
      parent(sel) {
        const p = el.parentElement;
        if (!p) return null;
        if (sel && !p.matches(sel)) return null;
        return makeHandle(p);
      },
      closest(sel) {
        const c = el.closest(sel);
        return c ? makeHandle(c) : null;
      },
      next(sel) {
        let n = el.nextElementSibling;
        while (n) {
          if (!sel || n.matches(sel)) return makeHandle(n);
          n = n.nextElementSibling;
        }
        return null;
      },
      prev(sel) {
        let p = el.previousElementSibling;
        while (p) {
          if (!sel || p.matches(sel)) return makeHandle(p);
          p = p.previousElementSibling;
        }
        return null;
      },
      // Escape hatch: get the FX node for this element (forces mount)
      fx() {
        return mount(el);
      },
      // Raw element (no mount)
      raw() {
        return el;
      }
    };
    return h;
  }
  function makeGroup(els) {
    const arr = Array.isArray(els) ? els : Array.from(els);
    const g = {
      elements: arr.map(makeHandle),
      get length() {
        return g.elements.length;
      },
      // Fan-out operations (chainable)
      val(v) {
        g.elements.forEach((h) => h.val(v));
        return g;
      },
      text(v) {
        g.elements.forEach((h) => h.text(v));
        return g;
      },
      html(v) {
        g.elements.forEach((h) => h.html(v));
        return g;
      },
      append(v) {
        g.elements.forEach((h) => h.append(v));
        return g;
      },
      attr(name, v) {
        g.elements.forEach((h) => h.attr(name, v));
        return g;
      },
      css(prop2, v) {
        g.elements.forEach((h) => h.css(prop2, v));
        return g;
      },
      addClass(...names) {
        g.elements.forEach((h) => h.addClass(...names));
        return g;
      },
      removeClass(...names) {
        g.elements.forEach((h) => h.removeClass(...names));
        return g;
      },
      toggleClass(name, state) {
        g.elements.forEach((h) => h.toggleClass(name, state));
        return g;
      },
      on(evt, selectorOrHandler, handlerOrOpts, opts) {
        g.elements.forEach((h) => h.on(evt, selectorOrHandler, handlerOrOpts, opts));
        return g;
      },
      off(evt, handler) {
        g.elements.forEach((h) => h.off(evt, handler));
        return g;
      },
      trigger(evt, detail) {
        g.elements.forEach((h) => h.trigger(evt, detail));
        return g;
      },
      // Traversal returns new groups/handles lazily
      find(sel) {
        const found = [];
        g.elements.forEach((h) => {
          const f = h.raw().querySelectorAll(sel);
          f && found.push(...Array.from(f));
        });
        const uniq = Array.from(new Set(found));
        return uniq.length === 1 ? makeHandle(uniq[0]) : makeGroup(uniq);
      },
      children(sel) {
        const acc = [];
        g.elements.forEach((h) => {
          const kids = Array.from(h.raw().children);
          const filtered = sel ? kids.filter((k) => k.matches(sel)) : kids;
          acc.push(...filtered);
        });
        const uniq = Array.from(new Set(acc));
        return uniq.length === 1 ? makeHandle(uniq[0]) : makeGroup(uniq);
      },
      parent(sel) {
        const acc = [];
        g.elements.forEach((h) => {
          const p = h.raw().parentElement;
          if (p && (!sel || p.matches(sel))) acc.push(p);
        });
        const uniq = Array.from(new Set(acc));
        return uniq.length === 1 ? makeHandle(uniq[0]) : makeGroup(uniq);
      },
      hasClass(name) {
        return g.elements.some((h) => h.hasClass(name));
      },
      each(fn) {
        g.elements.forEach((h, i) => fn(h, i));
        return g;
      },
      // Convenience
      fxAll() {
        return g.elements.map((h) => h.fx());
      },
      rawAll() {
        return g.elements.map((h) => h.raw());
      }
    };
    return g;
  }
  function makeRootHandle(target) {
    const h = {
      el: target,
      ready(fn) {
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", () => fn(h));
        } else {
          Promise.resolve().then(() => fn(h));
        }
        return h;
      },
      on(evt, selectorOrHandler, handlerOrOpts, opts) {
        let selector = null;
        let handler;
        let options;
        if (typeof selectorOrHandler === "string") {
          selector = selectorOrHandler;
          handler = handlerOrOpts;
          options = opts;
        } else {
          handler = selectorOrHandler;
          options = handlerOrOpts;
        }
        evt.split(/\s+/).forEach((e) => {
          if (selector) {
            const sel = selector;
            target.addEventListener(e, function(ev) {
              const t = ev.target?.closest?.(sel);
              if (t) handler.call(t, ev);
            }, options);
          } else {
            target.addEventListener(e, handler, options);
          }
        });
        return h;
      },
      off(evt, handler) {
        evt.split(/\s+/).forEach((e) => handler && target.removeEventListener(e, handler));
        return h;
      },
      trigger(evt, detail) {
        target.dispatchEvent(new CustomEvent(evt, { bubbles: true, cancelable: true, detail }));
        return h;
      },
      raw() {
        return target;
      }
    };
    return h;
  }
  function bindHandleToNode(handle, node) {
    const wire = (h) => {
      const el = h?.el ?? (typeof h?.raw === "function" ? h.raw() : null);
      const isForm = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (isForm) {
        h.val(node);
        const evt = el instanceof HTMLInputElement && el.type === "checkbox" || el instanceof HTMLSelectElement ? "change" : "input";
        el.addEventListener(evt, () => {
          const v = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
          node.set(v);
        });
      } else if (typeof h?.text === "function") {
        h.text(node);
      }
    };
    if (handle && typeof handle.each === "function" && handle.length !== void 0) handle.each((h) => wire(h));
    else wire(handle);
    return handle;
  }
  function $(sel, bind) {
    const result = resolve(sel);
    if (result && bind && isFXNode(bind)) return bindHandleToNode(result, bind);
    return result;
  }
  function resolve(sel) {
    if (sel == null) return null;
    if (sel === document || sel === window) return makeRootHandle(sel);
    if (typeof sel === "string") {
      if (sel.startsWith("#") && !sel.includes(" ") && !sel.includes(".")) {
        const el = document.getElementById(sel.slice(1));
        if (!el) return null;
        return makeHandle(el);
      }
      const list = document.querySelectorAll(sel);
      if (list.length === 0) return null;
      if (list.length === 1) return makeHandle(list[0]);
      return makeGroup(Array.from(list));
    }
    if (sel instanceof HTMLElement) return makeHandle(sel);
    if (sel instanceof NodeList || sel instanceof HTMLCollection) {
      const arr = Array.from(sel);
      if (arr.length === 0) return null;
      if (arr.length === 1) return makeHandle(arr[0]);
      return makeGroup(arr);
    }
    if (Array.isArray(sel)) {
      if (sel.length === 0) return null;
      if (sel.length === 1) return makeHandle(sel[0]);
      return makeGroup(sel);
    }
    console.warn("[fx-dom-dollar] $ called with unsupported argument:", sel);
    return null;
  }
  function apply(opMap) {
    applyOpMap($, opMap);
  }
  $.apply = apply;
  $.__isOpApplier = true;
  return $;
}
function installDomDollar(fx2) {
  const $ = domDollarPlugin(fx2);
  globalThis.$ = $;
  globalThis.$dom = $;
  return $;
}
function hydratePlugin(_fx) {
  const G = globalThis;
  const getDollar = () => typeof G.$$ === "function" ? G.$$ : void 0;
  const globalToNode = {};
  const isMissing = (v) => v === void 0 || v === null || v === "";
  function splitPipes(s) {
    const out = [];
    let buf = "", depth = 0, q = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        buf += c;
        if (c === q) q = "";
        continue;
      }
      if (c === '"' || c === "'") {
        q = c;
        buf += c;
        continue;
      }
      if (c === "{") {
        depth++;
        buf += c;
        continue;
      }
      if (c === "}") {
        depth--;
        buf += c;
        continue;
      }
      if (c === "|" && depth === 0) {
        out.push(buf);
        buf = "";
        continue;
      }
      buf += c;
    }
    out.push(buf);
    return out;
  }
  function readPath(path, deps) {
    deps.push(path);
    try {
      const $$2 = getDollar();
      const n = $$2 && $$2(path);
      if (!n) return void 0;
      if (typeof n.val === "function") return n.val();
      if (typeof n.get === "function") return n.get();
    } catch {
    }
    return void 0;
  }
  function readGlobal(expr, deps) {
    const dot = expr.indexOf(".");
    const head = dot === -1 ? expr : expr.slice(0, dot);
    const tail = dot === -1 ? "" : expr.slice(dot + 1);
    const mapped = globalToNode[head];
    if (mapped) return readPath(tail ? `${mapped}.${tail}` : mapped, deps);
    try {
      let v = G[head.replace(/^\$/, "") in G ? head.replace(/^\$/, "") : head];
      if (v === void 0) v = G[head];
      for (const k of tail ? tail.split(".") : []) v = v == null ? void 0 : v[k];
      return typeof v === "function" ? v : v;
    } catch {
      return void 0;
    }
  }
  function evalDollar(expr, deps) {
    const terms = splitPipes(expr);
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i].trim();
      if (!t) continue;
      if (t.startsWith("$${") && t.endsWith("}")) {
        const v2 = evalDollar(t.slice(3, -1), deps);
        if (!isMissing(v2)) return v2;
        continue;
      }
      const quoted = t.startsWith('"') && t.endsWith('"') || t.startsWith("'") && t.endsWith("'");
      if (quoted && i > 0) return t.slice(1, -1);
      const inner = quoted ? t.slice(1, -1) : t;
      const v = inner.startsWith("$") && !inner.startsWith("$$") ? readGlobal(inner, deps) : readPath(inner, deps);
      if (!isMissing(v)) return String(v);
    }
    return "";
  }
  function dollarSpans(tmpl) {
    const res = [];
    let i = 0;
    while (i < tmpl.length) {
      const s = tmpl.indexOf("$${", i);
      if (s < 0) break;
      let depth = 0, q = "", k = s + 2;
      for (; k < tmpl.length; k++) {
        const c = tmpl[k];
        if (q) {
          if (c === q) q = "";
          continue;
        }
        if (c === '"' || c === "'") {
          q = c;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (k >= tmpl.length) break;
      res.push({ start: s, end: k + 1, expr: tmpl.slice(s + 3, k) });
      i = k + 1;
    }
    return res;
  }
  const SINGLE_RE = /\{\s*([$\w][\w$.]*)\s*\}/g;
  function fill(tmpl, deps) {
    let out = "", last = 0;
    for (const sp of dollarSpans(tmpl)) {
      out += tmpl.slice(last, sp.start) + evalDollar(sp.expr, deps);
      last = sp.end;
    }
    out += tmpl.slice(last);
    out = out.replace(SINGLE_RE, (_m, expr) => {
      const v = expr.startsWith("$") && !expr.startsWith("$$") ? readGlobal(expr, deps) : readPath(expr, deps);
      return isMissing(v) ? "" : String(v);
    });
    return out;
  }
  const hasInterp = (s) => !!s && (s.indexOf("$${") !== -1 || /\{\s*[$\w][\w$.]*\s*\}/.test(s));
  function bind(getRaw, apply) {
    const tmpl = getRaw();
    const run = () => {
      const deps2 = [];
      apply(fill(tmpl, deps2));
      return deps2;
    };
    const deps = run();
    const $$2 = getDollar();
    if (!$$2) return;
    const seen = /* @__PURE__ */ new Set();
    for (const p of deps) {
      if (seen.has(p)) continue;
      seen.add(p);
      try {
        const n = $$2(p);
        n && typeof n.watch === "function" && n.watch(() => run());
      } catch {
      }
    }
  }
  function hydrateEl(el) {
    for (const name of el.getAttributeNames()) {
      const raw = el.getAttribute(name);
      if (!hasInterp(raw)) continue;
      const tmpl = raw;
      bind(() => tmpl, (filled) => {
        try {
          el.setAttribute(name, filled);
          if (name === "value" && "value" in el) el.value = filled;
        } catch {
        }
      });
    }
    const cn = el.childNodes;
    for (let i = 0; i < cn.length; i++) {
      const n = cn[i];
      if (n.nodeType === 3 && hasInterp(n.nodeValue)) {
        const tmpl = n.nodeValue;
        bind(() => tmpl, (filled) => {
          try {
            n.nodeValue = filled;
          } catch {
          }
        });
      }
    }
  }
  function bindImport(el) {
    const src = (el.getAttribute("src") || "").trim();
    if (!src) {
      unwrap(el);
      return;
    }
    const $$2 = getDollar();
    if (!$$2) {
      console.warn("[fx-hydrate] <import>: $$ absent \u2014 skipped.");
      return;
    }
    let nodePath = (el.getAttribute("as") || el.getAttribute("node") || "").trim();
    let modRef = src;
    const at = src.indexOf("@");
    if (at > 0) {
      nodePath = nodePath || src.slice(0, at);
      modRef = src.slice(at + 1);
    } else if (at === 0) {
      modRef = src.slice(1);
    }
    const spec = "@" + modRef.replace(/^@/, "");
    let def;
    try {
      const binding = $$2(spec);
      def = binding && binding.ns ? binding.ns.default : binding;
      if (def === void 0 && binding && binding.ns) def = binding.ns;
    } catch (e) {
      console.warn(`[fx-hydrate] <import src="${src}"> load failed:`, e);
      el.parentNode?.removeChild(el);
      return;
    }
    const globalName = (el.getAttribute("global") || "").trim();
    let exposed = def;
    const isCtor = typeof def === "function" && /^\s*class\s/.test(Function.prototype.toString.call(def));
    if (!nodePath && globalName && (isCtor || def && typeof def === "object")) {
      nodePath = "imports." + globalName.replace(/^\$/, "");
    }
    if (nodePath) {
      try {
        const node = $$2(nodePath);
        if (node && typeof node.as === "function" && (isCtor || def && typeof def === "object")) {
          exposed = node.as(def);
        } else if (node && typeof node.set === "function") {
          node.set(def);
          exposed = def;
        }
        if (globalName) globalToNode[globalName] = nodePath;
      } catch (e) {
        console.warn(`[fx-hydrate] <import as="${nodePath}"> graft failed:`, e);
      }
    } else if (isCtor) {
      try {
        exposed = new def();
      } catch {
        exposed = def;
      }
    }
    if (globalName) {
      try {
        G[globalName] = exposed;
      } catch {
      }
    }
    unwrap(el);
  }
  function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
  function processImports(root) {
    let imports = [];
    try {
      imports = Array.from(root.querySelectorAll("import[src]"));
    } catch {
      return;
    }
    for (const el of imports) {
      try {
        bindImport(el);
      } catch (e) {
        console.warn("[fx-hydrate] <import> failed \u2014 skipped.", e);
      }
    }
  }
  function hydrate(root) {
    const r = root || (typeof document !== "undefined" ? document.body : null);
    if (!r) return;
    try {
      processImports(r);
    } catch (e) {
      console.warn("[fx-hydrate] imports failed:", e);
    }
    const els = [r, ...Array.from(r.querySelectorAll("*"))];
    for (const el of els) {
      try {
        hydrateEl(el);
      } catch {
      }
    }
  }
  return hydrate;
}
function installHydrate(fx2) {
  const hydrate = hydratePlugin(fx2);
  globalThis.$hydrate = hydrate;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => hydrate());
    else hydrate();
  }
  return hydrate;
}
fx = new FXCore();
var $_$$ = fx.createNodeProxy(fx.root);
fx.ensureSystemRoots();
var $$ = $_$$("app");
var $root = (p) => {
  $$ = $_$$(p);
  globalThis.$$ = $$;
};
var $val = (path, value, def) => {
  const r = $$(path).val();
  if (value !== void 0) {
    $$(path).val(value);
    return $$(path);
  }
  return r === void 0 ? def : r;
};
var $set = (path, value) => $$(path).set(value);
var $get = (path) => $$(path).get();
var $has = (path) => $$(path).val() !== void 0;
var $node = (path) => $$(path).node();
var $app = $_$$("app");
var $config = $_$$("config");
var $plugins = $_$$("plugins");
var $modules = $_$$("modules");
var $atomics = $_$$("atomics");
var $dom = $_$$("dom");
var $session = $_$$("session");
var $system = $_$$("system");
var $cache = $_$$("cache");
Object.assign(globalThis, { fx, $_$$, $$, $root, $val, $set, $get, $has, $node, $app, $config, $plugins, $modules, $atomics, $dom, $session, $system, $cache });
$$ = patchDollarAtSyntax(fx);
globalThis.$$ = $$;
installDomDollar(fx);
installHydrate(fx);
var fx_mini_default = fx;
export {
  $$,
  $_$$,
  $app,
  $atomics,
  $cache,
  $config,
  $dom,
  $get,
  $has,
  $modules,
  $plugins,
  $root,
  $session,
  $set,
  $system,
  $val,
  FXCore,
  applyOpMap,
  fx_mini_default as default,
  fx,
  invokeWithSuspendReplay,
  patchDollarAtSyntax,
  replaceHtmlLifecycle,
  transformModuleExports
};
