// app-plus.js — FX Mini Plus playground wiring (see plus.html for the markup)
//
// One import upgrades everything:  $ gains the full jQuery-parity API, effects,
// sync ajax, and the reactive superpowers; $computed/$list/$persist/$history
// arrive as globals. Everything below is SYNCHRONOUS — no await anywhere.

import "./fx/fx-mini-plus.js";
const { $$, $, $computed, $list, $persist, $history } = window;

// ── on-page logger ───────────────────────────────────────────────────
const logEl = document.getElementById("log");
function log(msg, cls = "") { const d = document.createElement("div"); d.innerHTML = cls ? `<span class="${cls}">${msg}</span>` : msg; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }
const ok = (m) => log("✓ " + m, "ok");
const err = (w, e) => log(`✗ ${w}: ${e && e.message ? e.message : e}`, "err");
const step = (n, fn) => { try { fn(); } catch (e) { err(n, e); } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

log(`<span class="k">FX Mini Plus</span> booted — $ upgraded (${$.__fxPlus}), v${window.$fxp.version}`);

// ── 1. Reactive todo: bindEach + $list + $computed + $persist + $history ──
step("1 todo", () => {
  if (!Array.isArray($$("todo.items").get())) $$("todo.items").set([]);
  $persist("todo.items", { debounce: 120 });          // reload the page — it remembers
  $history.track("todo.items", { limit: 50 });

  $("#todoList").bindEach("todo.items", {
    key: (t) => t.id,
    empty: `<li class="muted">Nothing yet — add your first todo above.</li>`,
    render: (t) => `
      <li class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
        <input class="tgl" type="checkbox" ${t.done ? "checked" : ""} />
        <span>${esc(t.text)}</span>
        <button class="del" title="remove">×</button>
      </li>`,
  });

  const add = () => {
    const text = $("#todoText").val().trim();
    if (!text) return;
    $list("todo.items").push({ id: Date.now(), text, done: false });
    $("#todoText").val("").focus();
  };
  $("#todoAdd").on("click", add);
  $("#todoText").on("keydown", (e) => { if (e.key === "Enter") add(); });

  // delegated events keep working across every re-render
  $("#todoList").on("click", ".del", function () {
    const id = Number($(this).closest(".todo").data("id"));
    $list("todo.items").removeWhere((t) => t.id === id);
  });
  $("#todoList").on("change", ".tgl", function () {
    const id = Number($(this).closest(".todo").data("id"));
    $list("todo.items").updateWhere((t) => t.id === id, (t) => ({ ...t, done: !t.done }));
  });

  $("#clearDone").on("click", () => $list("todo.items").removeWhere((t) => t.done));
  $("#undoBtn").on("click", () => $history.undo("todo.items") || log("nothing to undo"));
  $("#redoBtn").on("click", () => $history.redo("todo.items") || log("nothing to redo"));

  $computed("todo.stats", ["todo.items"], (items) => {
    const list = Array.isArray(items) ? items : [];
    return `${list.filter((t) => !t.done).length} open / ${list.length} total`;
  });
  $("#todoStats").text($$("todo.stats"));             // computed node binds like any node
  ok("todo wired: bindEach + $list + $computed + $persist + $history");
});

// ── 2. Effects ───────────────────────────────────────────────────────
step("2 effects", () => {
  const box = () => $("#fxbox");
  $("#fxFade").on("click", () => box().fadeOut(350).fadeIn(350, () => ok("fade queue done")));
  $("#fxSlide").on("click", () => box().slideUp(300).slideDown(300, () => ok("slide queue done")));
  $("#fxPulse").on("click", () => box().animate({ width: "+=80" }, 250).animate({ width: 120 }, 250));
  $("#fxChain").on("click", () =>
    box().fadeOut(250).fadeIn(250).delay(150).slideUp(250).slideDown(250)
      .animate({ width: 320, opacity: 0.5 }, 350).animate({ width: 120, opacity: 1 }, 350,
        () => ok("6-step chain finished — one call site, zero callbacks nested")));
  $("#fxStop").on("click", () => { box().stop(true); $("#fxInfo").text(`stopped at width ${Math.round(box().width())}px`); });
  $("#fxTop").on("click", () => $("html").animate({ scrollTop: 0 }, 500));
  ok("effects wired (WAAPI, queued, sync API)");
});

// ── 3. Sync AJAX ─────────────────────────────────────────────────────
step("3 ajax", () => {
  $("#team").bindEach("api.team.people", {
    key: (p) => p.name,
    empty: `<li class="pill">no team loaded yet</li>`,
    render: (p) => `<li><b>${esc(p.name)}</b> — ${esc(p.role)}</li>`,
  });
  $("#ajaxGet").on("click", () => {
    const data = $$("api.team@/data.json").get();     // node-first: suspends, fills node, returns body
    $("#ajaxOut").text(`returned ${data.people.length} people — api.team filled, list below is live`);
    ok(`$$("api.team@/data.json").get() suspended, replayed, fanned out to #team`);
  });
  $("#ajaxLoad").on("click", () => { $("#pageHost").load("/page.html section"); ok(".load() injected + hydrated"); });
  $("#ajax404").on("click", () => {
    const env = $.http({ url: "/definitely-missing.json" });
    $("#ajaxOut").text(`envelope: ok=${env.ok} status=${env.status} (no exception thrown)`);
  });
  ok("ajax wired ($.get / .load / $.http)");
});

// ── 4. Forms ─────────────────────────────────────────────────────────
step("4 forms", () => {
  $("#demoForm").bindForm("demo.form");
  $computed("demo.formJson", ["demo.form.name", "demo.form.plan", "demo.form.notify"],
    (name, plan, notify) => JSON.stringify({ name: name ?? "", plan: plan ?? "free", notify: !!notify }));
  $("#formOut").text($$("demo.formJson"));
  $("#submitBtn").enableWhen("demo.form.name", (v) => typeof v === "string" && v.trim().length > 2);
  $("#demoForm [name=name]").classWhen("invalid", "demo.form.name", (v) => !v || v.trim().length <= 2);
  $("#submitBtn").on("click", () => { $("#serOut").text($("#demoForm").serialize()); ok("serialized: " + $("#demoForm").serialize()); });
  ok("form bound two-way to demo.form.* (+ enableWhen/classWhen)");
});

// ── 5. jQuery parity ─────────────────────────────────────────────────
step("5 parity", () => {
  let chips = 0, nsHits = 0;
  $("#chipAdd").on("click", () => {
    $(`<li>chip ${++chips}</li>`).appendTo("#parityList");
    $("#parityOut").text(`${$("#parityList li")?.length ?? 1} chip(s)`);
  });
  $("#chipOdd").on("click", () => {
    $("#parityList li")?.removeClass("hot");
    $("#parityList li")?.odd()?.addClass("hot");
    ok(".odd().addClass('hot') applied");
  });
  $("#chipNs").on("click", () => {
    $(document).off(".demo").on("click.demo", "#parityList li", function () {
      $("#parityOut").text(`delegated click.demo → "${$(this).text()}" (${++nsHits} hits)`);
    });
    ok("delegated click.demo bound on document — click a chip");
  });
  $("#chipOffNs").on("click", () => { $(document).off(".demo"); ok('off(".demo") — namespace torn down'); });
  $("#chipOnce").one("click", function () { $(this).text("clicked once — handler gone"); });
  $("#parityList").hover(() => $("#parityOut").addClass("hot"), () => $("#parityOut").removeClass("hot"));
  ok("parity wired: creation/appendTo/odd/one/hover/namespaces");
});

// ── 6. Snippet libraries — $(selector, context) ──────────────────────
step("6 snippets", () => {
  const snippets = () => $$("@/snippets.html");        // sync + cached by the loader
  $("#snipUser").on("click", () => {
    $("#user-card", snippets()).removeAttr("id").appendTo("#snipHost");
    $("#snipOut").text(`${$("#snipHost").children().length ?? 1} stamp(s)`);
  });
  $("#snipAlert").on("click", () => {
    $("#alert-card", snippets()).removeAttr("id").appendTo("#snipHost");
    $("#snipOut").text(`${$("#snipHost").children().length ?? 1} stamp(s)`);
  });
  $("#snipName").pipe("input", "snip.user");           // stamps use $${"snip.user"} — all update live
  ok("snippet library wired — one file, many stamps, reactive after insert");
});

// ── 7. fxc components ────────────────────────────────────────────────
step("7 fxc", () => {
  $("#cmpLoad").one("click", () => {
    $fxc.load("/components.html");                     // registers <fxc-badge>, <fxc-stat>
    $("#cmpHost").append(`
      <fxc-badge $label="beta" $node="badge.hero"><span>← a slot child</span></fxc-badge>
      <fxc-stat $value="0" $node="stat.todos"><span slot="label">todos</span></fxc-stat>`);
    window.$computed("fxc.stat.todos.value", ["todo.items"],
      (items) => (Array.isArray(items) ? items.length : 0));   // component prop ← computed node
    $("#cmpLabel").pipe("input", "fxc.badge.hero.label");
    $("#cmpOut").text("props live at fxc.badge.hero / fxc.stat.todos — add todos in panel 1!");
    ok("fxc components stamped — badge label is a live prop, stat.value is computed");
  });
});

// ── 8. $.fn plugin bridge ────────────────────────────────────────────
step("8 $.fn", () => {
  $("#fnDemo").on("click", () => {
    $.fn.flash = function (color = "#f59e0b") {
      return this.animate({ borderColor: color }, 150).animate({ borderColor: "#1f2b28" }, 400);
    };
    const rows = $("#todoList li.todo");
    if (!rows) { $("#fnOut").text("add a todo first, then flash it"); return; }
    rows.flash();
    $("#fnOut").text(`$.fn.flash ran on ${rows.length ?? 1} row(s)`);
    ok("$.fn.flash registered once, ran on a whole group");
  });
});

log(`<span class="k">Ready.</span> Every panel is wired in <span class="k">app-plus.js</span> — no async, no build.`);
