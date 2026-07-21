# Value Bag Patterns

The FX value bag is a `HashMap<String, FXValue>` stored on every node. Combined with `__type` selection and `as_named(get_type())` resolution, the bag turns every node into a multiplexer that can present different values depending on context -- switching in O(1) without recomputation.

This page documents 11 patterns that exploit the bag, plus the meta-pattern they all share.

---

## How the Bag Works

Every FX node stores its value as a bag of named entries:

```
node.__value = {
    "raw":     FXValue::String("42"),
    "num":     FXValue::Number(42.0),
    "string":  FXValue::String("42"),
    "boolean": FXValue::Bool(true),
}
```

The `__type` field selects which entry is the "active" value. Reading the node's value calls `as_named(get_type())`, which looks up the `__type` key in the bag and returns that entry.

Patterns below add custom keys alongside the standard `raw`, `num`, `string`, `boolean` entries.

---

## Pattern 1: Hot-Swap Branching

Store multiple branch results in the bag. `__type` selects the active one.

**Bag contents:**

| Key | Value |
|---|---|
| `branch_true` | `"<b>Active</b>"` |
| `branch_false` | `"<i>Inactive</i>"` |
| `raw`, `string`, `boolean` | (standard coercions) |

```
__type = "branch_true"   <-- entangled to a condition via AtomicsPlugin
```

Flip `__type` and the output changes instantly. No re-evaluation. The condition (e.g., an XPath test) is evaluated once; both branches are pre-computed and stored. The active branch is selected at read time.

---

## Pattern 2: Output Format Multiplexing

Same source data, multiple output formats sitting in the bag simultaneously.

**Bag contents:**

| Key | Value |
|---|---|
| `html` | `<p class="title">Hello</p>` |
| `xml` | `<title>Hello</title>` |
| `text` | `Hello` |
| `json` | `{"title": "Hello"}` |
| `raw`, `string`, `boolean` | (standard coercions) |

```
__type = "html"   <-- entangled to output method setting
```

When the output method changes from `"html"` to `"text"`, every output node switches format without re-running any transform. The visual builder can show an HTML preview and raw XML source simultaneously -- they are just two keys in the same bag.

**Cost**: The first pass builds all formats (just string construction, no re-evaluation of expressions). Switching between them afterward is free.

---

## Pattern 3: XPath Memo Bags

Cache XPath evaluation results directly in the node's bag, keyed by the expression.

**Bag contents:**

| Key | Value |
|---|---|
| `raw` | `"Chapter 1"` |
| `string` | `"Chapter 1"` |
| `xpath:string-length(.)` | `Number(9.0)` |
| `xpath:contains(., 'Chapter')` | `Bool(true)` |
| `xpath:position()` | `Number(1.0)` |

```rust
// Before evaluating an XPath expression:
let cache_key = format!("xpath:{}", expression);
if let Some(cached) = context_node_proxy.as_named(&cache_key) {
    return cached;  // O(1) lookup, no evaluation
}

// After evaluating:
let mut bag = context_node_proxy.bag().unwrap();
bag.set(&cache_key, result.clone());
```

The cache lives with the node it was computed on. When the node's value changes, you can invalidate by removing `xpath:*` keys. If the node has not changed, cached results remain valid.

**Pairs with TimeTravelPlugin**: When you roll back, the bag rolls back too, so cached results are always consistent with the state they were computed in.

---

## Pattern 4: Cascade Resolution

When multiple templates match the same node, store all match results in the bag, keyed by template identity and priority.

**Bag contents:**

| Key | Value |
|---|---|
| `match:*[priority=0.5]` | `<div>Generic</div>` |
| `match:chapter[priority=1.0]` | `<section>Chapter</section>` |
| `match:chapter[@id][priority=2.0]` | `<section id='ch1'>Specific Chapter</section>` |
| `raw`, `string`, `boolean` | (standard coercions) |

```
__type = "match:chapter[@id][priority=2.0]"   <-- highest priority wins
```

**Debugging**: The time-travel debugger shows all candidate templates and their results. Click a different one and the output switches. You can answer "what would happen if this template didn't exist?" without re-running.

**Editing**: Changing a template's `match` pattern does not require a full re-transform. Re-evaluate which template wins for affected nodes, flip `__type`, and the pre-computed result is already there.

---

## Pattern 5: Conditional Attribute Sets

An element's attributes vary based on context. Store multiple attribute sets in the bag.

**Bag contents:**

| Key | Value |
|---|---|
| `attrs:light` | `class="card bg-white text-dark"` |
| `attrs:dark` | `class="card bg-dark text-white"` |
| `attrs:print` | `class="card no-border"` |
| `raw`, `string`, `boolean` | (standard coercions) |

```
__type = "attrs:dark"   <-- entangled to ui.theme
```

A theme toggle flips one atomics-entangled value. Every element node's attribute set switches. The full HTML re-renders from the output tree without touching the transform engine.

---

## Pattern 6: Streaming Assembly with Numbered Slots

The bag accumulates partial results as a transform progresses, enabling progressive rendering.

**Bag contents:**

| Key | Value |
|---|---|
| `slot:0` | `<html><head>` |
| `slot:1` | `<title>My Page</title>` |
| `slot:2` | `</head><body>` |
| `slot:3` | (not yet computed) |
| `raw`, `boolean` | (standard coercions) |

Each time a new `slot:N` key appears in the bag, the relay can stream it as a delta patch. The UI renders a partial document while the transform is still running.

Assembly is straightforward: iterate `slot:` keys in numeric order. Missing slots are skipped or show a placeholder.

**Use case**: Large documents where you want progressive rendering rather than waiting for the entire transform to complete.

---

## Pattern 7: Validation Alongside Value

Store the validation state right in the bag with the value.

**Bag contents:**

| Key | Value |
|---|---|
| `raw` | `"2026-13-45"` |
| `string` | `"2026-13-45"` |
| `num` | `NaN` |
| `boolean` | `true` |
| `valid` | `Bool(false)` |
| `error` | `"Invalid date: month 13"` |
| `schema` | `"xs:date"` |
| `suggestion` | `"2026-01-15"` |

No separate validation pass needed. The debugger shows validation state inline. The visual builder can red-highlight invalid nodes by reading `as_named("valid")`.

---

## Pattern 8: Undo Stack in the Bag

Store previous values in the bag itself for per-node undo, without requiring full tree snapshots.

**Bag contents:**

| Key | Value |
|---|---|
| `raw` | `"current value"` |
| `string` | `"current value"` |
| `boolean` | `true` |
| `prev:1` | `"previous value"` |
| `prev:2` | `"value before that"` |
| `prev:t` | `Number(1710456000000.0)` (timestamp of last change) |

Flip `__type` to `"prev:1"` to see the previous state of just that one node in the output. This gives per-node undo without a full tree snapshot from TimeTravelPlugin.

---

## Pattern 9: Multi-Language Output

For internationalized transforms, store all language versions in the bag.

**Bag contents:**

| Key | Value |
|---|---|
| `lang:en` | `"Welcome"` |
| `lang:fr` | `"Bienvenue"` |
| `lang:de` | `"Willkommen"` |
| `lang:ja` | (Japanese translation) |
| `raw`, `string`, `boolean` | (standard coercions) |

```
__type = "lang:en"   <-- entangled to ui.locale
```

Language switch is instant. No re-transform. No lookup tables. Translations are computed once during the transform and sit in the bag.

---

## Pattern 10: Flow Step Recording

Each flow step records its contribution to the output in the bag, creating a full provenance chain.

**Bag contents:**

| Key | Value |
|---|---|
| `raw` | `"<p>Hello World</p>"` |
| `string` | `"<p>Hello World</p>"` |
| `boolean` | `true` |
| `flow:step_42` | `"Created <p> element"` |
| `flow:step_43` | `"Set text content 'Hello'"` |
| `flow:step_87` | `"Appended ' World'"` |
| `flow:trace_id` | `"t_abc123"` |
| `flow:rule` | `"text"` |
| `flow:template` | `"match='greeting'"` |

The debugger can show exactly which flow steps contributed to this output node. Click a step to time-travel to that moment. Full provenance: "this `<p>` was created by step 42 (template 'greeting'), text added by step 43 (rule 'text'), more text by step 87 (rule 'value-of')".

---

## Pattern 11: Embed (Node Tree as Value)

One node tree becomes the `__value` of another. The host node becomes a transparent portal -- navigation steps through into the embedded tree's children.

### The Problem

`$$("path").set($$("other").node())` grafts the node's fields as children (not what you want). `$$("path").set($$("other"))` creates a reactive link (also not what you want). You need a way to say "store this node reference as-is".

### The Solution: `.this()`

```javascript
// TypeScript
$$("portal").val($$("source.tree").this());

// Rust
fx!("portal").val_set(fx!("source.tree").this());
```

`.this()` returns a marker that tells `set()`: store this node as-is. No grafting, no reactive watcher.

**Bag contents:**

| Key | Value |
|---|---|
| `raw` | `NodeRef(source.tree)` |
| `FXNode` | `NodeRef(source.tree)` |
| `string` | `"[FXNode embed $.source.tree]"` |
| `boolean` | `true` |

```
__type = "embed"
```

### How Navigation Works

At each step of path resolution, the proxy checks `__value` first. If it is a `NodeRef`, it steps into the referenced node:

```rust
fx!("source.data.x").val_set(10);
fx!("source.data.y").val_set(20);
fx!("portal").val_set(fx!("source.data").this());

fx!("portal").get("x");          // 10 -- stepped through portal
fx!("portal").get("y");          // 20
fx!("portal").child("x").num();  // 10.0
```

The portal is transparent. Code navigating through `portal.x` does not know it is going through an embed.

### Embed vs Link vs Graft

| | `.this()` Embed | `.set_link()` Link | `.set(Object)` Graft |
|---|---|---|---|
| **Stores in bag** | NodeRef | NodeRef + watcher | Nothing (grafts children) |
| **`__type`** | `"embed"` | `"link"` | `"object"` |
| **Navigate children** | Yes (auto-step-into) | No (use `deref_value()`) | Yes (own children) |
| **Reactive** | No watcher | Yes (value propagation) | No |
| **Same data** | Yes (shared reference) | Yes (shared + watched) | No (copied into children) |

### Use Cases

**DOM mounting**: Mount an XML document's parsed DOM tree as the value of a context node. Navigation walks through the embed transparently.

```rust
fx!("xslt.context").val_set(fx!("xslt.core.input.dom").this());
// xslt.context.children navigates the actual DOM tree
```

**Scope aliasing**: A child scope's variables embed the parent scope. Variable lookup walks through into the parent's variable nodes.

```rust
fx!("scope.child.vars").val_set(fx!("scope.parent.vars").this());
// scope.child.vars.myVar resolves to scope.parent.vars.myVar
```

**Template composition**: An output node's content embeds a pre-rendered template fragment. Multiple output nodes can share the same fragment without copying.

**Virtual paths**: Create short aliases for deep paths.

```rust
fx!("$app").val_set(fx!("system.runtime.application.current").this());
// $app.name -> system.runtime.application.current.name
```

### Combined with Hot-Swap Branching

An embed can point to different trees based on `__type`:

| Key | Value |
|---|---|
| `branch_a` | `NodeRef(tree_a)` |
| `branch_b` | `NodeRef(tree_b)` |
| `raw` | `NodeRef(tree_a)` |

```
__type = "branch_a"   <-- entangled to some condition
```

When `__type` flips, `as_type(get_type())` returns a different `NodeRef`, and navigation follows a different tree. Two entire subtrees, switchable in O(1).

---

## The Meta-Pattern

All 11 patterns follow the same shape:

1. **Store multiple representations** in the bag under named keys.
2. **Select the active one** via `__type` (or a custom key).
3. **Switch instantly** by changing `__type` -- no recomputation.
4. **Entangle** the selector to an external signal via AtomicsPlugin.
5. **Resolve** with `as_named(get_type())` at read time.

The bag turns every node into a **multiplexer**. The node tree is not just data -- it is a switchboard where every node can present different faces depending on context, and switching between faces is O(1).

This is fundamentally different from traditional engines where each value is a single scalar and changing anything requires re-evaluation. In FX, evaluation happens once and selection happens at read time.

### Quick Reference

| Pattern | Key Prefix | Switched By | Use Case |
|---|---|---|---|
| Hot-Swap Branching | `branch_*` | Condition | Conditional output |
| Output Format Multiplexing | `html`, `xml`, `text`, `json` | Output method | Multi-format rendering |
| XPath Memo Bags | `xpath:*` | (read-only cache) | Expression caching |
| Cascade Resolution | `match:*` | Priority | Template selection |
| Conditional Attribute Sets | `attrs:*` | Theme / context | Theming |
| Streaming Assembly | `slot:*` | (append-only) | Progressive rendering |
| Validation Alongside Value | `valid`, `error`, `schema` | (read-only) | Inline validation |
| Undo Stack | `prev:*` | User action | Per-node undo |
| Multi-Language Output | `lang:*` | Locale | Internationalization |
| Flow Step Recording | `flow:*` | (read-only) | Debugging / provenance |
| Embed | `FXNode` | `"embed"` / branch | Node tree as value |
