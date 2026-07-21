// greet.js — a plain ES module loaded synchronously by the FX @-syntax.
// $$("@./greet.js") fetches this file (blocking), evaluates it, and returns
// its exports. Try editing the message and clicking the button again.

export function greet(who) {
  return `👋 ${who} says hello from a synchronously-loaded module!`;
}

export default { greet };
