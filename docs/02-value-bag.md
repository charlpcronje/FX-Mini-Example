# The Value Bag

Every FX node stores its value as a **bag** -- a plain object (TypeScript) or `HashMap<String, FXValue>` (Rust) with multiple named entries. When you call `.set()`, FX does not just store your value. It wraps it into a bag with pre-computed views so that reads are fast and type coercion happens once, at write time.

```typescript
// You set a number:
$$("price", 19.99);

// Internally, node.__value becomes:
{
    raw:     19.99,        // the original value
    num:     19.99,        // numeric view (pre-computed)
    string:  "19.99",      // string view (pre-computed)
    boolean: true           // truthiness (pre-computed)
}
```

```rust
// Rust equivalent:
fx!("price", 19.99);

// node.__value becomes a HashMap:
// {
//     "raw":     FXValue::Number(19.99),
//     "num":     FXValue::Number(19.99),
//     "string":  FXValue::String("19.99"),
//     "boolean": FXValue::Bool(true),
// }
```

### Why a bag?

1. **Zero-cost reads** -- `.str()`, `.num()`, `.bool()` read pre-computed values directly. No conversion at access time.
2. **Multiple views** -- the same value is available as a string, number, and boolean simultaneously.
3. **Named keys for typed values** -- class instances get a key by their class name, enabling `.as("ClassName")` lookups.
4. **Links and embeds** -- the bag holds both the node reference and display-friendly metadata.

---

## The Four set() Paths

When you call `.set(value)`, the kernel inspects the incoming value and classifies it into exactly one of four categories.

### Path 1: Plain Object -- Graft

If the value is a plain object (`constructor === Object`, not an array), the object is **grafted** -- exploded into child nodes. The parent's `__value` is cleared.

```typescript
// TypeScript
$$("user", { name: "Alice", age: 30 });

// Result:
// user.__value = undefined  (cleared)
// user.__type  = "object"
// user.name.__value = { raw: "Alice", num: "Alice", string: "Alice", boolean: true }
// user.age.__value  = { raw: 30, num: 30, string: "30", boolean: true }
```

```rust
// Rust
let mut obj = HashMap::new();
obj.insert("name".to_string(), FXValue::from("Alice"));
obj.insert("age".to_string(), FXValue::from(30));
fx!("user").set(FXValue::Object(obj));

// Same result: user has no value, children hold the data
```

Grafting is recursive. If a child value is also a plain object, it gets grafted too:

```typescript
$$("point", { position: { x: 10, y: 20 } });
// Creates: point.position.x = 10, point.position.y = 20
// point.__value = undefined
// point.position.__value = undefined
// point.position.x.__value = { raw: 10, num: 10, ... }
```

**Key insight:** Sub-nodes are set depth-first, leaf-first. In the example above, `x` fires its watchers before `position`, which fires before `point`.

### Path 2: Class Instance

If the value is an object whose `constructor.name` is not `"Object"` (e.g., a `Date`, `User`, `Map`), the instance is stored whole in the bag under its class name.

```typescript
// TypeScript
class User { constructor(public name: string) {} }
$$("session.user", new User("Alice"));

// node.__value becomes:
// {
//     User:    <User instance>,     // keyed by constructor.name
//     raw:     <User instance>,
//     string:  '{"name":"Alice"}',  // JSON serialization
//     boolean: true
// }
// node.__type = "User"
```

```rust
// Rust -- class detection is explicit, not automatic
fx!("session.user").set_typed(user_value, "User");

// Same bag shape, with "User" as a named key
```

The instance is NOT grafted. It stays as a single value in the bag.

### Path 3: Reactive Link

If the value is an FX proxy (detected via `isProxy()`), a link bag is created. In the **kernel's `set()` method**, only the bag is stored. The actual watcher subscription for live syncing is handled by the **proxy set trap** (see below).

```typescript
// TypeScript -- via the proxy set trap
$$.display = $$.source;

// node.__value becomes:
// {
//     raw:    <FXNode>,
//     FXNode: <FXNode>,
//     string: "[FXNode abc123]",
//     boolean: true
// }
// node.__type = "link"
```

```rust
// Rust
fx!("display").set_link(&fx!("source"));

// Same bag shape, with NodeRef instead of FXNode
```

There is also the **embed** variant (via `.this()`), which stores a node reference without creating a reactive watcher. Embeds act as transparent portals -- navigating into an embed node steps through to the referenced node's children.

```typescript
// TypeScript
$$("portal").val($$("source.data").this());
$$("portal").x   // navigates to source.data.x

// Embed bag:
// { raw: <FXNode>, FXNode: <FXNode>, string: "[FXNode embed ...]", boolean: true }
// __type = "embed"
```

### Path 4: Scalar

Everything else -- numbers, strings, booleans, `null`, arrays -- takes the scalar path.

```typescript
// TypeScript
$$("count", 42);
// { raw: 42, num: 42, string: "42", boolean: true }

$$("name", "Alice");
// { raw: "Alice", num: "Alice", string: "Alice", boolean: true }

$$("active", false);
// { raw: false, num: false, string: "false", boolean: false }

$$("items", [1, 2, 3]);
// { raw: [1,2,3], num: [1,2,3], string: "1,2,3", boolean: true }
```

```rust
// Rust
fx!("count", 42);
// { "raw": Number(42.0), "num": Number(42.0), "string": String("42"), "boolean": Bool(true) }

fx!("name", "Alice");
// { "raw": String("Alice"), "num": NaN, "string": String("Alice"), "boolean": Bool(true) }
```

**Numeric coercion:** The `num` field uses `toNumIfStr()` -- if the raw value is a string that parses as a finite number, `num` holds the parsed float. Otherwise, `num` holds the original value (TypeScript) or `NaN` (Rust).

**Arrays are NOT grafted.** They are stored as a single scalar value in the bag.

### Path summary

| Condition | Path | `__value` | `__type` |
|-----------|------|-----------|----------|
| Plain object (`constructor === Object`) | Graft | cleared to `undefined` | `"object"` |
| Class instance (`constructor.name !== "Object"`) | Typed bag | `{ [ClassName]: instance, raw, string, boolean }` | class name |
| FX proxy (`isProxy(value)`) | Link bag | `{ raw: FXNode, FXNode, string, boolean }` | `"link"` |
| Embed marker (`__fx_embed`) | Embed bag | `{ raw: FXNode, FXNode, string, boolean }` | `"embed"` |
| Everything else | Scalar bag | `{ raw, num, string, boolean }` | `typeof value` (set only if `__type` was null) |

---

## Reading from the Bag

### .str(), .num(), .bool(), .raw()

These read pre-computed views directly from the bag. No conversion happens at access time.

```typescript
// TypeScript
$$("price", "19.99");

$$("price").str();    // "19.99"    -- bag.string
$$("price").num();    // 19.99      -- bag.num (pre-computed from string)
$$("price").bool();   // true       -- bag.boolean
$$("price").raw();    // "19.99"    -- bag.raw (the original value)
```

```rust
// Rust
fx!("price").val_set("19.99");

fx!("price").str();    // "19.99"
fx!("price").num();    // 19.99
fx!("price").bool();   // true
fx!("price").raw();    // FXValue::String("19.99")
```

Under the hood, each method reads a single key from the bag:

| Method | Bag key | TypeScript | Rust |
|--------|---------|------------|------|
| `.str()` | `string` | `node.__value?.string` | `bag.get("string")` |
| `.num()` | `num` | `node.__value?.num` | `bag.get("num")` |
| `.bool()` | `boolean` | `node.__value?.boolean` | `bag.get("boolean")` |
| `.raw()` | `raw` | `node.__value?.raw` | `bag.get("raw")` |

If the bag does not contain the requested key, these methods fall back to `val()`.

**Note (Rust):** On `FXProxy`, `.str()`, `.num()`, `.bool()` read from the bag. On `FXValue` directly, use `.to_str()`, `.to_num()`, `.to_bool()` -- these compute on the fly.

### .as() -- Dynamic Key Lookup

`.as()` looks up an arbitrary key in the bag. This is how you retrieve typed/class instances.

```typescript
// TypeScript
class Session { /* ... */ }
$$("session", new Session());

$$("session").as(Session);    // returns the Session instance from bag["Session"]
$$("session").as("Session");  // same thing, by string name
```

```rust
// Rust
fx!("session").set_typed(session_val, "Session");
fx!("session").as_type("Session");   // Some(FXValue) -- bag["Session"]
```

If the bag does not have the requested key, `.as()` also checks:
1. Whether `raw` is an `instanceof` the given constructor (TypeScript only)
2. The `__proto` map -- if a behavior with that name exists, it returns a lens proxy that delegates method calls to the behavior

```typescript
// Behavior lookup via .as()
$$("doc").inherit(Printable);
$$("doc").as("Printable").print();   // calls Printable.print() bound to the proxy
```

### .get() -- Smart Read

`.get()` is the intelligent read method. Unlike `.val()` which always returns `bag.raw`, `.get()` considers the node's children and type.

**With no argument:**

```typescript
$$("user", { name: "Alice", age: 30 });

$$("user").val();    // undefined  (grafted -- __value was cleared)
$$("user").get();    // { name: "Alice", age: 30 }  (settled from children)
```

Logic:
1. If the node has children AND `__type === "object"`, call `settle()` to reconstruct the object
2. Otherwise, return `val()`

**With a string argument:**

```typescript
$$("user").get("name");    // "Alice"  (VALUE of child, not proxy)
$$("user").get("age");     // 30
```

Logic:
1. Navigate to the child node
2. If the child has a value, return it
3. If the child has no value but has its own children, settle those children

**With a non-string argument (default value):**

```typescript
$$("missing").get("fallback");   // "fallback"  (no value set, returns default)
```

If `val()` returns `null`/`undefined`, the argument is returned as a default.

### .val() -- Dumb Read

`.val()` always returns `bag.raw`. It does not look at children, does not settle, does not provide defaults.

```typescript
$$("user", { name: "Alice" });
$$("user").val();     // undefined   (grafted)
$$("user").get();     // { name: "Alice" }   (settled)
```

```rust
let v = fx!("user").val();   // FXValue::Null (grafted)
let g = fx!("user").get();   // FXValue::Object(...) (settled)
```

---

## The set() Lifecycle

Every `.set()` call follows a strict sequence of operations:

```
1. Store old value           old = node.__value
2. Fire before.set effects   triggerEffects(node, "before.set", "__value", value)
3. Classify value            inspect value, take one of four paths
4. Build bag                 construct the value bag (or graft)
5. Store bag                 node.__value = bag
6. ---- _finishSet() ----
7. Depth guard check         if __setDepth >= 10, ABORT with warning
8. Increment depth           __setDepth++
9. Fire after.set effects    triggerEffects(node, "after.set", "__value", node.__value)
10. Notify watchers          for each watcher: cb(node.__value, old)
11. Emit structure event     emitStructure({ kind: "mutate", node })  (batched)
12. Decrement depth          __setDepth--
```

### Effects fire at two points

- **`before.set`** fires BEFORE the value is classified or stored. The effect receives the raw incoming value.
- **`after.set`** fires AFTER the bag is built and stored, but BEFORE watchers run.

```typescript
const node = $$("x").node();
node.__effects.push((event, proxy, key, value) => {
    if (event === "before.set") {
        // value = the raw incoming value (not yet bagged)
    }
    if (event === "after.set") {
        // value = the built bag (already stored in __value)
    }
});
```

### Watchers receive old and new bags

```typescript
$$("count").watch((newBag, oldBag) => {
    // newBag = node.__value (the new bag)
    // oldBag = the previous __value
});
```

Watchers fire synchronously, in insertion order (JavaScript `Set` iteration order).

### Structure events are batched

The `mutate` event is pushed to a batch queue and flushed via `setTimeout(0)`. Multiple synchronous sets produce a single batch of events for structure listeners.

---

## Set-Depth Guard

The kernel enforces a maximum recursion depth of **10** for `set()` calls. This prevents infinite loops when watchers trigger further sets.

```
set("a", 1)
  -> watcher on "a" calls set("b", 2)
    -> watcher on "b" calls set("a", 3)
      -> watcher on "a" calls set("b", 4)
        -> ... depth 10 -> ABORT
```

When the limit is reached, the kernel logs:

```
[FX] set() depth limit reached on node {id}
```

The set is silently dropped. No watchers fire, no structure event is emitted for that call.

**Best practice:** Keep watcher chains short. If you need multi-step reactive propagation, design your watchers to converge rather than oscillate.

---

## Graft and Settle -- The Object Roundtrip

### Graft: Object to Children (on set)

When a plain object is set on a node, it is **grafted** -- each key becomes a child node.

```typescript
$$("config", {
    debug: true,
    server: {
        port: 8080,
        host: "localhost"
    }
});
```

Produces this tree:

```
config (value: undefined, type: "object")
  +-- debug  (value: { raw: true, num: true, string: "true", boolean: true })
  +-- server (value: undefined, type: "object")
        +-- port (value: { raw: 8080, num: 8080, string: "8080", boolean: true })
        +-- host (value: { raw: "localhost", num: "localhost", string: "localhost", boolean: true })
```

Graft is recursive. Nested plain objects are grafted into nested nodes.

### Settle: Children to Object (on get)

`settle()` is the inverse. It walks the children and reconstructs a plain object.

```typescript
$$("config").get();
// { debug: true, server: { port: 8080, host: "localhost" } }
```

```rust
fx!("config").settle();
// FXValue::Object({ "debug": Bool(true), "server": Object({ "port": Number(8080.0), ... }) })
```

Settle is also recursive. If a child has no value but has grandchildren, those are settled too.

**This is the fundamental pattern: set grafts, get settles.** The node tree IS the object. Individual properties are individually reactive -- watching `config.server.port` fires only when that specific value changes, not when `config.debug` changes.

---

## Truthiness Rules

The `boolean` field in the bag follows these rules:

| Value | `boolean` |
|-------|-----------|
| `false` | `false` |
| `0` | `false` |
| `""` (empty string) | `false` |
| `null` | `false` |
| `undefined` | `false` |
| `NaN` | `false` |
| Everything else | `true` |

This matches JavaScript truthiness semantics. Some examples:

```typescript
$$("a", "hello").bool();   // true
$$("b", "").bool();        // false
$$("c", 0).bool();         // false
$$("d", 1).bool();         // true
$$("e", []).bool();        // true   (arrays are truthy, even empty)
$$("f", {}).bool();        // N/A    (plain objects are grafted, not bagged)
$$("g", null).bool();      // false
```

Class instances, links, and embeds always have `boolean: true`.

---

## Type Stickiness

The `__type` field has different behavior depending on which set path runs:

| Path | Type behavior |
|------|---------------|
| Graft (plain object) | Always sets `__type = "object"` |
| Class instance | Always sets `__type = className` |
| Link | Always sets `__type = "link"` |
| Embed | Always sets `__type = "embed"` |
| Scalar | Sets `__type = typeof value` **only if `__type` was previously `null`** |

The scalar rule is the important one. Once a node has a type, scalar sets do NOT change it.

```typescript
$$("x", { a: 1 });       // __type = "object" (graft)
$$("x").type();           // "object"

$$("x", 42);             // __type stays "object" (scalar path, but type was already set)
$$("x").type();           // "object"
```

This is intentional. It means a node's type reflects how it was first structured, not what value it currently holds. If you need to change the type explicitly, use `.type("newType")`:

```typescript
$$("x").type("number");   // explicitly override
```

```rust
fx!("x").set_type("number");
```

---

## Reactive Links vs Embeds vs Grafts

These three mechanisms all deal with connecting nodes, but they work differently:

| | Graft | Link | Embed |
|---|---|---|---|
| **Trigger** | `set(plainObject)` | `proxy.child = otherProxy` | `proxy.val(other.this())` |
| **What happens** | Object exploded into children | NodeRef stored + watcher created | NodeRef stored, no watcher |
| **`__value`** | Cleared (`undefined`) | Bag with NodeRef | Bag with NodeRef |
| **`__type`** | `"object"` | `"link"` | `"embed"` |
| **Reactive** | No (children are independent) | Yes (source changes propagate) | No (shared reference, no propagation) |
| **Navigate children** | Yes (own children) | No (use `.deref_value()`) | Yes (auto-step-into referenced node) |
| **Data relationship** | Copied into children | Referenced + watched | Referenced (shared, alias) |

### When to use each

- **Graft** when you want to decompose an object into individually reactive nodes. This is the default for plain objects.
- **Link** when you want one node to mirror another's value and stay in sync automatically. One-directional: source to target.
- **Embed** when you want a node to act as a transparent portal into another subtree. Navigation through the embed reaches the referenced node's children directly.

---

## Custom Bag Keys

Since the bag is a plain object (TypeScript) or `HashMap` (Rust), you can store additional keys beyond the standard four:

```typescript
// TypeScript -- class instances get a named key automatically
class Currency { constructor(public code: string, public amount: number) {} }
$$("price", new Currency("USD", 42));

// bag = { Currency: <instance>, raw: <instance>, string: "...", boolean: true }
$$("price").as("Currency");   // the Currency instance
$$("price").raw();            // same instance
$$("price").str();            // JSON string
```

```rust
// Rust -- use set_typed for named keys
fx!("price").set_typed(price_value, "Currency");
fx!("price").as_type("Currency");   // Some(FXValue)
```

In Rust, you can also directly manipulate the bag:

```rust
if let Some(mut bag) = fx!("item").bag() {
    bag.set("category", FXValue::from("electronics"));
    // bag now has: raw, num, string, boolean, category
}
```

---

## Edge Cases

### null

Setting `null` takes the scalar path (NOT graft). The bag is `{ raw: null, num: null, string: "", boolean: false }`.

### undefined

Passing `undefined` as the value to `setPath` does NOT call `set()`. The node is created but `__value` stays `undefined`. No watchers fire, no bag is built.

### Arrays

Arrays are NOT grafted. They take the scalar path and are stored as a single value:

```typescript
$$("items", [1, 2, 3]);
// { raw: [1,2,3], num: [1,2,3], string: "1,2,3", boolean: true }
// No child nodes created
```

### Grafted nodes return undefined from val()

After grafting, the parent's `__value` is `undefined`. Use `.get()` (which settles) or access children individually:

```typescript
$$("user", { name: "Alice" });
$$("user").val();           // undefined
$$("user").get();           // { name: "Alice" }
$$("user").get("name");     // "Alice"
$$.user.name.val();         // "Alice"
```

### Watcher execution order for grafted objects

When setting a nested object, watchers fire depth-first, leaf-first:

```typescript
$$("x").watch(rootCb);
$$("x.a").watch(childCb);
$$("x.a.b").watch(leafCb);

$$("x", { a: { b: 99 } });
// Fire order: leafCb, then childCb, then rootCb
```

---

## Quick Reference Table

| Operation | TypeScript | Rust |
|-----------|-----------|------|
| Set scalar | `$$("x", 42)` | `fx!("x", 42)` |
| Set object (graft) | `$$("x", { a: 1 })` | `fx!("x").set(FXValue::Object(map))` |
| Set class instance | `$$("x", new Foo())` | `fx!("x").set_typed(val, "Foo")` |
| Create link | `$$.x = $$.y` | `fx!("x").set_link(&fx!("y"))` |
| Create embed | `$$("x").val($$("y").this())` | `fx!("x").embed(&fx!("y"))` |
| Read raw | `$$("x").val()` or `$$("x").raw()` | `fx!("x").val()` or `fx!("x").raw()` |
| Read string | `$$("x").str()` | `fx!("x").str()` |
| Read number | `$$("x").num()` | `fx!("x").num()` |
| Read boolean | `$$("x").bool()` | `fx!("x").bool()` |
| Read by name | `$$("x").as("Foo")` | `fx!("x").as_type("Foo")` |
| Smart read | `$$("x").get()` | `fx!("x").get()` |
| Smart read child | `$$("x").get("child")` | `fx!("x").get("child")` |
| Settle | `fx.settle(node)` | `fx.settle(&node)` |
| Watch | `$$("x").watch(cb)` | `fx!("x").watch(cb)` |
