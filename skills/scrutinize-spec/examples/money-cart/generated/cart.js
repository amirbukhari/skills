// GENERATED from spec/modules/cart/ — do not edit by hand.
// Source of truth is the spec; regenerate with tools/generate.js.

const money = require("./money.js");

function __sumLineItems(items) {
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i].unitPrice * items[i].quantity;
  }
  return sum;
}

function subtotal(items) {
  return __sumLineItems(items);
}

function tax(subtotalCents, taxRateBps) {
  return money.roundHalfEven(((subtotalCents * taxRateBps) / 10000));
}

function total(subtotalCents, taxCents) {
  return money.add(subtotalCents, taxCents);
}

module.exports = { subtotal, tax, total };
