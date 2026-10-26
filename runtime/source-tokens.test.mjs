import test from "node:test";
import assert from "node:assert/strict";
import {tokenize, isIdentifier, SourceError, SOURCE_LIMITS} from "./source-tokens.mjs";
import {isIdentifierStart, isIdentifierContinue, IDENTIFIER_UNICODE_VERSION} from "./source-identifiers.mjs";

const significant = source => tokenize(source).tokens.filter(t => !["newline", "indent", "dedent", "eof"].includes(t.kind));
const fails = (source, code, name, options = {}) => assert.throws(() => tokenize(source, options), error =>
  error instanceof SourceError && error.code === code && (!name || error.name === name) && error.phase === "tokenize" &&
  error.location.filename === (options.filename || "<input>") && error.location.span.length === 4);

test("normalizes identifiers while preserving UTF-8 source spans and raw keyword identity", () => {
  const tokens = significant("π = 𝓲𝒇 + café\nNone True False\n");
  assert.deepEqual(tokens.map(t => [t.kind, t.value]), [["name", "π"], ["op", "="], ["name", "if"], ["op", "+"],
    ["name", "café"], ["keyword", "None"], ["keyword", "True"], ["keyword", "False"]]);
  assert.deepEqual(tokens[0].span, [1, 1, 1, 3]);
  assert.deepEqual(tokens[2].span, [1, 6, 1, 14]);
  assert.ok(isIdentifier("café")); assert.ok(isIdentifier("if")); assert.ok(isIdentifier("__proto__"));
  for (const value of ["a.b", "e\u0301", "a-b", "1a", "a".repeat(65), ""]) assert.equal(isIdentifier(value), false);
  assert.equal(IDENTIFIER_UNICODE_VERSION, "16.0.0");
  assert.equal(isIdentifierStart(0x11db0), false); // Assigned in a newer host's Unicode database.
  assert.equal(isIdentifierContinue(0x301), true);
  assert.equal(isIdentifierStart(0x301), false);
});

test("indentation tracks blank/comment lines, tab stops, form feeds, dedents and EOF", () => {
  const source = "if True:\r\n\t# comment\r\n\tif False:\r\n\t\tpass\r\n\r\n\tpass\r\nx=1";
  const result = tokenize(source);
  assert.equal(result.source.includes("\r"), false);
  assert.deepEqual(result.tokens.filter(t => ["indent", "dedent"].includes(t.kind)).map(t => t.kind), ["indent", "indent", "dedent", "dedent"]);
  assert.equal(result.tokens.filter(t => t.kind === "newline").length, 5);
  assert.equal(tokenize("if True:\n \f  pass\n").tokens.filter(t => t.kind === "indent").length, 1);
  fails("if True:\n\tpass\n        pass\n", "SYNTAX", "TabError");
  fails("if True:\n    pass\n  pass\n", "SYNTAX", "IndentationError");
  fails("if True:\n        pass\n\tpass\n", "SYNTAX", "TabError");
});

test("physical continuations and nested delimiters do not create logical indentation", () => {
  for (const source of ["value=(\n   [1,\n      2],\n {3:4}\n)\n", "value=1 + \\\n       2\n"]) {
    const tokens = tokenize(source).tokens;
    assert.equal(tokens.filter(t => t.kind === "newline").length, 1);
    assert.equal(tokens.filter(t => t.kind === "indent").length, 0);
  }
  fails("([)]", "SYNTAX"); fails("(", "SYNTAX"); fails("]", "SYNTAX");
  fails("x=1\\ \n", "SYNTAX"); fails("x=1\\\n", "SYNTAX");
});

test("integer bases, separators and floats retain exact tagged values", () => {
  const literals = significant("9007199254740993 0x_ff 0o7_1 0b_101 00 0_00 1_000 .5 1. 1e-3 1_2.5_0e+2 1e309").map(t => t.literal);
  assert.deepEqual(literals.slice(0, 7).map(t => t.value), ["9007199254740993", "255", "57", "5", "0", "0", "1000"]);
  assert.deepEqual(literals.slice(7).map(t => t.bits), ["3fe0000000000000", "3ff0000000000000", "3f50624dd2f1a9fc", "4093880000000000", "7ff0000000000000"]);
  for (const source of ["01", "1__0", "1_", "1e+", "0b102", "0x", "0o8", "1abc", "0x_", "2.0_e1"]) fails(source, "SYNTAX");
  assert.deepEqual(significant("1j 012J").map(t=>t.literal), [
    {type:"complex",real_bits:"0000000000000000",imag_bits:"3ff0000000000000"},
    {type:"complex",real_bits:"0000000000000000",imag_bits:"4028000000000000"}]);
});

test("string scanning preserves code points, raw escapes, triples and lone-surrogate escapes", () => {
  const literals = significant("'A😀\\u0301' r'\\n' U'\\x61\\101\\U0001f600\\ud800' '''first\nsecond''' '\\q' 'a\\\nb'").map(t => t.literal.codepoints);
  assert.deepEqual(literals, [[65, 128512, 769], [92, 110], [97, 65, 128512, 0xd800],
    Array.from("first\nsecond", c => c.codePointAt(0)), [92, 113], [97, 98]]);
  assert.deepEqual(significant("r'\\\"' \"\\\\\" '\\777'").map(t => t.literal.codepoints), [[92, 34], [92], [511]]);
  for (const source of ["'unterminated", "'line\nbreak'", "'\\x0'", "'\\u123'", "'\\U00110000'", "r'odd\\'"]) fails(source, "SYNTAX");
  for (const source of ["f'{x}'", "rf'{x}'", "t'{x}'", "'\\N{LATIN CAPITAL LETTER A}'"]) fails(source, "UNSUPPORTED");
});

test("accepts UTF-8 bytes and refuses malformed Unicode, nulls and illegal characters", () => {
  const bytes = new TextEncoder().encode("café='😀'\r\n");
  assert.deepEqual(tokenize(bytes).tokens, tokenize("café='😀'\n").tokens);
  assert.deepEqual(tokenize(new Uint8Array([239, 187, 191, 120, 61, 49])).tokens, tokenize("x=1").tokens);
  fails(new Uint8Array([0xc0, 0x80]), "SYNTAX"); fails(new Uint8Array([0xed, 0xa0, 0x80]), "SYNTAX");
  fails("\ud800", "SYNTAX"); fails("'\0'", "SYNTAX"); fails("#\0", "SYNTAX");
  fails("$x", "SYNTAX"); fails("x\u00a0=1", "SYNTAX");
});

test("compiler resource budgets and cancellation fail explicitly before unbounded host work", () => {
  fails("é", "COMPILE_BUDGET", null, {maxBytes: 1});
  fails("x=1", "COMPILE_BUDGET", null, {maxTokens: 2});
  fails("((1))", "COMPILE_BUDGET", null, {maxDepth: 1});
  fails("if True:\n  if True:\n    pass\n", "COMPILE_BUDGET", null, {maxIndent: 1});
  fails("x=1", "COMPILE_BUDGET", null, {maxWork: 2});
  fails("1".repeat(SOURCE_LIMITS.digits + 1), "COMPILE_BUDGET");
  fails("'" + "a".repeat(SOURCE_LIMITS.text + 1) + "'", "COMPILE_BUDGET");
  fails("# comment\n", "CANCELLED", null, {shouldCancel: () => true, filename: "input.py"});
  for (const options of [{maxBytes: 0}, {maxTokens: Infinity}, {maxDepth: 65}, {maxWork: -1}, {shouldCancel: true}, {filename: ""}]) assert.throws(() => tokenize("x", options), TypeError);
  assert.throws(() => tokenize({}, {}), TypeError);
  const result = tokenize("x='a'");
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.tokens) && Object.isFrozen(result.stats));
  assert.throws(() => { result.tokens[2].literal.codepoints.push(2); }, TypeError);
  assert.throws(() => { result.tokens[0].span[0] = 9; }, TypeError);
});

test("seeded malformed inputs always produce bounded tokens or structured source errors", () => {
  let seed = 18471;
  const chars = "x9_ +-*()[]{}:;\\'\"\n\t#@?é😀";
  for (let trial = 0; trial < 500; trial++) {
    let source = "";
    for (let i = 0; i < 48; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; source += Array.from(chars)[seed % Array.from(chars).length]; }
    try {
      const result = tokenize(source, {maxWork: 2048});
      assert.ok(result.stats.work <= 2048); assert.equal(result.tokens.at(-1).kind, "eof");
    } catch (error) { assert.ok(error instanceof SourceError, error.stack); }
  }
});
