// fx/fx-mini-plus.js
//
// FX Mini Plus — drop-in enhancement layer for fx-mini.
// One import replaces your fx-mini import and upgrades `$` in place:
//
//   import "./fx/fx-mini-plus.js";     // instead of "./fx/fx-mini.js"
//
// Everything fx-mini already does keeps working ($$, @-syntax, hydration,
// two-way $(sel, node) binds). On top you get, still 100% synchronous:
//   • the missing everyday jQuery API (manipulation, traversal, filtering,
//     events with namespaces + .one/.hover/shortcuts, dimensions, .data,
//     serialize/serializeArray, $.each/$.extend/$.param…)
//   • jQuery-style effects on the Web Animations API (fade/slide/animate,
//     queued per element, .stop/.finish/.delay, reduced-motion aware)
//   • sync AJAX: $.get/$.post/$.getJSON/$.ajax/$.http + .load() — with
//     optional reactive "into" node targets
//   • reactive superpowers: $computed, .bind, .showWhen/.enableWhen/.classWhen,
//     .pipe, .bindEach keyed list rendering, $list mutators,
//     $persist (localStorage) and $history undo/redo
//   • $.fn plugin bridge and $("<li>…") element creation
//
// Globals published: $, $dom (upgraded), $computed, $list, $persist, $history, $fxp

import "./fx-mini.js";

import { log, FxLogger } from "./plus/logger.js";
import { FxTx } from "./plus/tx.js";
import { FxReplay } from "./plus/replay.js";
import { FxPlus } from "./plus/core.js";
import { FxEnv, FxBindings, FxReactive, FxDom, FxPlusError } from "./plus/kit.js";
import { FxUtil } from "./plus/util.js";
import { FxData } from "./plus/data.js";
import "./plus/attrs.js";
import "./plus/manipulation.js";
import "./plus/traversal.js";
import { FxEvents } from "./plus/events.js";
import { FxGeom } from "./plus/dimensions.js";
import { FxEffectQueue } from "./plus/effects-queue.js";
import { FxEffects } from "./plus/effects.js";
import { FxAjax, FxAjaxError } from "./plus/ajax.js";
import { FxApiBinding, installApiDollar } from "./plus/api.js";
import { FxContext } from "./plus/context.js";
import { fxc, FxcRegistry } from "./plus/fxc.js";
import { FxcCompile } from "./plus/fxc-compile.js";
import { FxcHydrator } from "./plus/fxc-hydrate.js";
import { FxForms } from "./plus/forms.js";
import { FxComputed, computed } from "./plus/reactive.js";
import { FxListBinder, FxList, list } from "./plus/list.js";
import { FxHistory, FxPersist, persist } from "./plus/store.js";

let $plus = null;

try {
  $plus = FxPlus.install();
  FxTx.hookGraph(globalThis.fx);   // replay transactions over graph writes
  installApiDollar();              // node-first HTTP: $$("node@url").get()/.post()/…
  globalThis.fxc = fxc;            // component base class (before any compilation)
  FxcHydrator.install();           // import= attrs, each/as loops, inline <fxc:*>

  const globals = {
    $fxc: {
      load: (url) => FxcRegistry.load(url),
      define: (html) => FxcRegistry.defineFrom(html),
      get: (name) => FxcRegistry.get(name),
      names: () => FxcRegistry.names(),
      hydrate: (root) => FxcHydrator.scan(root),
      processImports: (root) => FxcHydrator.scan(root), // kernel's .append() hook
    },
    $computed: computed,
    $list: list,
    $persist: persist,
    $history: FxHistory,
    $fxp: {
      version: FxPlus.VERSION,
      log,
      replay: FxReplay,
      tx: FxTx,
      classes: {
        FxPlus, FxEnv, FxBindings, FxReactive, FxDom, FxLogger, FxUtil, FxData,
        FxEvents, FxGeom, FxEffects, FxEffectQueue, FxAjax, FxAjaxError, FxApiBinding, FxContext,
        FxForms, FxComputed, FxListBinder, FxList, FxHistory, FxPersist, FxPlusError, FxReplay, FxTx,
        fxc, FxcRegistry, FxcCompile, FxcHydrator,
      },
    },
  };
  Object.assign(globalThis, globals);

  log.info(`ready — $ upgraded, globals: $computed $list $persist $history $fxp`);
} catch (e) {
  log.error("FX Mini Plus failed to install:", e);
  throw e;
}

export {
  FxPlus, FxEnv, FxBindings, FxReactive, FxDom, FxPlusError, FxLogger, log,
  FxUtil, FxData, FxEvents, FxGeom, FxEffects, FxEffectQueue, FxAjax, FxAjaxError,
  FxForms, FxComputed, FxListBinder, FxList, FxHistory, FxPersist, FxReplay, FxTx,
  FxApiBinding, installApiDollar, FxContext,
  fxc, FxcRegistry, FxcCompile, FxcHydrator,
  computed, list, persist,
};
export default $plus;
