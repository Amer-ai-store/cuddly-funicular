// Builds SVG path data that every renderer accepts. react-native-svg on Android parses `d` strictly and throws (which
// closes the app) on text such as "h--0.19", "NaN" or "1e-7", while browsers quietly skip it. Every interpolated value
// goes through `num`; a literal "-" right before a value is folded into the number, so "h-${v}" can never become "--".
export function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) || rounded === 0 ? "0" : String(rounded);
}

export function svgPath(strings: TemplateStringsArray, ...values: number[]): string {
  let out = "";
  strings.forEach((part, i) => {
    if (i >= values.length) { out += part; return; }
    const negate = part.endsWith("-");
    out += negate ? part.slice(0, -1) : part;
    const text = num(negate ? -values[i] : values[i]);
    // Two numbers in a row need a separator when the next one has no sign of its own.
    out += text;
  });
  return out;
}

/** True when `d` contains only commands and plain decimal numbers (what the strict Android parser expects). */
export function isStrictPath(d: string): boolean {
  if (/--|\+-|-\+|NaN|Infinity|[eE][+-]?\d/.test(d)) return false;
  const tokens = d.replace(/[MmLlHhVvCcSsQqTtAaZz]/g, " ").replace(/,/g, " ").replace(/-/g, " -").trim().split(/\s+/).filter(Boolean);
  return tokens.every((t) => /^-?\d+(\.\d+)?$/.test(t));
}
