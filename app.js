// app.js — FX Mini playground
//
// Importing the framework runs its bootstrap, publishing the globals used here:
//   $$   reactive node graph        $$("path").set(v) / .get() / .watch(fn) / .as(Ctor)
//   $    reactive jQuery            $("#id").text(...) / .css(...) / .on(...)
//   fx   the FXCore instance
//
// The star of this build is the @-syntax: it loads files SYNCHRONOUSLY and can
// mount modules onto the node graph, expose them as globals, or graft classes.

import "./fx/fx-mini.js";
const { $$, $, fx } = window;

// ── on-page logger ───────────────────────────────────────────────────
const logEl = document.getElementById("log");
function log(msg, cls = "") { const d = document.createElement("div"); d.innerHTML = cls ? `<span class="${cls}">${msg}</span>` : msg; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }
const ok = (m) => log("✓ " + m, "ok");
const err = (w, e) => log(`✗ ${w}: ${e && e.message ? e.message : e}`, "err");
const step = (n, fn) => { try { fn(); } catch (e) { err(n, e); } };

log(`<span class="k">FX Mini</span> booted — $$ ${typeof $$}, $ ${typeof $}, fx ${typeof fx}`);

// ── 1. Reactive graph + $ ────────────────────────────────────────────
step("1 reactive + $", () => {
  $$("app.count").set(0);
  $("#count").text($$("app.count"));                 // reactive bind (pass the node)
  $("#inc").on("click", () => $$("app.count").set($$("app.count").get() + 1));
  $("#reset").on("click", () => $$("app.count").set(0));
  $("#paint").on("click", () => { $(".card").css({ "border-color": "#2dd4bf", "background": "#0f1d1a" }); ok("$('.card') group painted"); });
  ok("counter bound to $$('app.count')");
});

// ── 2. Load a module as a global — .options({ global }) ──────────────
step("2 module→global", () => {
  $("#loadPlugin").on("click", () => {
    try {
      $$("@/plugins/greeter.js").options({ global: "$greeter" });   // loads + invokes factory
      const msg = window.$greeter.hello("FX");
      $("#pluginOut").text(`$greeter.hello("FX") → "${msg}"  (v${window.$greeter.version})`);
      ok(`loaded greeter.js → global $greeter (${typeof window.$greeter})`);
    } catch (e) { err("load greeter.js", e); }
  });
});

// ── 3. Mount a module onto a node path — node@path ───────────────────
step("3 module→node", () => {
  $("#mountMod").on("click", () => {
    try {
      $$("app.tools@/plugins/greeter.js").options({ global: "$tools" });
      $("#mountOut").text(`$tools.hello("node") → "${window.$tools.hello("node")}"  ·  node app.tools mounted`);
      ok("mounted greeter.js onto app.tools + global $tools");
    } catch (e) { err("mount onto app.tools", e); }
  });
});

// ── 4. Class graft — .as(Client) with reactive sub-nodes ─────────────
step("4 class graft", () => {
  $("#graft").on("click", () => {
    try {
      const Client = $$("@/models/Client.js").ns.default;   // reach the class off the binding
      const client = $$("app.client").as(Client);           // graft: type→Client, fields→sub-nodes
      // The instance's fields are now reactive sub-nodes. Bind inputs to them:
      $("#first").val($$("app.client.first"));
      $("#last").val($$("app.client.last"));
      $("#first").on("input", (e) => $$("app.client.first").set(e.target.value));
      $("#last").on("input", (e) => $$("app.client.last").set(e.target.value));
      // Re-render fullname whenever a sub-node changes (client.fullname() reads the sub-nodes):
      const render = () => $("#fullname").text(client.fullname());
      $$("app.client.first").watch(render);
      $$("app.client.last").watch(render);
      render();
      document.getElementById("clientFields").style.display = "flex";
      $("#graftInfo").text(`node type → "${$$("app.client").type()}" · fields first/last/role are reactive sub-nodes`);
      ok(`grafted Client → $$("app.client").as("Client").fullname() = "${$$("app.client").as("Client").fullname()}"`);
    } catch (e) { err("graft Client", e); }
  });
});

// ── 5. Synchronous text + module — $$("@./file") ─────────────────────
step("5 sync text/module", () => {
  $("#loadHtml").on("click", () => {
    try { $("#frag").html($$("@./partial.html")); ok("injected @./partial.html (text)"); }
    catch (e) { err("load partial.html", e); }
  });
  $("#loadPage").on("click", () => {
    try { $("#host").html($$("@/page.html")); ok("injected @/page.html into #host"); }
    catch (e) { err("load page.html", e); }
  });
  $("#loadMod").on("click", () => {
    try {
      const mod = $$("@./greet.js");
      const fn = mod.greet || (mod.default && mod.default.greet);
      $("#modout").text(typeof fn === "function" ? fn("FX Mini") : String(fn));
      ok("loaded @./greet.js (module)");
    } catch (e) { err("load greet.js", e); }
  });
});

// ── 6. Two-way bind shorthand — $("#el", $$(node)) ───────────────────
step("6 two-way bind", () => {
  $("#field", $$("bind.demo"));                 // ← the whole binding, in one call
  // mirror the node value reactively so you can see it update both ways
  $("#bindMirror").text($$("bind.demo"));
  $("#setFromCode").on("click", () => { $$("bind.demo").val("set from code"); ok(`node → input: "${$$("bind.demo").get()}"`); });
  $$("bind.demo").set("");
  ok('bound #field ↔ $$("bind.demo") with $("#field", node)');
});

// ── 7. Node links — call grafted methods through a link ──────────────
step("7 node link", () => {
  $("#linkBtn").on("click", () => {
    try {
      // ensure app.client is grafted (panel 4 may not have run)
      if (!($$("app.client").type && $$("app.client").type() === "Client")) {
        $$("app.client").as($$("@/models/Client.js").ns.default);
      }
      $$("app.mirror", $$("app.client"));                 // LINK
      const via = $$("app.mirror").fullname();            // method through the link
      const sub = $$("app.mirror.fullname")();            // sub-path form
      $("#linkOut").text(`$$("app.mirror").fullname() → "${via}"   (sub-path → "${sub}")`);
      ok(`linked app.mirror → app.client; method resolves through link`);
    } catch (e) { err("node link", e); }
  });
});

// ── 8. Declarative templating — the input drives the $${} in the HTML ─
step("8 templating input", () => {
  $("#tplName", $$("tpl.name"));   // two-way; the $${"tpl.name"|…} nodes update reactively
  ok('bound #tplName ↔ $$("tpl.name") — edits update the declarative $${} above');
});

log(`<span class="k">Ready.</span> Click through the panels — every call is in <span class="k">app.js</span>.`);
