// Independent, bounded Python source scanning; no host parser or evaluation.
import {isIdentifierStart, isIdentifierContinue} from "./source-identifiers.mjs";
export const SOURCE_LIMITS = Object.freeze({bytes: 262144, tokens: 32768, depth: 64,
  indents: 64, work: 4194304, digits: 4096, text: 65536, identifier: 64});
const startsIdentifier = value => value.length > 0 && isIdentifierStart(value.codePointAt(0));
const continuesIdentifier = value => value.length > 0 && isIdentifierContinue(value.codePointAt(0));
export const isIdentifier = value => typeof value === "string" && value.length > 0 && value.length <= 128 &&
  Array.from(value).length <= SOURCE_LIMITS.identifier && value.normalize("NFKC") === value &&
  Array.from(value).every((char, index) => (index ? isIdentifierContinue : isIdentifierStart)(char.codePointAt(0)));
const KEYWORDS = new Set(("False None True and as assert async await break class continue def del elif else " +
  "except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield").split(" "));
const OPERATORS = ["**=", "//=", "<<=", ">>=", "...", "==", "!=", "<=", ">=", ":=", "->", "**", "//", "<<", ">>",
  "+=", "-=", "*=", "/=", "%=", "@=", "&=", "|=", "^=", "+", "-", "*", "/", "%", "@", "&", "|", "^", "~", "<", ">", "=", "(", ")", "[", "]", "{", "}", ":", ",", ".", ";"];
const DIGITS = "[0-9](?:_?[0-9])*";
const DECIMAL = new RegExp("^(?:" + DIGITS + "\\.(?:" + DIGITS + ")?|\\." + DIGITS + ")(?:[eE][+-]?" + DIGITS + ")?|^" + DIGITS + "[eE][+-]?" + DIGITS + "|^" + DIGITS);
const width = point => point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;

export class SourceError extends Error {
  constructor(code, message, {filename = "<input>", span = [1, 1, 1, 1], phase = "tokenize", name} = {}) {
    super(message); this.code = code; this.phase = phase;
    this.name = name || ({SYNTAX: "SyntaxError", UNSUPPORTED: "UnsupportedSyntaxError",
      COMPILE_BUDGET: "CompileLimitError", CANCELLED: "CompileCancelled"}[code] || "SourceError");
    this.location = Object.freeze({filename, span: Object.freeze([...span])});
  }
}

class Scanner {
  constructor(input, options) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Expected source options.");
    this.filename = options.filename ?? "<input>";
    if (typeof this.filename !== "string" || !this.filename || this.filename.length > 256 || this.filename.includes("\0")) throw new TypeError("Expected a bounded logical filename.");
    this.limits = {};
    for (const [key, cap] of [["maxBytes", SOURCE_LIMITS.bytes], ["maxTokens", SOURCE_LIMITS.tokens],
      ["maxDepth", SOURCE_LIMITS.depth], ["maxIndent", SOURCE_LIMITS.indents], ["maxWork", SOURCE_LIMITS.work]]) {
      const value = options[key] ?? cap;
      if (!Number.isSafeInteger(value) || value < 1 || value > cap) throw new TypeError("Invalid source limit: " + key);
      this.limits[key] = value;
    }
    this.shouldCancel = options.shouldCancel ?? null;
    if (this.shouldCancel !== null && typeof this.shouldCancel !== "function") throw new TypeError("Invalid compilation cancellation callback.");
    this.offset = 0; this.line = 1; this.column = 1; this.work = 0;
    if (input instanceof Uint8Array) {
      if (input.byteLength > this.limits.maxBytes) this.fail("COMPILE_BUDGET", "Source byte budget exceeded.");
      try { this.source = new TextDecoder("utf-8", {fatal: true}).decode(input); }
      catch { this.fail("SYNTAX", "Source is not valid UTF-8."); }
      this.bytes = input.byteLength;
    } else if (typeof input === "string") {
      if (input.length > this.limits.maxBytes) this.fail("COMPILE_BUDGET", "Source byte budget exceeded.");
      this.bytes = 0;
      for (const char of input) {
        this.charge(); const point = char.codePointAt(0);
        if (point >= 0xd800 && point <= 0xdfff) this.fail("SYNTAX", "Source contains a lone surrogate.");
        this.bytes += width(point);
      }
      this.source = input;
    } else throw new TypeError("Source requires a string or UTF-8 byte array.");
    if (this.bytes > this.limits.maxBytes) this.fail("COMPILE_BUDGET", "Source byte budget exceeded.");
    this.source = this.source.replace(/\r\n?/g, "\n");
    if (this.source.includes("\0")) this.fail("SYNTAX", "Source cannot contain null bytes.");
    this.tokens = []; this.delimiters = []; this.indents = [[0, 0]];
    this.lineStart = true; this.joined = false; this.hasCode = false;
  }
  point() { return [this.line, this.column]; }
  fail(code, message, start = this.point(), name) {
    throw new SourceError(code, message, {filename: this.filename, span: [...start, this.line, this.column], name});
  }
  charge(amount = 1) {
    if ((this.work += amount) > this.limits.maxWork) this.fail("COMPILE_BUDGET", "Source work budget exceeded.");
    if (this.shouldCancel?.()) this.fail("CANCELLED", "Compilation cancelled.");
  }
  peek() { return this.source.codePointAt(this.offset) === undefined ? "" : String.fromCodePoint(this.source.codePointAt(this.offset)); }
  take() {
    const char = this.peek(); if (!char) return char;
    this.charge(); this.offset += char.length;
    if (char === "\n") { this.line++; this.column = 1; } else this.column += width(char.codePointAt(0));
    return char;
  }
  token(kind, value, start, offset, literal) {
    this.charge();
    if (this.tokens.length >= this.limits.maxTokens) this.fail("COMPILE_BUDGET", "Source token budget exceeded.", start);
    this.tokens.push(Object.freeze({kind, value, span: Object.freeze([...start, this.line, this.column]),
      start: offset, end: this.offset, ...(literal === undefined ? {} : {literal})}));
  }
  indentation() {
    const start = this.point(), offset = this.offset;
    let visual = 0, alternate = 0;
    while ([" ", "\t", "\f"].includes(this.peek()) && this.peek()) {
      const char = this.take();
      if (char === "\f") { visual = 0; alternate = 0; }
      else { visual = char === "\t" ? (Math.floor(visual / 8) + 1) * 8 : visual + 1; alternate++; }
    }
    this.lineStart = false;
    if (this.delimiters.length || this.joined) { this.joined = false; return; }
    if (!this.peek() || this.peek() === "#" || this.peek() === "\n") return;
    const top = this.indents.at(-1);
    if (visual === top[0]) {
      if (alternate !== top[1]) this.fail("SYNTAX", "Inconsistent use of tabs and spaces in indentation.", start, "TabError");
    } else if (visual > top[0]) {
      if (alternate <= top[1]) this.fail("SYNTAX", "Inconsistent use of tabs and spaces in indentation.", start, "TabError");
      if (this.indents.length >= this.limits.maxIndent + 1) this.fail("COMPILE_BUDGET", "Indentation depth budget exceeded.", start);
      this.indents.push([visual, alternate]); this.token("indent", "", start, offset);
    } else {
      while (this.indents.length > 1 && this.indents.at(-1)[0] > visual) {
        this.indents.pop(); this.token("dedent", "", this.point(), this.offset);
      }
      if (this.indents.at(-1)[0] !== visual) this.fail("SYNTAX", "Unindent does not match an outer indentation level.", start, "IndentationError");
      if (this.indents.at(-1)[1] !== alternate) this.fail("SYNTAX", "Inconsistent use of tabs and spaces in indentation.", start, "TabError");
    }
  }
  string(prefix, start, offset) {
    if (/[^ru]/i.test(prefix)) this.fail("UNSUPPORTED", "Bytes, formatted and template strings are outside this source profile.", start);
    const quote = this.take(), triple = this.source.startsWith(quote + quote, this.offset);
    if (triple) { this.take(); this.take(); }
    const closing = quote.repeat(triple ? 3 : 1), raw = /r/i.test(prefix), points = [];
    const add = point => {
      if (points.length >= SOURCE_LIMITS.text) this.fail("COMPILE_BUDGET", "String literal budget exceeded.", start);
      points.push(point);
    };
    const hex = count => {
      let value = "";
      for (let i = 0; i < count; i++) {
        if (!/^[0-9a-f]$/i.test(this.peek())) this.fail("SYNTAX", "Truncated Unicode/hexadecimal escape.", start);
        value += this.take();
      }
      const point = Number.parseInt(value, 16);
      if (point > 0x10ffff) this.fail("SYNTAX", "Unicode escape is outside the Unicode range.", start);
      return point;
    };
    while (this.peek()) {
      if (this.source.startsWith(closing, this.offset)) {
        for (let i = 0; i < closing.length; i++) this.take();
        this.token("string", this.source.slice(offset, this.offset), start, offset,
          Object.freeze({type: "str", codepoints: Object.freeze(points)})); return;
      }
      const char = this.take();
      if (char === "\n" && !triple) this.fail("SYNTAX", "Unterminated string literal.", start);
      if (char !== "\\") { add(char.codePointAt(0)); continue; }
      if (!this.peek()) break;
      const next = this.take();
      if (raw) { add(92); add(next.codePointAt(0)); continue; }
      const escapes = {a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, "'": 39, '"': 34};
      if (Object.hasOwn(escapes, next)) add(escapes[next]);
      else if (next === "\n") { /* Explicit physical continuation contributes no point. */ }
      else if (next === "x") add(hex(2));
      else if (next === "u") add(hex(4));
      else if (next === "U") add(hex(8));
      else if (next === "N") this.fail("UNSUPPORTED", "Named Unicode escapes require a separately adopted name database.", start);
      else if (/^[0-7]$/.test(next)) {
        let octal = next;
        while (octal.length < 3 && /^[0-7]$/.test(this.peek())) octal += this.take();
        add(Number.parseInt(octal, 8));
      } else { add(92); add(next.codePointAt(0)); }
    }
    this.fail("SYNTAX", "Unterminated string literal.", start);
  }
  number(start, offset) {
    const tail = this.source.slice(this.offset);
    let raw, integer = true;
    if (/^0[xob]/i.test(tail)) {
      raw = /^[0-9A-Za-z_]+/.exec(tail)[0];
      const valid = /^0x_?[0-9a-f](?:_?[0-9a-f])*$/i.test(raw) || /^0o_?[0-7](?:_?[0-7])*$/i.test(raw) || /^0b_?[01](?:_?[01])*$/i.test(raw);
      if (!valid) this.fail("SYNTAX", "Invalid integer literal.", start);
    } else {
      raw = DECIMAL.exec(tail)?.[0];
      if (!raw) this.fail("SYNTAX", "Invalid numeric literal.", start);
      integer = !/[.eE]/.test(raw);
      if (integer && /^0[0-9_]+$/.test(raw) && /[1-9]/.test(raw)) this.fail("SYNTAX", "Leading zeros in decimal integer literals are not permitted.", start);
    }
    for (let i = 0; i < raw.length; i++) this.take();
    if (this.peek() === "j" || this.peek() === "J") this.fail("UNSUPPORTED", "Complex literals are outside this source profile.", start);
    if (continuesIdentifier(this.peek())) this.fail("SYNTAX", "Invalid numeric literal.", start);
    if (raw.replace(/_/g, "").length > SOURCE_LIMITS.digits) this.fail("COMPILE_BUDGET", "Numeric literal digit budget exceeded.", start);
    let literal;
    if (integer) {
      const value = BigInt(raw.replace(/_/g, "")).toString(); this.charge(value.length);
      if (value.length > SOURCE_LIMITS.digits) this.fail("COMPILE_BUDGET", "Integer digit budget exceeded.", start);
      literal = {type: "int", value};
    } else {
      const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Number(raw.replace(/_/g, "")));
      literal = {type: "float", bits: view.getBigUint64(0).toString(16).padStart(16, "0")};
    }
    this.token("number", raw, start, offset, Object.freeze(literal));
  }
  run() {
    while (this.peek()) {
      if (this.lineStart) this.indentation();
      const start = this.point(), offset = this.offset, char = this.peek();
      if (!char) break;
      if ([" ", "\t", "\f"].includes(char)) { this.take(); continue; }
      if (char === "#") { while (this.peek() && this.peek() !== "\n") this.take(); continue; }
      if (char === "\n") {
        this.take();
        if (!this.delimiters.length && this.hasCode) { this.token("newline", "", start, offset); this.hasCode = false; }
        this.lineStart = true; continue;
      }
      if (char === "\\") {
        this.take();
        if (this.peek() !== "\n") this.fail("SYNTAX", "Expected a newline after a continuation character.", start);
        this.take(); this.lineStart = true; this.joined = true;
        if (!this.peek()) this.fail("SYNTAX", "Unexpected end of source after a continuation character.", start);
        continue;
      }
      this.hasCode = true;
      if (char === "'" || char === '"') { this.string("", start, offset); continue; }
      if (startsIdentifier(char)) {
        let raw = this.take(); while (continuesIdentifier(this.peek())) raw += this.take();
        if (/^(?:r|u|b|f|t|br|rb|fr|rf|tr|rt)$/i.test(raw) && ["'", '"'].includes(this.peek())) { this.string(raw, start, offset); continue; }
        this.charge(raw.length); const value = raw.normalize("NFKC");
        if (!isIdentifier(value)) this.fail("UNSUPPORTED", "Identifier is outside the normalized 64-code-point source profile.", start);
        this.token(KEYWORDS.has(raw) ? "keyword" : "name", value, start, offset); continue;
      }
      if (/^[0-9]$/.test(char) || (char === "." && /^[0-9]$/.test(this.source[this.offset + 1] || ""))) { this.number(start, offset); continue; }
      const op = OPERATORS.find(value => this.source.startsWith(value, this.offset));
      if (!op) this.fail("SYNTAX", "Invalid source character.", start);
      if (["(", "[", "{"].includes(op)) {
        if (this.delimiters.length >= this.limits.maxDepth) this.fail("COMPILE_BUDGET", "Delimiter depth budget exceeded.", start);
        this.delimiters.push({op, start});
      } else if ([")", "]", "}"].includes(op)) {
        const opening = this.delimiters.pop();
        if (!opening || {"(": ")", "[": "]", "{": "}"}[opening.op] !== op) this.fail("SYNTAX", "Mismatched closing delimiter.", start);
      }
      for (let i = 0; i < op.length; i++) this.take();
      this.token("op", op, start, offset);
    }
    if (this.delimiters.length) this.fail("SYNTAX", "Unclosed delimiter.", this.delimiters[0].start);
    if (this.hasCode) this.token("newline", "", this.point(), this.offset);
    while (this.indents.length > 1) { this.indents.pop(); this.token("dedent", "", this.point(), this.offset); }
    this.token("eof", "", this.point(), this.offset);
    return Object.freeze({source: this.source, filename: this.filename, tokens: Object.freeze(this.tokens),
      stats: Object.freeze({bytes: this.bytes, tokens: this.tokens.length, work: this.work})});
  }
}

export function tokenize(source, options = {}) { return new Scanner(source, options).run(); }
