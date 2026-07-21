# FX Mini — Start Here

A **single-file** reactive framework: the FX reactive node graph + a reactive
jQuery (`$`) + **synchronous** file loading — with no build step and no
dependencies. Think "jQuery, but every value is a live reactive node, and you can
`require` files synchronously in the browser."

You just ran `fxm mini`, which dropped this project into the current folder and
started a dev server. Open the URL it printed (default
**http://localhost:8787/**) — the page you see is a live playground of every
feature.

---

## What got installed

```
.
├─ index.html        ← the playground page (markup only)
├─ app.js            ← the demo logic — READ THIS FIRST
├─ data.json         ← sample data (loaded synchronously)
├─ partial.html      ← sample HTML fragment (loaded synchronously)
├─ greet.js          ← sample JS module (loaded synchronously)
├─ START_HERE.md     ← this file
├─ plus.html         ← the FX Mini PLUS playground (jQuery parity, effects, components…)
├─ app-plus.js       ← the plus demo logic
├─ snippets.html     ← snippet library used by the plus demo
├─ components.html   ← fxc component library used by the plus demo
├─ docs/             ← reference docs (kernel, dom-dollar, module loader, mini-plus)
└─ fx/
   ├─ fx-mini.js     ← the framework, browser-ready ESM (this is what you import)
   ├─ fx-mini.min.js ← minified build (~39 KB) for production
   ├─ fx-mini.ts     ← the TypeScript source, for reading/hacking
   ├─ fx-mini-plus.js ← the PLUS layer entry — import this instead to get the extras
   └─ plus/          ← the plus modules (jQuery API, effects, ajax, fxc, computed…)
```

Nothing here is generated at runtime. `fxm.exe` is just a static dev server; the
framework is plain JS your browser loads directly.

---

## What FX Mini gives you

### 1. `$$` — the reactive node graph

Every value lives at a dotted path and is reactive.

```js
$$("app.count").set(0);          // write
$$("app.count").get();           // read (snapshot)
$$("app.count").watch(() => {    // react to changes
  console.log("count is now", $$("app.count").get());
});
$$("app.count").set(5);          // fires every watcher + every bound DOM node
```

### 2. `$` — reactive jQuery (dom-dollar)

Standard jQuery ergonomics, plus **reactive binding**: pass a node instead of a
value and the DOM tracks it automatically.

```js
$("#title").text("hello");            // set text
$(".card").addClass("active");        // works on groups (all matches)
$("#box").css({ color: "red", width: 200 });   // numbers → px automatically
$("#btn").on("click", () => { ... }); // events

// Reactive: pass the NODE, not .get()
$("#title").text($$("app.count"));    // #title now always shows app.count
$$("app.count").set(42);              // #title updates itself
```

> **Gotcha:** `$("#x").text($$("a.b"))` binds reactively (auto-updates).
> `$("#x").text($$("a.b").get())` sets a one-time snapshot. The difference is
> `.get()`.

**Two-way binding in one line** — pass a node as the *second* argument to `$()`:

```js
$("#field", $$("form.email"));       // form controls bind BOTH ways:
                                     //   user edits  → $$("form.email")
$$("form.email").val("hi@x.com");    //   code sets   → the input updates
```

(Non-form elements get a reactive one-way text bind. Works on groups too.)

### 3. `@`-syntax — synchronous loading, mounting &amp; grafting

The `@` prefix loads a file **synchronously** (no `await`), even in the browser.
This is the heart of FX. There are four things you can do with it.

**a) Load raw text / a module by extension:**

```js
const html = $$("@./partial.html");  // → file text (also .md/.css/.svg/.xml)
const mod  = $$("@./greet.js");      // → evaluated module; use mod.greet(...)
```

**b) Load a module and publish it as a global — `.options({ global })`:**

```js
// plugins/greeter.js default-exports a factory (fx, opts) => api
$$("@/plugins/greeter.js").options({ global: "$greeter" });
$greeter.hello("FX");                // the factory's return value is now $greeter
```

**c) Mount a module onto a node path — `node.path@/file`:**

```js
$$("app.tools@/plugins/greeter.js").options({ global: "$tools" });
// the module's namespace is grafted onto the node app.tools *and* exposed as $tools
```

**d) Graft a class onto a node — `.as(Ctor)`:**

```js
// models/Client.js default-exports  class Client { fullname() {…} }
const Client = $$("@/models/Client.js").ns.default;  // reach the class off the binding
const client = $$("app.client").as(Client);          // GRAFT

// .as() sets the node TYPE, registers the class methods, and maps every
// instance field to a REACTIVE SUB-NODE with two-way sync:
$$("app.client").type();             // "Client"
$$("app.client.first").set("Grace"); // → client.fullname() now returns "Grace …"
$$("app.client").as("Client").fullname();  // read the live instance back any time
```

You can also load + instantiate in one call:
`$$("app.user@/models/Client.js").options({ instantiateDefault: { args: ["Ada","Lovelace"] }, global: "$user" })`
— note that `instantiateDefault` builds the instance but only `.as(Ctor)` wires up
the two-way field⟷sub-node sync.

**JSON** (the `@`-syntax treats `.json` as an HTTP binding, so parse it yourself):

```js
const loadJSON = (p) => JSON.parse(fx.moduleLoader.loadSync(p));
const data = loadJSON("./data.json");   // { title, people }
```

**e) Link one node to another** — pass a node as a *value*. Grafted methods
resolve **through** the link, and it stays live:

```js
$$("app.client").as(Client);          // graft
$$("app.mirror", $$("app.client"));   // link mirror → client
$$("app.mirror").fullname();          // method resolves through the link
$$("app.mirror.fullname")();          // …or via the sub-path
$$("app.client.first").set("Grace");  // mutating the source shows through the link
```

### 4. Declarative HTML templating (auto-hydrated)

On load, fx-mini scans the page and wires three declarative features — no JS
required. (Re-run manually after inserting HTML with `$hydrate(el)`.)

**Reactive `$${…}` interpolation** in text and attributes, with `|` fallbacks
and nesting:

```html
<div>$${"user.name"}</div>                              <!-- reactive node value -->
<div>$${"user.name" | "Anonymous"}</div>                <!-- default when unset/empty -->
<div>$${"user.name" | $${"user.alt" | "Anonymous"}}</div> <!-- nested default -->
```

**Single-brace `{…}`** for a node path or an imported global's field:

```html
<div>{form.title}</div>          <!-- reactive node path -->
<input value="{form.title}" />   <!-- attributes too (form value stays live) -->
```

**`<import>`** loads a module synchronously and (optionally) grafts + globals it:

```html
<import src="./models/Client.js" global="$client" />
<div>{$client.first} {$client.last}</div>   <!-- reactive: import grafts to a node -->
```

`<import>` forms: `src="./x.js"` (module only), `+ global="$x"` (publish a global —
a class is instantiated, and its fields become reactive sub-nodes so `{$x.field}`
stays live), `+ as="app.x"` (graft onto an explicit node path). The `<import>`
marker is removed after loading (its children are preserved).

> **Attribute quoting gotcha:** don't put double-quotes inside a double-quoted
> attribute — `value="$${"a"|"b"}"` breaks HTML parsing. Use `{…}` in attributes,
> or single-quote the attribute: `value='$${"a"|"b"}'`.

**How synchronous loading works in the browser:** on the UI thread FX uses a
blocking `XMLHttpRequest`; where `SharedArrayBuffer` is available it can use a
worker + `Atomics.wait` fast-path. Either way your code reads like it's local.
That's why FX Mini needs a server (the `@`-loader fetches over HTTP) — open the
files through `fxm serve`, not `file://`.

---

## Everyday workflow

```bash
fxm serve          # start the dev server again in this folder
fxm serve --port 3000   # different port
```

1. Edit `app.js` (or add your own `.js`).
2. Refresh the browser. No build, no bundler.
3. Read `index.html` to see the markup hooks and `app.js` for the wiring.

To ship: use `fx/fx-mini.min.js` and your own HTML/JS. It's a static site — host
it anywhere.

---

## `fxm` commands

| Command | What it does |
|---|---|
| `fxm mini` | Install the playground into the current folder **and** start the dev server. |
| `fxm serve` | Start the dev server for an already-installed folder. |
| `fxm mini --force` | Overwrite existing files when installing. |
| `fxm serve --port N` | Serve on port N (default 8787). |
| `fxm --help` | Show help. |

---

## FX Mini Plus — the optional enhancement layer

One import upgrades `$` in place with the **whole everyday jQuery API** and a set
of reactive superpowers — and everything stays **synchronous**:

```js
import "./fx/fx-mini-plus.js";   // instead of "./fx/fx-mini.js" — that's the migration
```

You get: the missing jQuery methods (manipulation, traversal, filtering,
namespaced events, `.data`, dimensions, `serialize`…), WAAPI-backed effects
(`fadeIn`/`slideUp`/`animate`, queued per element), sync AJAX that rides the
kernel's suspend/replay so the UI thread is never blocked (`$$("node@url").get()`,
`$.ajax`, `.load()`), and the new reactive tools: `$computed` derived nodes,
`.bindEach` keyed list rendering + `$list` mutators, one-line `.bindForm`,
`$persist` (localStorage), `$history` undo/redo, snippet libraries via
`$(sel, context)`, and **`fxc` components whose props are graph sub-nodes**.

Open **`plus.html`** for a live playground of all of it, read `app-plus.js` for
the wiring, and see **`docs/30-fx-mini-plus.md`** for the full API reference.

---

## What's NOT in base Mini (added back by Plus, or only in full FX)

Base Mini is the trimmed kernel — it drops the VFS, plugin manager, selector
engine, reactive groups, and the server framework. The **Plus** layer adds back a
lot of the app-building surface (components/`fxc`, keyed lists, forms, effects,
sync AJAX). For routing, an ORM, WebSocket sync, XSLT components, etc., use the
full FX framework (`fx` CLI) — base Mini is the "reactive jQuery with a sync API"
slice, and Plus is that slice grown a full app toolkit.

Kept: reactive graph, `$`/`$dom`, `@`-syntax sync loading (JS/JSON/HTML),
suspend/replay, class-graft (`.as()`), and the config helper.

---

## Where to go next

- `docs/20-fx-dom-dollar.md` — the complete `$` API reference.
- `docs/30-fx-mini-plus.md` — the FX Mini Plus layer: jQuery parity, effects, sync AJAX, `$computed`, `bindEach`/`$list`, `bindForm`, `$persist`/`$history`, snippet contexts, and `fxc` components.
- `docs/01-kernel.md` — how the node graph works.
- `docs/03-module-loader.md` — the `@`-syntax and sync loader internals.
- `fx/fx-mini.ts` — the whole framework in one readable file.
- `plus.html` + `app-plus.js` — the plus playground and its wiring.

Happy hacking. — FX
