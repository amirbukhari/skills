// GENERATED from spec/modules/money/ — do not edit by hand.
// Source of truth is the spec; regenerate with tools/generate.js.

function __roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function __formatCurrency(cents, symbol, decimals) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const divisor = Math.pow(10, decimals);
  const whole = Math.floor(abs / divisor);
  const frac = abs % divisor;
  const fracStr = String(frac).padStart(decimals, "0");
  return sign + symbol + whole + "." + fracStr;
}

function add(a, b) {
  return (a + b);
}

function sub(a, b) {
  return (a - b);
}

function mul(cents, qty) {
  return (cents * qty);
}

function roundHalfEven(value) {
  return __roundHalfEven(value);
}

function format(cents) {
  return __formatCurrency(cents, "$", 2);
}

module.exports = { add, sub, mul, roundHalfEven, format };
