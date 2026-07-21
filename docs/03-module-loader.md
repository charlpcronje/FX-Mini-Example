# Module Loader & Plugin Manager

FX provides synchronous module loading across all runtimes (Node, Deno, browser) and a plugin system that lazily loads extensions on first access.

---

## SyncModuleLoader

`SyncModuleLoader` gives you `loadSync(url)` -- a function that blocks until the module source is available, regardless of environment. This is what makes FX's synchronous `$$("@./module.ts")` syntax possible even in the browser, where network requests are inherently asynchronous.

### How It Works by Environment

| Environment | Mechanism | Blocking? |
|---|---|---|
| **Node.js** | `fs.readFileSync()` for local files, `fetch` for remote | Yes (native) |
| **Deno** | `Deno.readTextFileSync()` for local files | Yes (native) |
| **Browser** | Worker + `SharedArrayBuffer` + `Atomics.wait` | Yes (synthetic) |
| **Browser (CSP)** | Fallback stub with `__fx_csp_blocked: true` | No (graceful degradation) |

### Server Mode (Node / Deno)

On server runtimes, `loadSync` reads files directly from disk:

```typescript
// Node.js
const { fs } = this.getNodeModules();
text = fs.readFileSync(filePath, 'utf8');

// Deno
text = Deno.readTextFileSync(filePath);
```

No workers, no shared buffers -- just a blocking file read. Remote URLs fall through to `fetch`.

### Browser Mode: Worker + Atomics.wait

In the browser, there is no synchronous network API. FX works around this with a dedicated Web Worker and `SharedArrayBuffer`:

```
Main thread                          Worker thread
    |                                    |
    |-- postMessage({ url, sab }) ------>|
    |                                    |-- fetch(url)
    |   Atomics.wait(lock, 0, 0)         |   await res.text()
    |   (thread blocks here)             |-- encode into SharedArrayBuffer
    |                                    |-- Atomics.store(lock, 0, id)
    |   <-- Atomics.notify(lock) --------|-- Atomics.notify(lock, 0, 1)
    |                                    |
    |   read text from SharedArrayBuffer |
```

The `SharedArrayBuffer` layout:

| Offset | Size | Purpose |
|---|---|---|
| 0 | 4 bytes | Lock signal (`Int32Array`) -- 0 = waiting, positive = request ID (success), negative = error |
| 4 | 4 bytes | Length of fetched data (`Int32Array`) |
| 8 | ~2 MB | Data buffer (`Uint8Array`) |

When running on the UI thread, `loadSync` uses `FXSuspend` (an exception-based suspend/resume mechanism) instead of `Atomics.wait`, which would freeze the browser:

```typescript
if (isUIThread()) {
    const p = this.fetchIntoCache(url).catch(() => { });
    throw new FXSuspend(p);  // caught and replayed by FX runtime
}
```

### CSP-Compatible Fallback

If Content Security Policy blocks `unsafe-eval` (detected by attempting `new Function('return true')()`), the loader switches to CSP mode. Synchronous loading returns a placeholder module:

```typescript
// CSP mode returns a stub
export default { __fx_csp_blocked: true, __fx_module_url: "the-url" };
```

### Module Caching

Every loaded module is cached by URL in a `Map<string, string>`. Subsequent calls to `loadSync` or `loadAsync` for the same URL return instantly from cache:

```typescript
loadSync(url: string): string {
    if (this.cache.has(url)) return this.cache.get(url)!;
    // ... fetch and cache
}
```

### Module Integrity

You can register expected hashes for URLs to verify loaded content:

```typescript
loader.setIntegrity("https://cdn.example.com/lib.js", "sha256-abc123...");
const hash = loader.getIntegrity("https://cdn.example.com/lib.js");
```

### Full API

```typescript
class SyncModuleLoader {
    loadSync(url: string): string;                          // Blocking load
    loadAsync(url: string, timeoutMs?: number): Promise<string>;  // Async load
    loadModule(url: string): Promise<any>;                  // Dynamic import() wrapper
    setIntegrity(url: string, hash: string): void;          // Register expected hash
    getIntegrity(url: string): string | undefined;          // Retrieve hash
}
```

---

## The @-Syntax: `$$("@./module.ts")`

The `@` prefix in FX paths triggers module loading. When you write:

```typescript
$$("@./module.ts")
```

FX intercepts the `@` prefix, calls `loadSync("./module.ts")` to fetch the source, evaluates it, and returns the result. This lets you treat modules as part of the FX node tree.

---

## Plugin Manager

`PluginManager` reads `.fxrc.json` at startup and creates lazy-loading proxies for plugins. Plugins like `$db`, `$flow`, or `$dom` auto-load on first property access.

### .fxrc.json Manifest Format

Place `.fxrc.json` in your project root:

```json
{
    "plugins": {
        "$db": {
            "path": "./plugins/fx-db.js",
            "callback": "initDatabase",
            "config": {
                "connectionString": "sqlite://data.db"
            },
            "description": "Database plugin"
        },
        "$flow": "./plugins/fx-flow.js"
    },
    "modules": {
        "utils": "./lib/utils.js",
        "validators": "./lib/validators.js"
    },
    "config": {
        "lazyLoad": true,
        "cacheModules": true,
        "autoRegister": true,
        "logLoading": false,
        "timeout": 5000
    },
    "environment": {
        "stage": "development"
    }
}
```

#### Manifest Fields

| Field | Type | Description |
|---|---|---|
| `plugins` | `Record<string, ManifestPlugin \| string>` | Plugin definitions. String shorthand sets only `path`. |
| `modules` | `Record<string, string>` | Module paths for lazy loading via `modules.<name>` |
| `config` | `object` | Loader configuration (see below) |
| `environment` | `Record<string, any>` | Custom environment variables |

#### Plugin Definition (`ManifestPlugin`)

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Required. Path to the plugin module. |
| `callback` | `string` | Optional. JS expression to evaluate after load. |
| `config` | `object` | Optional. Stored at `plugins.<name>.config` in the FX tree. |
| `description` | `string` | Optional. Human-readable description. |

### Lazy Loading on First Access

Plugins whose names start with `$` are installed as lazy `globalThis` getters. The first time you access `$db`, the getter fires, loads the module, initializes it, and replaces itself with the loaded instance:

```typescript
// First access to $db triggers:
// 1. require("./plugins/fx-db.js")
// 2. Call pluginModule(fx) or pluginModule.default(fx)
// 3. Register at plugins.db in the FX tree
// 4. Execute callback if specified
// 5. Store plugin config at plugins.db.config
// 6. Return the instance

// All of this is invisible to the caller:
$db.query("SELECT * FROM users");  // just works
```

The `moduleGuard` prevents infinite recursion if a plugin's own code accesses its global during initialization.

### Registering Plugins Programmatically

You can register plugins without a manifest:

```typescript
fx.plugins.register("myPlugin", (fx) => {
    return {
        doSomething() { /* ... */ }
    };
}, { global: "$myPlugin", prefix: "plugins" });
```

#### `register<T>(name, factoryOrObj, opts?)` Options

| Option | Type | Description |
|---|---|---|
| `global` | `string` | Name to assign on `globalThis` |
| `prefix` | `string` | FX tree path prefix (default: `"plugins"`) |

### How Plugins Register Proxy Methods

Plugins can extend the FX proxy API by registering methods during boot. In `fx-boot.ts`, the manifest's `proxyMethods` section wires this up:

```json
{
    "kernel": {
        "proxyMethods": {
            "validate": { "feature": "validation", "handler": "handleValidate" },
            "format": { "feature": "formatting", "handler": "handleFormat" }
        }
    }
}
```

This installs lazy stubs on the proxy prototype. The first call to `$$("some.node").validate()` loads the `validation` feature and delegates to its `handleValidate` function:

```typescript
fx.registerProxyMethod("validate", (self, node, proxy, ...args) => {
    // Lazy-loads the feature on first call
    const mod = features.load("validation", vfsPath, vfs, fx);
    return mod.handleValidate(self, node, proxy, ...args);
});
```

### Reloading

Call `reloadManifest()` to re-read `.fxrc.json` and reset all lazy proxies:

```typescript
fx.plugins.reloadManifest();
```

---

## Boot Sequence Summary

The `boot()` function in `fx-boot.ts` orchestrates startup:

| Stage | Action |
|---|---|
| 1 | Create `FXCore` + system roots |
| 2 | Mount VFS bundle (base64, URL, or skip) |
| 3 | Read `__fx_manifest__.json` from VFS |
| 4 | Apply `config` entries to FX tree |
| 5 | Install feature stubs (lazy-load from VFS on first call) |
| 6 | Install proxy method stubs |
| 7 | Eager-load features listed in `loadOrder` |
| 8 | Install plugin lazy loaders (`$dom`, `$db`, etc.) |
| 9 | Create `$$`, `$root`, `$app`, `$config`, etc. globals |
| 10 | Patch `$$` with @-syntax if loaded |
| 11 | Ready |

```typescript
import { boot } from "./fx-boot";

const { fx, $$ } = boot({
    bundleUrl: "./app.fxb",
    // or bundleBase64: "RlhCAA...",
    // or vfs: customVfsAdapter,
});

$$("app.name").set("My App");
```
