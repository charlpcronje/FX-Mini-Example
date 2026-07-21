# The FX Kernel

The kernel is the foundation of FX. At roughly 360 lines of TypeScript, it provides the reactive node graph, the proxy interface, value storage, and an extension point for features. Everything else in FX -- selectors, groups, HTTP, @-syntax, plugins -- is optional and loads on top of the kernel via the `proxyMethods` registry.

If you only ship the kernel, you get: nodes, paths, values (with the value bag), watchers, effects, structure events, and the callable proxy. That is enough to build a full reactive application.

---

## FXNode -- The Data Structure

Every piece of state in FX lives in an `FXNode`. Nodes form a tree, addressed by dot-separated paths like `app.user.name`.

### Fields

| Field | Type | Purpose |
|-------|------|---------|
| `__id` | `string` | Unique identifier (random + timestamp) |
| `__parent_id` | `string \| null` | ID of parent node (`null` for root) |
| `__nodes` | `Record<string, FXNode>` | Child nodes keyed by name |
| `__value` | `any` | The value bag (see [02-value-bag](02-value-bag.md)) |
| `__type` | `string \| null` | Type tag: `"string"`, `"number"`, `"object"`, `"link"`, `"embed"`, class name, etc. |
| `__proto` | `Map<string, any>` | Behavior mixins attached via `.inherit()` |
| `__effects` | `Function[]` | Lifecycle hooks (`before.set`, `after.set`) |
| `__watchers` | `Set<(nv, ov) => void>` | Value-change subscribers |
| `__meta` | `Record<string, any>` (optional) | Arbitrary metadata |

### TypeScript

```typescript
const node: FXNode = {
    __id:        "k7f2x1m...",
    __parent_id: "a3b1c...",
    __nodes:     {},            // no children yet
    __value:     undefined,     // no value yet
    __type:      null,
    __proto:     new Map(),
    __effects:   [],
    __watchers:  new Set(),
};
```

### Rust

```rust
// In Rust, FXNode uses Arc for shared ownership
let node = FXNode {
    id:        generate_id(),
    parent_id: Some("a3b1c...".into()),
    nodes:     HashMap::new(),
    value:     None,            // Option<FXValueBag>
    node_type: None,            // Option<String>
    proto:     HashMap::new(),
    effects:   Vec::new(),
    watchers:  Vec::new(),
    meta:      None,
};
```

---

## FXCore -- The Engine

`FXCore` is the class that owns the root node, manages the parent map, and provides all operations on the graph. In a running application there is typically one `FXCore` instance, exposed globally as `$$`.

### Creating an instance

**TypeScript:**

```typescript
const fx = new FXCore();
fx.ensureSystemRoots();            // creates app, config, plugins, etc.
const $$ = fx.proxy();             // root proxy
```

**Rust:**

```rust
let fx = FXCore::new(FXLogger::default());
// System roots are created automatically in Rust
let root = fx.proxy("");           // root proxy
```

### Internal state

| Member | Purpose |
|--------|---------|
| `root` | The top-level `FXNode` |
| `__parentMap` | `Map<string, FXNode>` for O(1) parent lookups |
| `__structureListeners` | Subscribers to create/mutate events |
| `__batchedEvents` | Queued structure events (flushed via `setTimeout(0)`) |
| `proxyMethods` | `Map<string, handler>` -- the extension registry |
| `vfs` | Virtual filesystem reader (set by boot sequence) |
| `__setDepth` | Current recursion depth for the set-depth guard |

---

## Core Methods

### createNode

Creates a blank node with a unique ID.

```typescript
// TypeScript
const child = fx.createNode(parentNode.__id);
```

```rust
// Rust
let child = fx.create_node(Some(parent.id.clone()));
```

The node starts with `__value: undefined`, `__type: null`, no children, no watchers.

### set

Writes a value to a node. This is where the value bag is constructed. The kernel inspects the incoming value and takes one of four paths (plain object, class instance, link/embed, or scalar). See [02-value-bag](02-value-bag.md) for the full breakdown.

```typescript
// TypeScript
fx.set(node, 42);                // scalar
fx.set(node, { x: 1, y: 2 });   // plain object -- grafted into children
fx.set(node, new Date());        // class instance -- stored whole in bag
```

```rust
// Rust
fx.set(&node, FXValue::from(42));
fx.set(&node, FXValue::Object(map));      // grafted
fx.set_typed(&node, date_val, "Date");    // class instance
```

After building the bag, `set` fires `after.set` effects, notifies watchers, and emits a batched structure event.

### val

Returns the raw value from the bag. Does NOT look at children. Does NOT settle.

```typescript
// TypeScript
const v = fx.val(node);   // bag.raw, or undefined if grafted
```

```rust
// Rust
let v = fx.val(&node);    // FXValue or FXValue::Null
```

### settle

Recursively reconstructs a plain object from a node's children. This is the inverse of grafting.

```typescript
// TypeScript
fx.set(node, { a: { b: 1 } });
// node.__value is now undefined (grafted)

const obj = fx.settle(node);
// { a: { b: 1 } }
```

```rust
// Rust
let obj = fx.settle(&node);
// FXValue::Object({ "a": FXValue::Object({ "b": FXValue::Number(1.0) }) })
```

Settle is recursive: if a child has no value but has grandchildren, those grandchildren are settled too.

### graftObject

Expands a plain object into child nodes. Called internally by `set` when it detects a plain object.

```typescript
// TypeScript -- these are equivalent:
fx.set(node, { name: "Alice", age: 30 });
// ...is the same as:
fx.graftObject(node, { name: "Alice", age: 30 });
```

After grafting:
- Each key becomes a child node with its own value bag
- The parent's `__value` is cleared to `undefined`
- The parent's `__type` is set to `"object"`

### resolvePath

Walks a dot-separated path from a starting node. Returns the node at that path, or `null` if any segment is missing.

```typescript
// TypeScript
const nameNode = fx.resolvePath("user.name", fx.root);
// null if user or user.name doesn't exist
```

```rust
// Rust
let name_node = fx.resolve_path("user.name", &root);
// Option<Arc<FXNode>>
```

**Does not create nodes.** If you need auto-creation, use `setPath`.

### setPath

Like `resolvePath`, but creates any missing nodes along the way. Optionally sets a value on the final node.

```typescript
// TypeScript
const node = fx.setPath("user.name", "Alice", fx.root);
// Creates user and user.name if needed, sets "Alice"

const node2 = fx.setPath("user.email", undefined, fx.root);
// Creates user.email but does NOT call set() -- value stays undefined
```

```rust
// Rust
let node = fx.set_path("user.name", Some(FXValue::from("Alice")), &root);
let node2 = fx.set_path("user.email", None, &root);
```

When nodes are created, a `create` structure event is emitted for each one.

---

## The Proxy

The proxy is FX's primary interface. It wraps an `FXNode` in a JavaScript `Proxy` that is simultaneously:

1. **Callable** -- `proxy("path")` navigates or sets values
2. **Property-accessible** -- `proxy.child` traverses to child nodes
3. **Settable** -- `proxy.child = value` creates/updates a child

### The callable interface

```typescript
const $$ = fx.proxy();

// Navigate + implicit get (returns VALUE)
$$("app.name")              // returns the value of app.name

// Navigate + set (returns PROXY)
$$("app.name", "My App")   // sets app.name to "My App", returns proxy

// Set on current node (returns PROXY)
$$(42)                      // sets root to 42, returns root proxy

// No-op (returns PROXY)
$$()                        // returns root proxy
```

**Important:** `$$("path")` with one string argument returns a **value**, not a proxy. This is the "implicit get" behavior. To get a proxy for chaining, either use two arguments (`$$("path", value)`) or access a property (`$$.app.name`).

### Rust equivalent

Rust cannot use `$$` as an identifier or overload call syntax the same way. The `fx!` macro provides the equivalent:

```rust
fx!("app.name")               // navigate, returns proxy
fx!("app.name", "My App")     // navigate + set, returns proxy
```

For explicit operations:

```rust
let proxy = fx.proxy("app.name");
let value = proxy.val();           // get
proxy.val_set("My App");           // set
```

### Property access (get trap)

When you access a property on a proxy, the following resolution order applies:

1. `FX_PROXY_MARKER` -- returns `true` (identity check)
2. **View methods** -- `str`, `num`, `bool`, `raw` return bag view functions
3. **Built-in methods** -- `val`, `set`, `get`, `node`, `this`, `proxy`, `type`, `watch`, `nodes`, `inherit`, `as`
4. **Registered proxy methods** -- anything added via `registerProxyMethod`
5. **Behavior lookup** -- checks `__proto` map
6. **Child traversal** -- looks up `__nodes[key]`, returns child proxy
7. **Fallback** -- returns `undefined`

```typescript
$$.app              // child traversal -> proxy for app node
$$.app.name         // child traversal -> proxy for app.name node
$$.app.name.str()   // view method -> string from value bag
```

### Set trap

Assigning to a proxy property creates a child node (if needed) and sets its value.

```typescript
$$.app.name = "My App";     // creates app.name, sets "My App"
$$.app.count = 42;           // creates app.count, sets 42
```

**Reactive linking via the set trap:** If you assign a proxy as a value, the set trap creates a live link with automatic synchronization:

```typescript
$$.display = $$.source;
// 1. Extracts source node from the proxy
// 2. Cleans up any previous link on display
// 3. Subscribes: source.watch(nv => set(display, nv))
// 4. Immediately syncs: set(display, val(source))
```

```rust
// Rust equivalent
fx!("display").set_link(&fx!("source"));
```

Changes to `source` now automatically propagate to `display`.

### Built-in proxy methods

| Method | Read | Write | Returns |
|--------|------|-------|---------|
| `.val()` | raw from bag | -- | value |
| `.val(nv)` | -- | sets value | proxy |
| `.set(nv)` | -- | sets value | proxy |
| `.set(nv, "child")` | -- | sets on child | proxy |
| `.get()` | smart read (settles if object) | -- | value |
| `.get("child")` | value of child | -- | value |
| `.get(default)` | value or default | -- | value |
| `.str()` | `bag.string` | -- | string |
| `.num()` | `bag.num` | -- | number |
| `.bool()` | `bag.boolean` | -- | boolean |
| `.raw()` | `bag.raw` | -- | any |
| `.as(T)` | bag key or proto lookup | -- | value or null |
| `.node()` | raw FXNode | -- | FXNode |
| `.proxy()` | this proxy | -- | proxy |
| `.type()` | `__type` | -- | string or null |
| `.type("x")` | -- | sets `__type` | proxy |
| `.watch(cb)` | -- | subscribes | unsubscribe fn |
| `.nodes()` | child proxies | -- | object |
| `.inherit(...b)` | -- | adds behaviors | proxy |
| `.this()` | embed marker | -- | `{ __fx_embed, __node }` |

### Rust method name differences

Some TypeScript method names collide with Rust keywords. The Rust API uses different names:

| TypeScript | Rust | Reason |
|------------|------|--------|
| `.val(42)` | `.val_set(42)` | Can't overload return type |
| `.as("Name")` | `.as_type("Name")` | `as` is a keyword |
| `.type()` | `.get_type()` | `type` is a keyword |
| `.type("x")` | `.set_type("x")` | `type` is a keyword |

Everything else uses the same name.

---

## System Roots

When `ensureSystemRoots()` is called (usually during boot), the kernel creates nine top-level nodes under root:

| Root | Purpose |
|------|---------|
| `app` | Application state |
| `config` | Configuration values |
| `plugins` | Plugin registry |
| `modules` | Loaded modules |
| `system` | Internal system state |
| `cache` | Cached values |
| `session` | Session-scoped state |
| `dom` | DOM bindings (client-side) |
| `atomics` | Shared atomics (cross-thread) |

These are conventions, not hard requirements. The kernel creates the nodes but does not enforce what goes in them.

```typescript
// TypeScript
$$("app.name", "My App");
$$("config.debug", true);
$$("session.user", { name: "Alice" });
```

```rust
// Rust
fx!("app.name", "My App");
fx!("config.debug", true);
fx!("session.user", FXValue::Object(user_map));
```

---

## Extending the Kernel with proxyMethods

Features (selectors, groups, HTTP, @-syntax, etc.) do not modify the kernel. Instead, they register methods on the `proxyMethods` registry. When the proxy encounters an unknown property name, it checks this registry before falling through to child traversal.

### Registering a method

```typescript
// A feature registers during boot:
fx.registerProxyMethod("select", (self, node, proxy, selector: string) => {
    // self = FXCore instance
    // node = the FXNode this proxy wraps
    // proxy = the proxy itself
    return runSelectorEngine(self, node, selector);
});
```

### Using a registered method

```typescript
// Now every proxy has .select():
$$("app").select(".active");
```

### How it works in the manifest

The VFS manifest (`__fx_manifest__.json`) declares which proxy methods each feature provides:

```json
{
  "features": [
    {
      "name": "fx-selector-engine",
      "file": "core/fx-selector-engine.ts",
      "proxyMethods": ["select", "selectAll", "matches"]
    },
    {
      "name": "fx-groups",
      "file": "core/fx-groups.ts",
      "proxyMethods": ["group", "groupAll"]
    }
  ]
}
```

During boot, stubs are installed for each declared proxy method. The first time you call `$$("x").select(...)`, the stub lazy-loads the feature module from the VFS bundle, replaces itself with the real implementation, and executes the call. Subsequent calls go directly to the real handler.

This means the kernel stays at ~360 lines and features pay for themselves only when used.

---

## Reactivity

### Watchers

Watchers subscribe to value changes on a single node. They fire synchronously during `set()`, in insertion order.

```typescript
// TypeScript
const unwatch = $$("count").watch((newBag, oldBag) => {
    console.log("changed:", newBag, oldBag);
});

$$("count", 1);   // watcher fires
$$("count", 2);   // watcher fires
unwatch();         // unsubscribed
$$("count", 3);   // watcher does NOT fire
```

```rust
// Rust
fx!("count").watch(|new_bag, old_bag| {
    println!("changed: {} -> {}", old_bag.num(), new_bag.num());
});
```

### Effects

Effects are lifecycle hooks that fire at specific points during `set()`. They receive the event name, proxy, key, and value.

```typescript
const node = $$("price").node();
node.__effects.push((event, proxy, key, value) => {
    if (event === "before.set") {
        console.log("about to set:", value);
    }
    if (event === "after.set") {
        console.log("just set:", value);
    }
});
```

```rust
// Rust
fx!("price").effect(|event, key, value| {
    match event {
        "before.set" => println!("about to set: {:?}", value),
        "after.set"  => println!("just set: {:?}", value),
        _ => {}
    }
});
```

### Structure events

Structure events (`create`, `mutate`) notify listeners when the node tree changes shape. They are **batched** via `setTimeout(0)` -- all mutations from a synchronous burst arrive in a single batch.

```typescript
const unsub = fx.onStructure((event) => {
    console.log(event.kind, event.node.__id);
    // kind: "create" | "mutate"
});
```

---

## Environment Detection

The kernel detects the runtime environment at load time:

| Constant | True when |
|----------|-----------|
| `HAS_DENO` | Running in Deno |
| `HAS_NODE` | Running in Node.js |
| `IS_SERVER` | Either Deno or Node (not browser) |

These are exported and available to features and plugins.

---

## Summary

The kernel provides the minimum viable reactive graph:

- **Nodes** store values, types, behaviors, watchers, and children
- **FXCore** manages the graph with `createNode`, `set`, `val`, `settle`, `graftObject`, `resolvePath`, `setPath`
- **The proxy** provides a fluent, callable interface with property access, set traps, and reactive linking
- **proxyMethods** let features extend the proxy without modifying kernel code
- **System roots** establish conventional top-level namespaces
- **Reactivity** comes from watchers (per-node), effects (lifecycle), and structure events (tree-wide)

Everything beyond this -- selectors, groups, modules, HTTP, DOM, flows -- lives in feature modules loaded on demand.
