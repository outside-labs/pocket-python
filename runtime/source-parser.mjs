import {tokenize, SourceError, SOURCE_LIMITS} from "./source-tokens.mjs";

export const PARSER_LIMITS = Object.freeze({nodes: 8192, depth: 64, decorators: 16});
const BINARY = new Map([["+", "add"], ["-", "subtract"], ["*", "multiply"], ["/", "divide"], ["//", "floor-divide"], ["%", "modulo"],
  ["**", "power"], ["&", "bit-and"], ["|", "bit-or"], ["^", "bit-xor"], ["<<", "left-shift"], [">>", "right-shift"]]);
const COMPARISONS = new Map([["==", "equal"], ["!=", "not-equal"], ["<", "less"], ["<=", "less-equal"], [">", "greater"], [">=", "greater-equal"], ["is", "is"], ["in", "contains"]]);
const AUGMENT = new Set(["+=", "-=", "*=", "/=", "//=", "%=", "**=", "@=", "&=", "|=", "^=", "<<=", ">>="]);

export function freezeSourceTree(root) {
  const pending = [root], seen = new Set();
  for (let index = 0; index < pending.length; index++) {
    const value = pending[index];
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value); for (const child of Object.values(value)) pending.push(child); Object.freeze(value);
  }
  return root;
}

class Parser {
  constructor(source, options) {
    this.lexed = tokenize(source, options); this.options = options;
    this.languageProfile = options.languageProfile ?? "core-source/1";
    if (!["core-source/1", "classes-source/1"].includes(this.languageProfile))
      throw new SourceError("UNSUPPORTED", "Unknown source language profile.", {filename: this.lexed.filename, phase: "parse"});
    this.classes = this.languageProfile === "classes-source/1";
    this.tokens = this.lexed.tokens; this.filename = this.lexed.filename; this.index = 0;
    this.previous = this.tokens[0]; this.work = this.lexed.stats.work; this.nodes = 0; this.depth = 0;
    this.functionDepth = 0; this.loopDepth = 0; this.heights = new WeakMap();
    this.refusal = null; this.typeExpression = false; this.grouped = new WeakSet();
    this.maxNodes = options.maxNodes ?? PARSER_LIMITS.nodes;
    this.maxDepth = options.maxParseDepth ?? PARSER_LIMITS.depth;
    for (const [value, cap] of [[this.maxNodes, PARSER_LIMITS.nodes], [this.maxDepth, PARSER_LIMITS.depth]])
      if (!Number.isSafeInteger(value) || value < 1 || value > cap) throw new TypeError("Invalid parser limit.");
  }
  fail(message, token = this.peek(), code = "SYNTAX", name) {
    throw new SourceError(code, message, {filename: this.filename, span: token.span, phase: "parse", name});
  }
  unsupported(message, token) { this.fail(message, token, "UNSUPPORTED"); }
  defer(message, node) { this.refusal ??= {message, node}; return node; }
  charge() {
    if (++this.work > (this.options.maxWork ?? SOURCE_LIMITS.work)) this.fail("Source work budget exceeded.", this.peek(), "COMPILE_BUDGET");
    if (this.options.shouldCancel?.()) this.fail("Compilation cancelled.", this.peek(), "CANCELLED");
  }
  guard(body) {
    this.charge();
    if (++this.depth > this.maxDepth) this.fail("Source nesting budget exceeded.", this.peek(), "COMPILE_BUDGET");
    try { return body(); } finally { this.depth--; }
  }
  node(kind, start, fields = {}, end = this.previous) {
    this.charge();
    if (++this.nodes > this.maxNodes) this.fail("Source node budget exceeded.", start, "COMPILE_BUDGET");
    let height = 1;
    const scan = value => {
      if (!value || typeof value !== "object" || value.type) return;
      if (this.heights.has(value)) height = Math.max(height, this.heights.get(value) + 1);
      else if (Array.isArray(value)) value.forEach(scan);
      else Object.values(value).forEach(scan);
    };
    Object.values(fields).forEach(scan);
    if (height > this.maxDepth) this.fail("Source tree depth budget exceeded.", start, "COMPILE_BUDGET");
    const result = {kind, span: [start.span[0], start.span[1], end.span[2], end.span[3]], ...fields};
    this.heights.set(result, height); return result;
  }
  peek(ahead = 0) { return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)]; }
  at(value) { const t = this.peek(); return ["op", "keyword"].includes(t.kind) && t.value === value; }
  kind(value) { return this.peek().kind === value; }
  take() { this.charge(); this.previous = this.peek(); if (!this.kind("eof")) this.index++; return this.previous; }
  eat(value) { return this.at(value) ? this.take() : null; }
  expect(value) { if (!this.at(value)) this.fail("Expected '" + value + "'."); return this.take(); }
  expectKind(kind, message = "Expected " + kind + ".") { if (!this.kind(kind)) this.fail(message); return this.take(); }
  name() { return this.expectKind("name", "Expected an identifier."); }
  ending() { return ["newline", "dedent", "eof"].includes(this.peek().kind) || this.at(";"); }
  target(value, deletion = false) {
    if (value.kind === "Name") return;
    if (this.classes && value.kind === "Attribute") return;
    if (value.kind === "Subscript" && (this.classes || value.index.kind !== "Slice")) return;
    if (["Tuple", "List", "Attribute", "Subscript"].includes(value.kind)) this.unsupported(deletion ? "This deletion target is not adopted." : "Unpacking, attribute and slice assignment are not adopted.", value);
    this.fail("Invalid assignment/deletion target.", value);
  }
  file() {
    const start = this.peek(), body = [];
    while (!this.kind("eof")) {
      if (this.kind("newline")) { this.take(); continue; }
      body.push(...this.statement());
    }
    if (this.refusal) this.unsupported(this.refusal.message, this.refusal.node);
    const module = this.node("Module", start, {body});
    return freezeSourceTree({module, source: this.lexed.source, filename: this.filename, languageProfile: this.languageProfile,
      stats: {...this.lexed.stats, work: this.work, nodes: this.nodes}});
  }
  statement() {
    return this.guard(() => {
      if (this.kind("indent") || this.kind("dedent")) this.fail("Unexpected indentation.", this.peek(), "SYNTAX", "IndentationError");
      if (this.at("@") && this.classes) return [this.decorated()];
      if (this.at("def")) return [this.definition()];
      if (this.at("class") && this.classes) return [this.classDefinition()];
      if (this.at("if")) return [this.branch()];
      if (this.at("while") || this.at("for")) return [this.loop()];
      if (this.at("try")) return [this.attempt()];
      if (["class", "async", "with", "@"].some(value => this.at(value))) this.unsupported(this.classes ?
        "Async and context managers require later stages." : "Classes, async, context managers and decorators are not adopted.");
      return this.simpleLine();
    });
  }
  suite() {
    this.expect(":");
    if (!this.kind("newline")) return this.simpleLine();
    this.take(); this.expectKind("indent", "Expected an indented suite.");
    const body = [];
    while (!this.kind("dedent") && !this.kind("eof")) {
      if (this.kind("newline")) this.take(); else body.push(...this.statement());
    }
    this.expectKind("dedent", "Expected the end of an indented suite.");
    if (!body.length) this.fail("An empty suite requires pass.");
    return body;
  }
  simpleLine() {
    const result = [this.small()];
    while (this.eat(";")) { if (this.kind("newline")) break; result.push(this.small()); }
    this.expectKind("newline", "Expected the end of the statement.");
    return result;
  }
  small() {
    const start = this.peek();
    if (["global", "nonlocal", "assert", "yield"].some(value => this.at(value))) this.unsupported("Global/nonlocal mutation, assertions and generators are not adopted.");
    if (this.eat("pass")) return this.node("Pass", start);
    if (this.at("break") || this.at("continue")) {
      const op = this.take().value;
      if (!this.loopDepth) this.fail(op + " outside a loop.", start);
      return this.node(op === "break" ? "Break" : "Continue", start);
    }
    if (this.eat("return")) {
      if (!this.functionDepth) this.fail("Return outside a function.", start);
      return this.node("Return", start, {value: this.ending() ? null : this.expressionList()});
    }
    if (this.eat("raise")) {
      const value = this.ending() ? null : this.expression();
      if (this.at("from")) this.unsupported("Explicit exception causes are not adopted.");
      return this.node("Raise", start, {value});
    }
    if (this.eat("del")) {
      const targets = [this.expression()];
      while (this.eat(",")) { if (this.ending()) break; targets.push(this.expression()); }
      targets.forEach(value => this.target(value, true)); return this.node("Delete", start, {targets});
    }
    if (this.at("import") || this.at("from")) return this.imports();
    if (this.kind("name") && start.value === "type" && this.lexed.source.slice(start.start, start.end) === "type" && this.peek(1).kind === "name") return this.typeAlias();
    let value = this.expressionList();
    if (this.at(":")) this.unsupported("Annotations and pattern statements are not adopted.", start);
    if (this.eat("=")) {
      const targets = [value]; this.target(value);
      for (;;) {
        value = this.expressionList();
        if (!this.eat("=")) break;
        this.target(value); targets.push(value);
      }
      return this.node("Assign", start, {targets, value});
    }
    if (AUGMENT.has(this.peek().value) && this.kind("op")) {
      this.target(value); const token = this.take(), operator = BINARY.get(token.value.slice(0, -1));
      if (!operator) this.unsupported("Augmented operator is not adopted.", token);
      return this.node("Augment", start, {target: value, operator, value: this.expressionList()});
    }
    if (this.at(":=")) this.fail("Assignment expressions require a permitted expression context.");
    return this.node("Expr", start, {value});
  }
  typeAlias() {
    const start = this.take(), name = this.name();
    if (name.value === "__debug__") this.fail("Cannot bind __debug__.", name);
    const before = this.typeExpression; this.typeExpression = true;
    let value;
    try {
      if (this.eat("[")) {
        const names = new Set(); let defaultSeen = false;
        do {
          const variadic = this.eat("*") || this.eat("**"), parameter = this.name();
          if (parameter.value === "__debug__") this.fail("Cannot bind __debug__.", parameter);
          if (names.has(parameter.value)) this.fail("Duplicate type parameter.", parameter);
          names.add(parameter.value);
          if (this.eat(":")) {
            if (variadic) this.fail("A variadic type parameter cannot have a bound.", parameter);
            this.expression();
          }
          if (this.eat("=")) {
            defaultSeen = true;
            if (variadic?.value === "*") this.eat("*");
            this.expression();
          } else if (defaultSeen) this.fail("A required type parameter follows a default.", parameter);
          if (!this.eat(",")) break;
        } while (!this.at("]"));
        this.expect("]");
      }
      this.expect("="); value = this.expression();
    } finally { this.typeExpression = before; }
    return this.defer("Type aliases are not adopted.", this.node("TypeAlias", start, {name: name.value, value}));
  }
  qualified() {
    let name = this.name().value;
    while (this.eat(".")) name += "." + this.name().value;
    return name;
  }
  imports() {
    const start = this.take(), aliases = [];
    let specifier = null, level = 0, parenthesized = false;
    if (start.value === "from") {
      while (this.at(".") || this.at("...")) level += this.take().value.length;
      specifier = this.kind("name") ? this.qualified() : "";
      if (!specifier && !level) this.fail("Expected an import module.");
      this.expect("import"); parenthesized = !!this.eat("(");
    }
    for (;;) {
      if (this.at("*")) {
        if (specifier === null) this.fail("Invalid import target.");
        this.unsupported("Wildcard imports are not adopted.");
      }
      const name = specifier === null ? this.qualified() : this.name().value;
      const asname = this.eat("as") ? this.name().value : null;
      aliases.push({name, asname});
      if (!this.eat(",")) break;
      if (parenthesized && this.at(")")) break;
    }
    if (parenthesized) this.expect(")");
    return this.node("Import", start, {specifier, level, aliases});
  }
  decorated() {
    const decorators = [];
    while (this.eat("@")) {
      if (decorators.length >= PARSER_LIMITS.decorators) this.fail("Decorator count budget exceeded.", this.previous, "COMPILE_BUDGET");
      decorators.push(this.expression());
      this.expectKind("newline", "Expected a newline after the decorator expression.");
    }
    if (this.at("def")) return this.definition(decorators);
    if (this.at("class")) return this.classDefinition(decorators);
    if (this.at("async")) this.unsupported("Async definitions require a later stage.");
    this.fail("Decorators require a function or class definition.");
  }
  definition(decorators = []) {
    const start = this.expect("def"), name = this.name().value;
    if (this.at("[")) this.unsupported("Generic functions are not adopted.");
    this.expect("(");
    let positional = [], posonly = [], kwonly = [], slash = false, star = false, defaultSeen = false;
    const seen = new Set();
    while (!this.at(")")) {
      if (this.at("**")) this.unsupported("Starred parameters are not adopted.");
      if (this.eat("/")) {
        if (slash || star || !positional.length) this.fail("Invalid positional-only separator.");
        slash = true; posonly = positional; positional = [];
      } else if (this.eat("*")) {
        if (star) this.fail("Duplicate keyword-only separator.");
        if (this.kind("name")) this.unsupported("Starred parameters are not adopted.");
        star = true;
      } else {
        const token = this.name();
        if (seen.has(token.value)) this.fail("Duplicate function parameter.", token);
        seen.add(token.value);
        if (this.at(":")) this.unsupported("Parameter annotations are not adopted.");
        const value = this.eat("=") ? this.expression() : null;
        if (!star && defaultSeen && value === null) this.fail("A required positional parameter follows a default.", token);
        if (!star && value !== null) defaultSeen = true;
        (star ? kwonly : positional).push({name: token.value, value, span: token.span});
      }
      if (this.at(")")) break;
      this.expect(",");
    }
    this.expect(")");
    if (star && !kwonly.length) this.fail("A named keyword-only parameter must follow '*'.");
    if (this.at("->")) this.unsupported("Return annotations are not adopted.");
    const before = [this.functionDepth, this.loopDepth]; this.functionDepth++; this.loopDepth = 0;
    let body;
    try { body = this.suite(); } finally { [this.functionDepth, this.loopDepth] = before; }
    return this.node("Function", start, {name, params: {posonly, positional, kwonly}, body, ...(decorators.length ? {decorators} : {})}, body.at(-1));
  }
  classDefinition(decorators = []) {
    const start = this.expect("class"), name = this.name().value, bases = [];
    if (this.at("[")) this.unsupported("Generic classes are not adopted.");
    if (this.eat("(")) {
      while (!this.at(")")) {
        if (this.at("*") || this.at("**") || this.kind("name") && this.peek(1).value === "=")
          this.unsupported("Class keywords, metaclasses and expanded bases are not adopted.");
        bases.push(this.expression());
        if (!this.eat(",")) break;
      }
      this.expect(")");
    }
    const before = [this.functionDepth, this.loopDepth]; this.functionDepth = 0; this.loopDepth = 0;
    let body;
    try { body = this.suite(); } finally { [this.functionDepth, this.loopDepth] = before; }
    return this.node("Class", start, {name, bases, body, ...(decorators.length ? {decorators} : {})}, body.at(-1));
  }
  branch(keyword = "if") {
    const start = this.expect(keyword), test = this.namedExpression(), body = this.suite();
    let otherwise = [];
    if (this.at("elif")) otherwise = [this.guard(() => this.branch("elif"))];
    else if (this.eat("else")) otherwise = this.suite();
    return this.node("If", start, {test, body, otherwise}, otherwise.at(-1) || body.at(-1));
  }
  loop() {
    const start = this.take(), kind = start.value === "for" ? "For" : "While";
    let test = null, target = null, iterable = null;
    if (kind === "For") {
      if (this.at("(") || this.at("[")) this.unsupported("For loop unpacking targets are not adopted.");
      const token = this.name(); target = this.node("Name", token, {name: token.value}, token);
      if (!this.at("in")) this.unsupported("For loops require a simple name target.");
      this.take(); iterable = this.expressionList();
    } else test = this.namedExpression();
    this.loopDepth++; let body;
    try { body = this.suite(); } finally { this.loopDepth--; }
    const otherwise = this.eat("else") ? this.suite() : [];
    return this.node(kind, start, {test, target, iterable, body, otherwise}, otherwise.at(-1) || body.at(-1));
  }
  attempt() {
    const start = this.expect("try"), body = this.suite(), handlers = [];
    let bare = false;
    while (this.eat("except")) {
      const clause = this.previous;
      if (this.at("*")) this.unsupported("Exception groups are not adopted.");
      if (bare) this.fail("A bare handler must be last.", clause);
      const parenthesized = this.at("(");
      const type = this.at(":") ? null : this.expressionList();
      const types = type === null ? [] : type.kind === "Tuple" ? type.items : [type];
      if ((type !== null && !types.length) || types.some(value => value.kind !== "Name")) this.unsupported("Only nonempty named builtin exception clauses are adopted.", type || clause);
      if (type?.kind === "Tuple" && !parenthesized && this.at("as")) this.fail("Multiple handler types require parentheses with an alias.");
      const alias = this.eat("as") ? this.name().value : null;
      if (type === null && alias !== null) this.fail("A bare handler cannot bind an alias.", clause);
      bare = type === null;
      const handlerBody = this.suite();
      handlers.push(this.node("Handler", clause, {types, alias, body: handlerBody}, handlerBody.at(-1)));
    }
    let otherwise = [], final = [];
    if (this.eat("else")) { if (!handlers.length) this.fail("Try else requires an exception handler."); otherwise = this.suite(); }
    if (this.eat("finally")) final = this.suite();
    if (!handlers.length && !final.length) this.fail("Try requires except or finally.");
    return this.node("Try", start, {body, handlers, otherwise, final}, final.at(-1) || otherwise.at(-1) || handlers.at(-1) || body.at(-1));
  }
  expressionList(named = false) {
    const expression = () => named ? this.namedExpression() : this.expression();
    const start = this.peek(), items = [expression()]; let tuple = false;
    while (this.eat(",")) {
      tuple = true;
      if (this.ending() || [")", "]", "}", ":", "="].some(value => this.at(value))) break;
      items.push(expression());
    }
    return tuple ? this.node("Tuple", start, {items}) : items[0];
  }
  namedExpression() {
    if (this.kind("name") && this.peek(1).value === ":=") {
      const start = this.take(); this.expect(":=");
      if (this.typeExpression) this.fail("Assignment expressions cannot occur in type expressions.", start);
      if (start.value === "__debug__") this.fail("Cannot bind __debug__.", start);
      const value = this.expression();
      return this.defer("Assignment expressions are not adopted.", this.node("NamedExpression", start, {name: start.value, value}));
    }
    const value = this.expression();
    if (this.at(":=")) this.fail("An assignment expression requires a bare identifier target.");
    return value;
  }
  expression() {
    return this.guard(() => {
      const body = this.disjunction();
      if (!this.eat("if")) return body;
      const test = this.disjunction(); this.expect("else"); const otherwise = this.expression();
      return this.node("Conditional", body, {body, test, otherwise}, otherwise);
    });
  }
  disjunction() {
    let value = this.conjunction();
    while (this.eat("or")) { const right = this.conjunction(); value = this.node("Boolean", value, {operator: "or", left: value, right}, right); }
    return value;
  }
  conjunction() {
    let value = this.negation();
    while (this.eat("and")) { const right = this.negation(); value = this.node("Boolean", value, {operator: "and", left: value, right}, right); }
    return value;
  }
  negation() {
    if (!this.eat("not")) return this.comparison();
    const start = this.previous, value = this.guard(() => this.negation());
    return this.node("Unary", start, {operator: "not", value}, value);
  }
  comparison() {
    const left = this.bitwiseOr(), parts = [];
    while ((["keyword", "op"].includes(this.peek().kind) && COMPARISONS.has(this.peek().value)) || this.at("not")) {
      const token = this.take(); let operator = COMPARISONS.get(token.value), invert = false;
      if (token.value === "not") { this.expect("in"); operator = "contains"; invert = true; }
      else if (token.value === "is" && this.eat("not")) invert = true;
      parts.push({operator, invert, right: this.bitwiseOr()});
    }
    return parts.length ? this.node("Compare", left, {left, parts}, parts.at(-1).right) : left;
  }
  binaryLayer(next, operators) {
    let value = this[next]();
    while (operators.some(operator => this.at(operator))) {
      const operator = BINARY.get(this.take().value), right = this[next]();
      value = this.node("Binary", value, {operator, left: value, right}, right);
    }
    return value;
  }
  bitwiseOr() { return this.binaryLayer("bitwiseXor", ["|"]); }
  bitwiseXor() { return this.binaryLayer("bitwiseAnd", ["^"]); }
  bitwiseAnd() { return this.binaryLayer("shift", ["&"]); }
  shift() { return this.binaryLayer("addition", ["<<", ">>"]); }
  addition() {
    let value = this.product();
    while (this.at("+") || this.at("-")) { const operator = BINARY.get(this.take().value), right = this.product(); value = this.node("Binary", value, {operator, left: value, right}, right); }
    return value;
  }
  product() {
    let value = this.unary();
    while (["*", "/", "//", "%"].some(value => this.at(value))) {
      const operator = BINARY.get(this.take().value), right = this.unary(); value = this.node("Binary", value, {operator, left: value, right}, right);
    }
    if (this.at("@")) this.unsupported("Matrix multiplication is not adopted.");
    return value;
  }
  unary() {
    if (this.at("+") || this.at("-") || this.at("~")) {
      const start = this.take(), value = this.guard(() => this.unary());
      return this.node("Unary", start, {operator: {"+": "positive", "-": "negative", "~": "invert"}[start.value], value}, value);
    }
    if (this.typeExpression && (this.at("yield") || this.at("await"))) this.fail("Yield and await cannot occur in type expressions.");
    if (["await", "lambda", "yield"].some(value => this.at(value))) this.unsupported("This generator/async expression is not adopted.");
    const value = this.primary();
    if (this.eat("**")) {
      const right = this.guard(() => this.unary());
      return this.node("Binary", value, {operator: "power", left: value, right}, right);
    }
    return value;
  }
  primary() {
    let value = this.atom();
    for (;;) {
      if (this.eat(".")) { const attr = this.name(); value = this.node("Attribute", value, {value, name: attr.value}, attr); }
      else if (this.eat("(")) {
        const args = [], keywords = [], seen = new Set();
        while (!this.at(")")) {
          if (this.at("*") || this.at("**")) this.unsupported("Starred argument expansion is not adopted.");
          if (this.kind("name") && this.peek(1).value === "=") {
            const token = this.take(); this.expect("=");
            if (seen.has(token.value)) this.fail("Duplicate keyword argument.", token);
            seen.add(token.value); keywords.push({name: token.value, value: this.expression()});
          } else {
            if (keywords.length) this.fail("A positional argument follows a keyword argument.");
            args.push(this.namedExpression());
          }
          if (this.at("for")) this.unsupported("Generator/comprehension expressions are not adopted.");
          if (!this.eat(",")) break;
        }
        this.expect(")"); value = this.node("Call", value, {callable: value, args, keywords});
      } else if (this.eat("[")) {
        const start = this.peek(), items = [this.subscript()]; let tuple = false;
        while (this.eat(",")) { tuple = true; if (this.at("]")) break; items.push(this.subscript()); }
        const index = tuple ? this.node("Tuple", start, {items}) : items[0];
        this.expect("]"); value = this.node("Subscript", value, {value, index});
      } else break;
    }
    return value;
  }
  subscript() {
    const start = this.peek(); let index = this.at(":") ? null : this.namedExpression();
    if (!this.eat(":")) return index;
    if (index?.kind === "NamedExpression" && !this.grouped.has(index)) this.fail("A slice-bound assignment expression requires parentheses.", index);
    const stop = [":", ",", "]"].some(value => this.at(value)) ? null : this.expression();
    const step = this.eat(":") ? [",", "]"].some(value => this.at(value)) ? null : this.expression() : null;
    return this.node("Slice", start, {start: index, stop, step});
  }
  atom() {
    const start = this.peek();
    if (this.kind("name")) { this.take(); return this.node("Name", start, {name: start.value}); }
    if (["None", "True", "False"].some(value => this.at(value))) {
      this.take(); return this.node("Literal", start, {literal: start.value === "None" ? {type: "none"} : {type: "bool", value: start.value === "True"}});
    }
    if (this.kind("number")) { this.take(); return this.node("Literal", start, {literal: start.literal}); }
    if (this.kind("string")) {
      const points = [];
      while (this.kind("string")) {
        const token = this.take();
        if (points.length + token.literal.codepoints.length > SOURCE_LIMITS.text) this.fail("Adjacent string literal budget exceeded.", start, "COMPILE_BUDGET");
        for (const point of token.literal.codepoints) points.push(point);
      }
      return this.node("Literal", start, {literal: {type: "str", codepoints: points}});
    }
    if (this.eat("(")) {
      if (this.eat(")")) return this.node("Tuple", start, {items: []});
      const value = this.expressionList(true);
      if (this.at("for")) this.unsupported("Generator expressions are not adopted.");
      this.expect(")"); this.grouped.add(value); return value.kind === "Tuple" ? this.node("Tuple", start, {items: value.items}) : value;
    }
    if (this.eat("[")) {
      const items = [];
      while (!this.at("]")) {
        if (this.at("*")) this.unsupported("Starred container construction is not adopted.");
        items.push(this.namedExpression());
        if (this.at("for")) this.unsupported("Comprehensions are not adopted.");
        if (!this.eat(",")) break;
      }
      this.expect("]"); return this.node("List", start, {items});
    }
    if (this.eat("{")) {
      const entries = [];
      while (!this.at("}")) {
        if (this.at("**")) this.unsupported("Dictionary unpacking is not adopted.");
        const key = this.expression();
        if (!this.eat(":")) this.unsupported("Set literals are not adopted.");
        const value = this.expression(); entries.push([key, value]);
        if (this.at("for")) this.unsupported("Comprehensions are not adopted.");
        if (!this.eat(",")) break;
      }
      this.expect("}"); return this.node("Dict", start, {entries});
    }
    if (this.at("...")) this.unsupported("Ellipsis is not adopted.");
    this.fail("Expected an expression.");
  }
}

export function parseSource(source, options = {}) { return new Parser(source, options).file(); }
