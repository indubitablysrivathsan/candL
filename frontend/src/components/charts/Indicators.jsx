// frontend/src/components/charts/Indicators.js
//
// Indicator computation engine for CandlestickChart.
// Supports built-in Moving Average (SMA/EMA) and Bollinger Bands,
// plus a small safe expression language for custom formulas:
//
//   Series refs: open, high, low, close, avg_price
//   Operators:   + - * / ( )  and unary -
//   Numbers:     123, 12.5
//   Functions:   sma(series, n)  ema(series, n)  stdev(series, n)
//
// No eval() / Function() is used — a hand-rolled tokenizer + recursive
// descent parser produces an AST that is evaluated against the bar data.

/* ───────────────────────── Rolling math helpers ───────────────────────── */

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    sum += (v == null ? 0 : v);
    if (i >= period) {
      const old = values[i - period];
      sum -= (old == null ? 0 : old);
    }
    if (i >= period - 1) {
      // guard against null gaps inside window
      let windowHasNull = false;
      for (let j = i - period + 1; j <= i; j++) {
        if (values[j] == null) { windowHasNull = true; break; }
      }
      out[i] = windowHasNull ? null : sum / period;
    }
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  // seed with SMA of first `period` values
  const seed = sma(values, period);
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) { out[i] = prev; continue; }
    if (prev == null) {
      if (seed[i] != null) {
        prev = seed[i];
        out[i] = prev;
      }
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function stdev(values, period) {
  const out = new Array(values.length).fill(null);
  const means = sma(values, period);
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1 || means[i] == null) continue;
    let windowHasNull = false;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] == null) { windowHasNull = true; break; }
      const d = values[j] - means[i];
      sumSq += d * d;
    }
    out[i] = windowHasNull ? null : Math.sqrt(sumSq / period);
  }
  return out;
}

/* ───────────────────────── Series extraction ───────────────────────── */

const SERIES_KEYS = ['open', 'high', 'low', 'close', 'avg_price'];

export function extractSeries(data) {
  const series = {};
  for (const key of SERIES_KEYS) {
    series[key] = data.map((r) => (r[key] != null ? Number(r[key]) : null));
  }
  return series;
}

/* ───────────────────────── Custom formula parser ─────────────────────────
   Grammar:
     expr    := term (('+' | '-') term)*
     term    := factor (('*' | '/') factor)*
     factor  := '-' factor | primary
     primary := NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')'
     args    := expr (',' expr)*
─────────────────────────────────────────────────────────────────────── */

class FormulaError extends Error {}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isAlpha = (c) => /[a-zA-Z_]/.test(c);
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i;
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j++;
      tokens.push({ type: 'num', value: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/(),'.includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected character "${c}" at position ${i}`);
  }
  return tokens;
}

function parseFormula(src) {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type) => {
    const t = next();
    if (!t || t.type !== type) {
      throw new FormulaError(`Expected "${type}" but got "${t ? t.type : 'end of input'}"`);
    }
    return t;
  };

  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = next().type;
      const right = parseTerm();
      node = { kind: 'bin', op, left: node, right };
    }
    return node;
  }

  function parseTerm() {
    let node = parseFactor();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = next().type;
      const right = parseFactor();
      node = { kind: 'bin', op, left: node, right };
    }
    return node;
  }

  function parseFactor() {
    if (peek() && peek().type === '-') {
      next();
      return { kind: 'neg', value: parseFactor() };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = peek();
    if (!t) throw new FormulaError('Unexpected end of formula');

    if (t.type === 'num') { next(); return { kind: 'num', value: t.value }; }

    if (t.type === '(') {
      next();
      const node = parseExpr();
      expect(')');
      return node;
    }

    if (t.type === 'ident') {
      next();
      if (peek() && peek().type === '(') {
        next(); // consume '('
        const args = [];
        if (peek() && peek().type !== ')') {
          args.push(parseExpr());
          while (peek() && peek().type === ',') {
            next();
            args.push(parseExpr());
          }
        }
        expect(')');
        return { kind: 'call', name: t.value, args };
      }
      return { kind: 'ref', name: t.value };
    }

    throw new FormulaError(`Unexpected token "${t.type}"`);
  }

  const ast = parseExpr();
  if (pos !== tokens.length) {
    throw new FormulaError(`Unexpected trailing input near token ${pos}`);
  }
  return ast;
}

const FUNCS = { sma, ema, stdev };

// Evaluate an AST node into a full-length array (series) aligned with `data`.
// Scalars (numbers) are broadcast to constant arrays.
function evalNode(node, series, length) {
  switch (node.kind) {
    case 'num':
      return new Array(length).fill(node.value);

    case 'ref': {
      if (!SERIES_KEYS.includes(node.name)) {
        throw new FormulaError(`Unknown series "${node.name}". Valid: ${SERIES_KEYS.join(', ')}`);
      }
      return series[node.name];
    }

    case 'neg': {
      const v = evalNode(node.value, series, length);
      return v.map((x) => (x == null ? null : -x));
    }

    case 'bin': {
      const l = evalNode(node.left, series, length);
      const r = evalNode(node.right, series, length);
      return l.map((lv, i) => {
        const rv = r[i];
        if (lv == null || rv == null) return null;
        switch (node.op) {
          case '+': return lv + rv;
          case '-': return lv - rv;
          case '*': return lv * rv;
          case '/': return rv === 0 ? null : lv / rv;
          default: throw new FormulaError(`Unknown operator "${node.op}"`);
        }
      });
    }

    case 'call': {
      const fn = FUNCS[node.name];
      if (!fn) {
        throw new FormulaError(`Unknown function "${node.name}". Valid: ${Object.keys(FUNCS).join(', ')}`);
      }
      if (node.args.length !== 2) {
        throw new FormulaError(`${node.name}(series, period) expects 2 arguments`);
      }
      const inner = evalNode(node.args[0], series, length);
      const periodNode = node.args[1];
      if (periodNode.kind !== 'num') {
        throw new FormulaError(`${node.name}(...) period argument must be a number`);
      }
      const period = Math.round(periodNode.value);
      if (period < 1) throw new FormulaError(`${node.name}(...) period must be >= 1`);
      return fn(inner, period);
    }

    default:
      throw new FormulaError(`Unknown node kind "${node.kind}"`);
  }
}

// Validate-only (throws FormulaError on bad syntax/refs) — used for live
// validation in the add-indicator popup before the user commits.
export function validateFormula(src) {
  const ast = parseFormula(src);
  // dry-run eval against a tiny dummy series to catch unknown refs/fns
  const dummyLen = 5;
  const dummySeries = {};
  for (const k of SERIES_KEYS) dummySeries[k] = new Array(dummyLen).fill(1);
  evalNode(ast, dummySeries, dummyLen);
  return true;
}

// Computes a custom formula against real bar data, returns array aligned to data.
export function computeFormula(src, data) {
  const series = extractSeries(data);
  const ast = parseFormula(src);
  return evalNode(ast, series, data.length);
}

export { FormulaError };

/* ───────────────────────── Indicator factory ───────────────────────── */
//
// Each indicator config: { id, type, params, color }
//   type: 'ma' | 'bollinger' | 'custom'
//   params for 'ma':        { method: 'sma'|'ema', period, source }
//   params for 'bollinger': { period, stdDev, source }
//   params for 'custom':    { formula, label }
//
// computeIndicatorLines(indicator, data) returns an array of
// { key, label, color, lineStyle, points: [{time, value}] } — one entry
// per plotted line (Bollinger yields 3: upper/mid/lower).

const PALETTE = ['#4A9EFF', '#A855F7', '#D66E9A', '#00C896', '#F0A500', '#E05252', '#6EE7B7', '#FBBF24'];

export function nextColor(usedColors) {
  for (const c of PALETTE) {
    if (!usedColors.includes(c)) return c;
  }
  // fallback: cycle
  return PALETTE[usedColors.length % PALETTE.length];
}

export function describeIndicator(ind) {
  if (ind.type === 'ma') {
    return `${ind.params.method.toUpperCase()}(${ind.params.period})`;
  }
  if (ind.type === 'bollinger') {
    return `BB(${ind.params.period},${ind.params.stdDev})`;
  }
  return ind.params.label || 'CUSTOM';
}

export function computeIndicatorLines(ind, data) {
  const times = data.map((r) => r.trade_date);

  if (ind.type === 'ma') {
    const source = ind.params.source || 'close';
    const values = extractSeries(data)[source];
    const result = ind.params.method === 'ema'
      ? ema(values, ind.params.period)
      : sma(values, ind.params.period);
    return [{
      key: `${ind.id}-line`,
      label: describeIndicator(ind),
      color: ind.color,
      lineStyle: 0, // solid
      points: times.map((t, i) => ({ time: t, value: result[i] })).filter((p) => p.value != null),
    }];
  }

  if (ind.type === 'bollinger') {
    const source = ind.params.source || 'close';
    const values = extractSeries(data)[source];
    const mid = sma(values, ind.params.period);
    const sd  = stdev(values, ind.params.period);
    const upper = mid.map((m, i) => (m == null || sd[i] == null ? null : m + ind.params.stdDev * sd[i]));
    const lower = mid.map((m, i) => (m == null || sd[i] == null ? null : m - ind.params.stdDev * sd[i]));
    const mk = (arr, suffix, dashed) => ({
      key: `${ind.id}-${suffix}`,
      label: `${describeIndicator(ind)} ${suffix.toUpperCase()}`,
      color: ind.color,
      lineStyle: dashed ? 2 : 0, // 2 = dashed in lightweight-charts LineStyle enum
      points: times.map((t, i) => ({ time: t, value: arr[i] })).filter((p) => p.value != null),
    });
    return [
      mk(upper, 'upper', true),
      mk(mid,   'mid',   false),
      mk(lower, 'lower', true),
    ];
  }

  if (ind.type === 'custom') {
    const result = computeFormula(ind.params.formula, data);
    return [{
      key: `${ind.id}-line`,
      label: ind.params.label || ind.params.formula,
      color: ind.color,
      lineStyle: 0,
      points: times.map((t, i) => ({ time: t, value: result[i] })).filter((p) => p.value != null),
    }];
  }

  return [];
}