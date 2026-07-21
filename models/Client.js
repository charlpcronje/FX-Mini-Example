// models/Client.js — a class module.
//
// Load, instantiate and graft it onto a node in one call:
//   $$("app.client@/models/Client.js").options({
//     instantiateDefault: { args: ["Ada", "Lovelace"] },
//     global: "$client",
//   });
// After that: $client.fullname(), and the instance's fields (first/last/role)
// have become reactive sub-nodes — $$("app.client.first") is live.

export default class Client {
  constructor(first = "Ada", last = "Lovelace") {
    this.first = first;
    this.last = last;
    this.role = "member";
  }
  fullname() {
    return `${this.first} ${this.last}`;
  }
}
