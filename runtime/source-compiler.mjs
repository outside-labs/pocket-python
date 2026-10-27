import {parseSource, freezeSourceTree} from "./source-parser.mjs";
import {SourceError, SOURCE_LIMITS} from "./source-tokens.mjs";
import {verifyFunctions, FUNCTION_LIMITS} from "./function-bytecode.mjs";
import {EXCEPTIONS} from "./function-objects.mjs";
import {allowsClassSpecial} from "./class-policy.mjs";
import {isPythonIdentifier} from "./source-identifiers.mjs";

const MODULE_NAME = /^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*$/;
const NONE = Object.freeze({type: "none"});

class Compiler {
  constructor(parsed, options) {
    this.parsed = parsed; this.options = options; this.work = parsed.stats.work;
    this.classes = parsed.languageProfile === "classes-source/1";
    this.program = {format: "pocket-python-bytecode", version: this.classes ? 5 : 4, constants: [], functions: []};
    this.constants = new Map(); this.scopes = []; this.scopeOf = new WeakMap(); this.imports = [];
    this.instructions = 0; this.blocks = 0; this.tempSerial = 0;
  }
  fail(message, node, code = "UNSUPPORTED", phase = "compile") {
    throw new SourceError(code, message, {filename: this.parsed.filename, span: node.span, phase});
  }
  charge(node, amount = 1) {
    if ((this.work += amount) > (this.options.maxWork ?? SOURCE_LIMITS.work)) this.fail("Source work budget exceeded.", node, "COMPILE_BUDGET");
    if (this.options.shouldCancel?.()) this.fail("Compilation cancelled.", node, "CANCELLED");
  }
  children(value, visit) {
    if (!value || typeof value !== "object" || value.type) return;
    if (value.kind) { visit(value); return; }
    if (Array.isArray(value)) value.forEach(item => this.children(item, visit));
    else Object.values(value).forEach(item => this.children(item, visit));
  }
  privateNames(root) {
    const name = (value, owner, site) => {
      if (!owner || !value.startsWith("__") || value.endsWith("__") || value.includes(".")) return value;
      this.charge(site, owner.length + value.length);
      const prefix = owner.replace(/^_+/, "");
      if (!prefix) return value;
      const result = "_" + prefix + value;
      if (!isPythonIdentifier(result)) this.fail("Mangled identifier exceeds the name budget.", site, "COMPILE_BUDGET", "bind");
      return result;
    };
    const rewrite = (value, owner = null) => {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(item => rewrite(item, owner));
      if (!value.kind) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child, owner)]));
      this.charge(value);
      if (value.kind === "Class") return {...value, bindingName: name(value.name, owner, value),
        bases: rewrite(value.bases, owner), body: rewrite(value.body, value.name),
        ...(value.decorators ? {decorators: rewrite(value.decorators, owner)} : {})};
      if (["Function", "Lambda"].includes(value.kind)) {
        const params = Object.fromEntries(Object.entries(value.params).map(([key, group]) => [key,
          group.map(param => ({...param, name: name(param.name, owner, param), value: rewrite(param.value, owner)}))]));
        const names = Object.values(params).flat().map(param => param.name);
        if (new Set(names).size !== names.length) this.fail("Duplicate function parameter after name mangling.", value, "SYNTAX", "bind");
        return {...value, bindingName: name(value.name, owner, value), params, body: rewrite(value.body, owner),
          ...(value.decorators ? {decorators: rewrite(value.decorators, owner)} : {})};
      }
      if (value.kind === "Import") return {...value, specifier: value.specifier === null ? null : name(value.specifier, owner, value),
        aliases: value.aliases.map(alias => ({...alias, name: name(alias.name, owner, value),
          bindingName: name(alias.asname || (value.specifier === null ? alias.name.split(".")[0] : alias.name), owner, value)}))};
      const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === "span" ? child : rewrite(child, owner)]));
      if (["Name", "Attribute", "NamedExpression"].includes(value.kind)) result.name = name(value.name, owner, value);
      if (value.kind === "Handler" && value.alias) result.alias = name(value.alias, owner, value);
      if (value.kind === "Declaration") result.names = value.names.map(key => name(key, owner, value));
      return result;
    };
    return rewrite(root);
  }
  bind(node, parent = null) {
    this.charge(node);
    if (this.scopes.length >= FUNCTION_LIMITS.functions) this.fail("Function budget exceeded.", node, "COMPILE_BUDGET", "bind");
    const scope = {node, parent, locals: new Set(), uses: new Set(), free: new Set(), globals: new Set(), nonlocals: new Set(), assigned: new Set(), index: this.scopes.length,
      qualname: parent === null ? "<module>" : !parent.parent ? node.name :
        parent.qualname + (parent.node.kind === "Class" ? "." : ".<locals>.") + node.name};
    this.scopes.push(scope); this.scopeOf.set(node, scope);
    scope.classContext = node.kind === "Class" || !!parent?.classContext;
    if (scope.qualname.length > 256) this.fail("Qualified function name budget exceeded.", node, "COMPILE_BUDGET", "bind");
    if (["Function", "Lambda"].includes(node.kind)) for (const group of Object.values(node.params)) for (const param of group) scope.locals.add(param.name);
    if (node.kind === "Class") { scope.locals.add("__module__"); scope.locals.add("__qualname__"); }
    const binding = (name, site) => {
      if (node.kind === "Class" && ["__module__", "__qualname__"].includes(name))
        this.fail("Class metadata overrides are outside C1.", site, "UNSUPPORTED", "bind");
      scope.assigned.add(name);
      if (!scope.globals.has(name) && !scope.nonlocals.has(name)) scope.locals.add(name);
    };
    const target = value => {
      if (value.kind === "Name") binding(value.name, value);
      else if (["List", "Tuple"].includes(value.kind)) value.items.forEach(target);
      else if (value.kind === "Starred") target(value.value);
    };
    const visit = value => {
      this.charge(value);
      if (value.kind === "Declaration") {
        for (const key of value.names) {
          const global = value.declaration === "global";
          if (!global && !scope.parent) this.fail("Nonlocal declaration is not allowed at module level.", value, "SYNTAX", "bind");
          if (["Function", "Lambda"].includes(node.kind) && Object.values(node.params).flat().some(param => param.name === key))
            this.fail("A parameter conflicts with a scope declaration.", value, "SYNTAX", "bind");
          if ((global ? scope.nonlocals : scope.globals).has(key)) this.fail("A name is both global and nonlocal.", value, "SYNTAX", "bind");
          if (scope.uses.has(key) || scope.assigned.has(key)) this.fail("A name is used or assigned before its scope declaration.", value, "SYNTAX", "bind");
          if (node.kind === "Class" && ["__module__", "__qualname__"].includes(key)) this.fail("Class metadata declarations require a later construction stage.", value, "UNSUPPORTED", "bind");
          (global ? scope.globals : scope.nonlocals).add(key); scope.locals.delete(key);
        }
        return;
      }
      if (["Function", "Class", "Lambda"].includes(value.kind)) {
        (value.decorators || []).forEach(visit);
        if (value.kind !== "Lambda") binding(value.bindingName ?? value.name, value);
        if (value.kind === "Class") value.bases.forEach(visit);
        else for (const group of Object.values(value.params)) for (const param of group) if (param.value) visit(param.value);
        this.bind(value, scope); return;
      }
      if (value.kind === "Name") {
        scope.uses.add(value.name);
        if (this.classes && value.name === "super" && ["Function", "Lambda"].includes(node.kind)) scope.uses.add("__class__");
      }
      if (value.kind === "NamedExpression") binding(value.name, value);
      if (["Assign", "Delete"].includes(value.kind)) value.targets.forEach(target);
      if (value.kind === "Augment") target(value.target);
      if (value.kind === "For") target(value.target);
      if (value.kind === "Handler" && value.alias) binding(value.alias, value);
      if (value.kind === "Import") for (const alias of value.aliases) binding(alias.bindingName ?? alias.asname ?? (value.specifier === null ? alias.name.split(".")[0] : alias.name), value);
      for (const [key, child] of Object.entries(value)) if (key !== "span") this.children(child, visit);
    };
    node.body.forEach(visit); return scope;
  }
  comprehensions(root) {
    const lower = value => {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(lower);
      if (value.kind) this.charge(value);
      const node = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === "span" ? child : lower(child)]));
      if (node.kind !== "Comprehension") return node;
      const forbidden = child => {
        if (!child || typeof child !== "object") return;
        if (child.kind === "Lambda") return;
        if (["NamedExpression", "Yield"].includes(child.kind)) this.fail("Yield and assignment expressions in comprehensions require a separate scope stage.", child);
        Object.values(child).forEach(forbidden);
      };
      forbidden(node);
      const make = (kind, fields = {}) => ({kind, span: node.span, ...fields});
      const name = key => make("Name", {name: key});
      const parameter = "@source:" + this.tempSerial++, result = "@source:" + this.tempSerial++;
      let body;
      if (node.form === "generator") body = [make("Expr", {value: make("Yield", {value: node.element, delegate: false})})];
      else if (node.form === "dict") body = [make("ComprehensionInsert", {receiver: name(result), key: node.key, value: node.element})];
      else body = [make("ComprehensionInsert", {receiver: name(result), key: null, value: node.element, form: node.form})];
      for (let index = node.clauses.length - 1; index >= 0; index--) {
        const clause = node.clauses[index];
        for (const test of clause.filters.toReversed()) body = [make("If", {test, body, otherwise: []})];
        body = [make("For", {target: clause.target, iterable: index ? clause.iterable : name(parameter),
          acquired: index === 0, body, otherwise: []})];
      }
      if (node.form !== "generator") body = [make("Assign", {targets: [name(result)], value: make(node.form === "dict" ? "Dict" : node.form === "set" ? "Set" : "List", node.form === "dict" ? {entries: []} : {items: []})}),
        ...body, make("Return", {value: name(result)})];
      const callable = make("Lambda", {name: {list: "<listcomp>", dict: "<dictcomp>", set: "<setcomp>", generator: "<genexpr>"}[node.form],
        params: {posonly: [{name: parameter, value: null, span: node.span}], positional: [], kwonly: [], vararg: [], kwarg: []}, body});
      return make("ComprehensionCall", {callable, iterable: node.clauses[0].iterable});
    };
    return lower(root);
  }
  resolve() {
    const root = this.comprehensions(this.parsed.module);
    this.bind(this.classes ? this.privateNames(root) : root);
    for (const scope of this.scopes) {
      if (scope.locals.has("__debug__") || scope.assigned.has("__debug__")) this.fail("Cannot assign to or delete __debug__.", scope.node, "SYNTAX", "bind");
      if ([...scope.locals, ...scope.uses].some(name => ["None", "True", "False"].includes(name)))
        this.fail("A normalized identifier cannot name a reserved constant.", scope.node, "UNSUPPORTED", "bind");
      if (scope.node.kind === "Class" && [...scope.locals].some(name => !allowsClassSpecial(name, "define")))
        this.fail("Custom special methods require a later class stage.", scope.node, "UNSUPPORTED", "bind");
    }
    for (const scope of this.scopes.slice(1)) for (const name of new Set([...scope.uses, ...scope.nonlocals])) {
      this.charge(scope.node);
      if (scope.locals.has(name) || scope.globals.has(name)) continue;
      let owner = scope.parent;
      while (owner?.parent) {
        this.charge(scope.node);
        if (this.classes && name === "__class__" && owner.node.kind === "Class") {
          owner.locals.add("@source:class"); break;
        }
        if (owner.node.kind !== "Class") {
          if (owner.globals.has(name)) { owner = null; break; }
          if (owner.locals.has(name)) break;
        }
        owner = owner.parent;
      }
      if (!owner?.parent) {
        if (scope.nonlocals.has(name)) this.fail("No binding for nonlocal name in an enclosing function.", scope.node, "SYNTAX", "bind");
        continue;
      }
      for (let current = scope; current !== owner; current = current.parent) { this.charge(scope.node); current.free.add(name); }
    }
  }

  constant(record, node) {
    this.charge(node);
    const key = JSON.stringify(record);
    this.charge(node, key.length);
    if (this.constants.has(key)) return this.constants.get(key);
    if (this.constants.size >= 256) this.fail("Constant pool budget exceeded.", node, "COMPILE_BUDGET");
    const index = this.program.constants.length; this.constants.set(key, index); this.program.constants.push(record); return index;
  }
  literal(node) {
    if (node.kind === "Literal") return node.literal;
    if (node.kind === "Tuple") return {type: "tuple", items: node.items.map(value => this.literal(value))};
    if (node.kind === "Unary" && ["positive", "negative"].includes(node.operator)) {
      const literal = this.literal(node.value);
      if (literal.type === "int") return {type: "int", value: (node.operator === "negative" ? -BigInt(literal.value) : BigInt(literal.value)).toString()};
      if (literal.type === "float") return {...literal, bits: node.operator === "negative" ? (BigInt("0x" + literal.bits) ^ (1n << 63n)).toString(16).padStart(16, "0") : literal.bits};
      if (literal.type === "complex") {
        const signed = bits => node.operator === "negative" ? (BigInt('0x'+bits)^(1n<<63n)).toString(16).padStart(16,'0') : bits;
        return {...literal,real_bits:signed(literal.real_bits),imag_bits:signed(literal.imag_bits)};
      }
    }
    this.fail("Defaults require immutable literals or literal tuples.", node, "UNSUPPORTED", "bind");
  }
  runtimeDefaults(node) {
    const literal = value => value.kind === "Literal" || value.kind === "Tuple" && value.items.every(literal) ||
      value.kind === "Unary" && ["positive", "negative"].includes(value.operator) && value.value.kind === "Literal" &&
      ["int", "float", "complex"].includes(value.value.literal.type);
    return Object.values(node.params).flat().some(param => param.value !== null && !literal(param.value));
  }
  temporary(scope, node) {
    const name = "@source:" + this.tempSerial++;
    scope.locals.add(name);
    if (scope.locals.size > FUNCTION_LIMITS.names) this.fail("Local name budget exceeded.", node, "COMPILE_BUDGET");
    return name;
  }
  function(scope) {
    const node = scope.node, isModule = node.kind === "Module", isClass = node.kind === "Class";
    if (scope.locals.size > FUNCTION_LIMITS.names || scope.free.size > FUNCTION_LIMITS.names) this.fail("Binding name budget exceeded.", node, "COMPILE_BUDGET", "bind");
    const params = {posonly: [], positional: [], kwonly: [], defaults: [], kwdefaults: {}};
    if (!isModule && !isClass) {
      for (const key of ["posonly", "positional", "kwonly"]) params[key] = node.params[key].map(param => param.name);
      for (const key of ["vararg", "kwarg"]) if (node.params[key]?.length) params[key] = node.params[key][0].name;
      const runtime = this.runtimeDefaults(node);
      params.defaults = [...node.params.posonly, ...node.params.positional].filter(param => param.value !== null).map(param => runtime ? null : this.constant(this.literal(param.value), param.value));
      params.kwdefaults = Object.fromEntries(node.params.kwonly.filter(param => param.value !== null).map(param => [param.name, runtime ? null : this.constant(this.literal(param.value), param.value)]));
    }
    const fn = {name: isModule ? "<module>" : node.name, qualname: scope.qualname, params,
      locals: [], free: [...scope.free].sort(), body: null, blocks: [],
      ...(this.classes ? {kind: isModule ? "module" : isClass ? "class" : "function"} : {}),
      ...(scope.globals.size ? {globals: [...scope.globals].sort()} : {}),
      ...(scope.nonlocals.size ? {nonlocals: [...scope.nonlocals].sort()} : {})};
    this.program.functions[scope.index] = fn;
    const makeBlock = (nodes, expression = false) => {
      this.charge(node);
      if (++this.blocks > FUNCTION_LIMITS.blocks) this.fail("Block budget exceeded.", node, "COMPILE_BUDGET");
      const instructions = [], spans = [], block = {kind: expression ? "expression" : "statement", instructions,
        source: {filename: this.parsed.filename, spans}}, id = fn.blocks.length;
      fn.blocks.push(block);
      const emit = (site, ...instruction) => {
        this.charge(site);
        if (++this.instructions > FUNCTION_LIMITS.instructions) this.fail("Instruction budget exceeded.", site, "COMPILE_BUDGET");
        instructions.push(instruction); spans.push(site.span); return instructions.length - 1;
      };
      const pushNone = site => emit(site, "const", this.constant(NONE, site));
      const attribute = (value, write = false) => {
        if (write && !allowsClassSpecial(value.name, "mutate"))
          this.fail("Special attribute mutation is outside C1.", value);
        return value.name;
      };
      const makeFunction = value => {
        if (this.runtimeDefaults(value)) {
          const positional = [...value.params.posonly, ...value.params.positional].filter(param => param.value !== null);
          const keywords = value.params.kwonly.filter(param => param.value !== null);
          [...positional, ...keywords].forEach(param => expr(param.value));
          emit(value, "function-defaults", this.scopeOf.get(value).index, positional.length, keywords.map(param => param.name));
        } else emit(value, "function", this.scopeOf.get(value).index);
      };
      const expr = value => {
        this.charge(value);
        if (value.kind === "Literal") emit(value, "const", this.constant(value.literal, value));
        else if (value.kind === "Yield") { value.value ? expr(value.value) : pushNone(value); emit(value, value.delegate ? "yield-from" : "yield"); }
        else if (value.kind === "NamedExpression") { expr(value.value); emit(value, "dup"); emit(value, "store", value.name); }
        else if (value.kind === "Lambda") makeFunction(value);
        else if (value.kind === "ComprehensionCall") { makeFunction(value.callable); expr(value.iterable); emit(value, "iter"); emit(value, "call", 1, []); }
        else if (value.kind === "Name") value.name === "__debug__" ? emit(value, "const", this.constant({type: "bool", value: true}, value)) : emit(value, "load", value.name);
        else if (["List", "Tuple"].includes(value.kind)) {
          if (value.items.length > 1024) this.fail("Container item budget exceeded.", value, "COMPILE_BUDGET");
          if (value.items.some(item => item.kind === "Starred")) {
            emit(value, "build-list", 0);
            for (const item of value.items) {
              expr(item.kind === "Starred" ? item.value : item); emit(item, item.kind === "Starred" ? "list-extend" : "list-push");
            }
            if (value.kind === "Tuple") emit(value, "list-to-tuple");
          } else { value.items.forEach(expr); emit(value, value.kind === "List" ? "build-list" : "build-tuple", value.items.length); }
        } else if (value.kind === "Set") {
          if (value.items.length > 1024) this.fail("Container item budget exceeded.", value, "COMPILE_BUDGET");
          if (value.items.some(item => item.kind === "Starred")) {
            const first = value.items.findIndex(item => item.kind === "Starred");
            value.items.slice(0, first).forEach(expr); emit(value, "build-set", first);
            for (const item of value.items.slice(first)) {
              expr(item.kind === "Starred" ? item.value : item); emit(item, item.kind === "Starred" ? "set-extend" : "set-insert");
            }
          } else { value.items.forEach(expr); emit(value, "build-set", value.items.length); }
        } else if (value.kind === "Dict") {
          if (value.entries.length > 1024) this.fail("Container item budget exceeded.", value, "COMPILE_BUDGET");
          if (value.entries.some(pair => pair[0] === null)) {
            emit(value, "build-dict", 0);
            for (const [key, item] of value.entries) {
              if (key === null) { expr(item); emit(value, "dict-merge"); }
              else { expr(key); expr(item); emit(value, "dict-insert"); }
            }
          } else { value.entries.forEach(pair => pair.forEach(expr)); emit(value, "build-dict", value.entries.length); }
        } else if (value.kind === "Unary") { expr(value.value); emit(value, value.operator); }
        else if (value.kind === "Binary") { expr(value.left); expr(value.right); emit(value, value.operator); }
        else if (value.kind === "Boolean") {
          expr(value.left); emit(value.left, "dup");
          if (value.operator === "or") emit(value.left, "not");
          const jump = emit(value.left, "jump-if-false", 0); emit(value.left, "pop"); expr(value.right);
          instructions[jump][1] = instructions.length;
        } else if (value.kind === "Conditional") {
          expr(value.test); const otherwise = emit(value.test, "jump-if-false", 0);
          expr(value.body); const end = emit(value, "jump", 0); instructions[otherwise][1] = instructions.length;
          expr(value.otherwise); instructions[end][1] = instructions.length;
        } else if (value.kind === "Compare") {
          if (value.parts.length === 1) {
            expr(value.left); expr(value.parts[0].right); emit(value, value.parts[0].operator);
            if (value.parts[0].invert) emit(value, "not");
          } else {
            const left = this.temporary(scope, value), right = this.temporary(scope, value), exits = [];
            expr(value.left); emit(value.left, "store", left);
            value.parts.forEach((part, index) => {
              emit(value, "load", left); expr(part.right); emit(part.right, "dup"); emit(part.right, "store", right);
              emit(value, part.operator); if (part.invert) emit(value, "not");
              if (index < value.parts.length - 1) {
                emit(value, "dup"); exits.push(emit(value, "jump-if-false", 0)); emit(value, "pop");
                emit(value, "load", right); emit(value, "store", left);
              }
            });
            exits.forEach(at => { instructions[at][1] = instructions.length; });
            emit(value, "delete", left); emit(value, "delete", right);
          }
        } else if (value.kind === "Attribute") {
          expr(value.value); emit(value, this.classes ? "attribute-get" : "module-get", attribute(value));
        }
        else if (value.kind === "Slice") {
          if (!this.classes) this.fail("Slice-key construction requires classes-source/1.", value);
          for (const part of [value.start, value.stop, value.step]) part ? expr(part) : pushNone(value);
          emit(value, "build-slice");
        }
        else if (value.kind === "Subscript") {
          expr(value.value);
          if (value.index.kind === "Slice") {
            for (const part of [value.index.start, value.index.stop, value.index.step]) part ? expr(part) : pushNone(value);
            emit(value, "slice");
          } else { expr(value.index); emit(value, "getitem"); }
        } else if (value.kind === "Call") {
          if (value.args.length > 128 || value.keywords.length > 128) this.fail("Call argument budget exceeded.", value, "COMPILE_BUDGET");
          expr(value.callable);
          if (value.args.some(arg => arg.kind === "StarredArgument") || value.keywords.some(keyword => keyword.name === null)) {
            emit(value, "call-start");
            for (const arg of value.args) {
              expr(arg.kind === "StarredArgument" ? arg.value : arg);
              emit(arg, arg.kind === "StarredArgument" ? "call-star" : "call-argument");
            }
            for (const keyword of value.keywords) {
              expr(keyword.value);
              if (keyword.name === null) emit(value, "call-mapping"); else emit(value, "call-keyword", keyword.name);
            }
            emit(value, "call-expanded");
          } else {
            value.args.forEach(expr); value.keywords.forEach(keyword => expr(keyword.value));
            emit(value, "call", value.args.length, value.keywords.map(keyword => keyword.name));
          }
        } else this.fail("Expression is outside the source profile.", value);
      };
      const assign = target => {
        if (target.kind === "Starred") { assign(target.value); return; }
        if (["List", "Tuple"].includes(target.kind)) {
          if (target.items.length > 128) this.fail("Unpacking target budget exceeded.", target, "COMPILE_BUDGET");
          const star = target.items.findIndex(item => item.kind === "Starred"), parts = this.temporary(scope, target);
          emit(target, "unpack", star < 0 ? target.items.length : star, star < 0 ? null : target.items.length - star - 1);
          emit(target, "store", parts);
          target.items.forEach((item, index) => {
            emit(item, "load", parts); emit(item, "const", this.constant({type: "int", value: String(index)}, item));
            emit(item, "getitem"); assign(item);
          });
          emit(target, "delete", parts); return;
        }
        if (target.kind === "Name") { emit(target, "store", target.name); return; }
        const item = this.temporary(scope, target); emit(target, "store", item);
        if (target.kind === "Attribute") {
          expr(target.value); emit(target, "load", item); emit(target, "attribute-set", attribute(target, true)); emit(target, "pop"); emit(target, "delete", item); return;
        }
        expr(target.value); expr(target.index); emit(target, "load", item); emit(target, "setitem"); emit(target, "pop"); emit(target, "delete", item);
      };
      const statement = value => {
        this.charge(value);
        if (value.kind === "Pass" || value.kind === "Declaration") return;
        if (value.kind === "Expr") { expr(value.value); emit(value, "pop"); }
        else if (value.kind === "Assert") {
          expr(value.test); const failure = emit(value.test, "jump-if-false", 0), done = emit(value, "jump", 0);
          instructions[failure][1] = instructions.length;
          if (value.message) expr(value.message);
          emit(value, "assertion-error", value.message !== null); emit(value, "raise");
          instructions[done][1] = instructions.length;
        }
        else if (value.kind === "Assign") {
          expr(value.value);
          value.targets.forEach((target, index) => { if (index < value.targets.length - 1) emit(value, "dup"); assign(target); });
        } else if (value.kind === "Augment") {
          const target = value.target;
          if (target.kind === "Name") { expr(target); expr(value.value); emit(value, "inplace-" + value.operator); emit(target, "store", target.name); }
          else if (target.kind === "Attribute") {
            attribute(target, true);
            const owner = this.temporary(scope, value), item = this.temporary(scope, value);
            expr(target.value); emit(target, "store", owner); emit(target, "load", owner); emit(target, "attribute-get", target.name);
            expr(value.value); emit(value, "inplace-" + value.operator); emit(value, "store", item);
            emit(target, "load", owner); emit(value, "load", item); emit(target, "attribute-set", target.name); emit(value, "pop");
            emit(value, "delete", owner); emit(value, "delete", item);
          }
          else {
            const owner = this.temporary(scope, value), key = this.temporary(scope, value), item = this.temporary(scope, value);
            expr(target.value); emit(target, "store", owner); expr(target.index); emit(target, "store", key);
            emit(target, "load", owner); emit(target, "load", key); emit(target, "getitem"); expr(value.value); emit(value, "inplace-" + value.operator); emit(value, "store", item);
            emit(target, "load", owner); emit(target, "load", key); emit(value, "load", item); emit(value, "setitem"); emit(value, "pop");
            for (const name of [owner, key, item]) emit(value, "delete", name);
          }
        } else if (value.kind === "Delete") {
          const remove = target => {
            if (["Tuple", "List"].includes(target.kind)) { target.items.forEach(remove); return; }
            if (target.kind === "Name") emit(target, "delete", target.name);
            else if (target.kind === "Attribute") { expr(target.value); emit(target, "attribute-delete", attribute(target, true)); emit(target, "pop"); }
            else { expr(target.value); expr(target.index); emit(target, "dict-delete"); emit(target, "pop"); }
          };
          value.targets.forEach(remove);
        } else if (["Function", "Class"].includes(value.kind)) {
          const decorators = (value.decorators || []).map(decorator => {
            const name = this.temporary(scope, decorator); expr(decorator); emit(decorator, "store", name);
            return {name, site: decorator};
          });
          if (value.kind === "Function") makeFunction(value);
          else {
            if (value.bases.length > 16) this.fail("Class base budget exceeded.", value, "COMPILE_BUDGET");
            value.bases.forEach(expr); emit(value, "class", this.scopeOf.get(value).index, value.bases.length);
          }
          if (decorators.length) {
            const result = this.temporary(scope, value); emit(value, "store", result);
            for (const decorator of decorators.toReversed()) {
              emit(decorator.site, "load", decorator.name); emit(value, "load", result);
              emit(decorator.site, "call", 1, []); emit(value, "store", result);
            }
            emit(value, "load", result); emit(value, "delete", result);
            for (const decorator of decorators) emit(decorator.site, "delete", decorator.name);
          }
          emit(value, "store", value.bindingName ?? value.name);
        }
        else if (value.kind === "ComprehensionInsert") {
          expr(value.receiver);
          if (value.key) expr(value.key);
          expr(value.value);
          emit(value, value.key ? "dict-insert" : value.form === "set" ? "set-insert" : "list-push"); emit(value, "pop");
        }
        else if (value.kind === "Return") { value.value ? expr(value.value) : pushNone(value); emit(value, "return"); }
        else if (value.kind === "Raise") { if (value.value) { expr(value.value); emit(value, "raise"); } else emit(value, "reraise"); }
        else if (value.kind === "Break" || value.kind === "Continue") emit(value, value.kind.toLowerCase());
        else if (value.kind === "If") { expr(value.test); emit(value, "if", makeBlock(value.body), makeBlock(value.otherwise)); }
        else if (value.kind === "While") emit(value, "while", makeBlock([value.test], true), makeBlock(value.body), makeBlock(value.otherwise));
        else if (value.kind === "For") {
          if (value.target.kind === "Name") emit(value, value.acquired ? "for-iterator" : "for", value.target.name, makeBlock([value.iterable], true), makeBlock(value.body), makeBlock(value.otherwise));
          else {
            const item = this.temporary(scope, value.target), span = value.target.span;
            const assignItem = {kind: "Assign", span, targets: [value.target], value: {kind: "Name", span, name: item}};
            const clearItem = {kind: "Delete", span, targets: [{kind: "Name", span, name: item}]};
            emit(value, value.acquired ? "for-iterator" : "for", item, makeBlock([value.iterable], true), makeBlock([assignItem, clearItem, ...value.body]), makeBlock(value.otherwise));
          }
        }
        else if (value.kind === "Try") {
          const handlers = value.handlers.map(handler => {
            if (handler.types.some(type => !Object.hasOwn(EXCEPTIONS, type.name))) this.fail("Handlers must name adopted builtin exception classes.", handler);
            return [handler.types.map(type => type.name), handler.alias, makeBlock(handler.body), handler.span];
          });
          emit(value, "try", makeBlock(value.body), handlers, value.otherwise.length ? makeBlock(value.otherwise) : null, value.final.length ? makeBlock(value.final) : null);
        } else if (value.kind === "Import") {
          if (value.specifier === "__future__" && value.level === 0) this.fail("Future compiler directives are outside the source profile.", value);
          const valid = name => name.length <= 192 && MODULE_NAME.test(name);
          if (value.level > 32 || (value.specifier && !valid(value.specifier)) || (value.specifier === null && value.aliases.some(alias => !valid(alias.name)))) this.fail("Module identities require the bounded ASCII registry profile.", value);
          this.imports.push({specifier: value.specifier, level: value.level, aliases: value.aliases.map(alias => ({...alias}))});
          if (value.specifier === null) for (const alias of value.aliases) {
            emit(value, "import", alias.name, 0, true);
            if (alias.asname) for (const part of alias.name.split(".").slice(1)) emit(value, "import-from", part);
            emit(value, "store", alias.bindingName ?? alias.asname ?? alias.name.split(".")[0]);
          } else {
            emit(value, "import", value.specifier, value.level, false);
            value.aliases.forEach((alias, index) => {
              if (index < value.aliases.length - 1) emit(value, "dup");
              emit(value, "import-from", alias.name); emit(value, "store", alias.bindingName ?? alias.asname ?? alias.name);
            });
          }
        } else this.fail("Statement is outside the source profile.", value);
      };
      for (const value of nodes) expression ? expr(value) : statement(value);
      emit(nodes.at(-1) || node, "end"); return id;
    };
    fn.body = makeBlock(node.body); fn.locals = [...scope.locals].sort();
  }
  compile() {
    this.resolve(); this.scopes.forEach(scope => this.function(scope));
    try { verifyFunctions(this.program); }
    catch (error) {
      if (/budget|exceed|nesting|bounded|256|128|1024/i.test(error.message)) this.fail(error.message, this.parsed.module, "COMPILE_BUDGET");
      throw error;
    }
    const bytecodeBytes = new TextEncoder().encode(JSON.stringify(this.program)).byteLength;
    if (bytecodeBytes > 1048576) this.fail("Bytecode asset budget exceeded.", this.parsed.module, "COMPILE_BUDGET");
    return freezeSourceTree({program: this.program, imports: this.imports, filename: this.parsed.filename, languageProfile: this.parsed.languageProfile,
      source: this.parsed.source, stats: {...this.parsed.stats, work: this.work, functions: this.scopes.length,
        blocks: this.blocks, instructions: this.instructions, bytecodeBytes}});
  }
}

export function compileSource(source, options = {}) { return new Compiler(parseSource(source, options), options).compile(); }
