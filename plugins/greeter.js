// plugins/greeter.js — a plugin-style module.
//
// Its default export is a FACTORY: (fx, opts) => api. When you load it with
//   $$("@/plugins/greeter.js").options({ global: "$greeter" })
// FX invokes the factory and assigns its return value to globalThis.$greeter.

export default function greeterPlugin(fx, opts) {
  return {
    hello: (name) => `Hello ${name} — from a synchronously-loaded plugin!`,
    version: "1.0.0",
  };
}
