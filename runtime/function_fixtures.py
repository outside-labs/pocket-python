"""Trusted test-only CPython AST lowering to our version 3 bytecode.

This is not the independent source parser and is never loaded by a worker.
"""

import ast
import json
import struct
import symtable


class FixtureError(ValueError):
    pass


def tagged(value):
    if value is None:
        return {"type": "none"}
    if type(value) is bool:
        return {"type": "bool", "value": value}
    if type(value) is int:
        return {"type": "int", "value": str(value)}
    if type(value) is float:
        return {"type": "float", "bits": struct.pack(">d", value).hex()}
    if type(value) is str:
        return {"type": "str", "codepoints": list(map(ord, value))}
    if type(value) is tuple:
        return {"type": "tuple", "items": [tagged(item) for item in value]}
    raise FixtureError("Only immutable literal defaults/constants are adopted")


def compile_fixture(source, filename="fixture.py"):
    tree = ast.parse(source, filename)
    compile(tree, filename, "exec")  # Validate syntax/context, without running it.
    symbols = symtable.symtable(source, filename, "exec")
    program = {"format": "pocket-python-bytecode", "version": 3, "constants": [], "functions": []}
    constant_ids = {}

    def constant(value):
        record = tagged(value)
        key = json.dumps(record, sort_keys=True)
        if key not in constant_ids:
            constant_ids[key] = len(program["constants"])
            program["constants"].append(record)
        return constant_ids[key]

    def function(node, scope, parent=None):
        index = len(program["functions"])
        is_module = isinstance(node, ast.Module)
        params = {"posonly": [], "positional": [], "kwonly": [], "defaults": [], "kwdefaults": {}}
        if not is_module:
            args = node.args
            if node.decorator_list or node.returns or args.vararg or args.kwarg or node.type_params:
                raise FixtureError("Decorators, annotations and starred parameters are deferred")
            for key, group in (("posonly", args.posonlyargs), ("positional", args.args), ("kwonly", args.kwonlyargs)):
                if any(arg.annotation for arg in group):
                    raise FixtureError("Parameter annotations are deferred")
                params[key] = [arg.arg for arg in group]
            def literal(expr):
                # literal_eval rejects calls, names and arithmetic/computed defaults.
                try:
                    return constant(ast.literal_eval(expr))
                except (ValueError, TypeError) as error:
                    raise FixtureError("Only immutable literal defaults are adopted") from error
            params["defaults"] = [literal(expr) for expr in args.defaults]
            params["kwdefaults"] = {arg.arg: literal(expr) for arg, expr in zip(args.kwonlyargs, args.kw_defaults) if expr is not None}
        locals_ = sorted(symbol.get_name() for symbol in scope.get_symbols() if symbol.is_local())
        free = [] if is_module else sorted(scope.get_frees())
        qualname = "<module>" if is_module else (parent + ".<locals>." if parent else "") + node.name
        fn = {"name": "<module>" if is_module else node.name, "qualname": qualname, "params": params, "locals": locals_,
              "free": free, "body": None, "blocks": []}
        program["functions"].append(fn)

        def span(node):
            return [getattr(node, "lineno", 1), getattr(node, "col_offset", 0) + 1,
                    getattr(node, "end_lineno", 1), getattr(node, "end_col_offset", 0) + 1]

        def block(nodes, expression=False):
            instructions, spans = [], []
            block_id = len(fn["blocks"])
            result = {"kind": "expression" if expression else "statement", "instructions": instructions,
                      "source": {"filename": filename, "spans": spans}}
            fn["blocks"].append(result)
            def emit(node, *instruction):
                instructions.append(list(instruction)); spans.append(span(node))
            binary = {ast.Add: "add", ast.Sub: "subtract", ast.Mult: "multiply", ast.FloorDiv: "floor-divide", ast.Mod: "modulo", ast.Div: "divide"}
            comparisons = {ast.Eq: "equal", ast.NotEq: "not-equal", ast.Lt: "less", ast.LtE: "less-equal", ast.Gt: "greater", ast.GtE: "greater-equal", ast.Is: "is", ast.In: "contains"}
            def expr(value):
                if isinstance(value, ast.Constant):
                    emit(value, "const", constant(value.value))
                elif isinstance(value, ast.Name):
                    emit(value, "load", value.id)
                elif isinstance(value, (ast.List, ast.Tuple)):
                    for item in value.elts:
                        expr(item)
                    emit(value, "build-list" if isinstance(value, ast.List) else "build-tuple", len(value.elts))
                elif isinstance(value, ast.Dict):
                    for key, item in zip(value.keys, value.values):
                        if key is None:
                            raise FixtureError("Dictionary unpacking is deferred")
                        expr(key); expr(item)
                    emit(value, "build-dict", len(value.keys))
                elif isinstance(value, ast.BinOp) and type(value.op) in binary:
                    expr(value.left); expr(value.right); emit(value, binary[type(value.op)])
                elif isinstance(value, ast.UnaryOp) and type(value.op) in (ast.Not, ast.USub, ast.UAdd):
                    expr(value.operand); emit(value, {ast.Not: "not", ast.USub: "negative", ast.UAdd: "positive"}[type(value.op)])
                elif isinstance(value, ast.Compare) and len(value.ops) == 1 and type(value.ops[0]) in comparisons:
                    expr(value.left); expr(value.comparators[0])
                    if isinstance(value.ops[0], ast.In):
                        emit(value, "swap")
                    emit(value, comparisons[type(value.ops[0])])
                elif isinstance(value, ast.BoolOp):
                    jumps = []
                    for item in value.values[:-1]:
                        expr(item); emit(item, "dup")
                        if isinstance(value.op, ast.Or):
                            emit(item, "not")
                        jumps.append(len(instructions)); emit(item, "jump-if-false", 0); emit(item, "pop")
                    expr(value.values[-1])
                    for jump in jumps:
                        instructions[jump][1] = len(instructions)
                elif isinstance(value, ast.Subscript):
                    expr(value.value)
                    if isinstance(value.slice, ast.Slice):
                        for item in (value.slice.lower, value.slice.upper, value.slice.step):
                            expr(item) if item else emit(value, "const", constant(None))
                        emit(value, "slice")
                    else:
                        expr(value.slice); emit(value, "getitem")
                elif isinstance(value, ast.Call):
                    if any(keyword.arg is None for keyword in value.keywords) or any(isinstance(arg, ast.Starred) for arg in value.args):
                        raise FixtureError("Starred call expansion is deferred")
                    if isinstance(value.func, ast.Attribute) and value.func.attr == "append" and len(value.args) == 1 and not value.keywords:
                        expr(value.func.value); expr(value.args[0]); emit(value, "append")
                    else:
                        expr(value.func)
                        for arg in value.args:
                            expr(arg)
                        for keyword in value.keywords:
                            expr(keyword.value)
                        emit(value, "call", len(value.args), [keyword.arg for keyword in value.keywords])
                else:
                    raise FixtureError("Deferred expression: " + type(value).__name__)

            def statement(value):
                if isinstance(value, ast.FunctionDef):
                    child = next(child for child in scope.get_children() if child.get_name() == value.name and child.get_lineno() == value.lineno)
                    emit(value, "function", function(value, child, None if is_module else qualname)); emit(value, "store", value.name)
                elif isinstance(value, ast.Assign) and all(isinstance(target, ast.Name) for target in value.targets):
                    expr(value.value)
                    for i, target in enumerate(value.targets):
                        if i < len(value.targets) - 1:
                            emit(value, "dup")
                        emit(target, "store", target.id)
                elif isinstance(value, ast.AugAssign) and isinstance(value.target, ast.Name) and type(value.op) in binary:
                    expr(value.target); expr(value.value); emit(value, binary[type(value.op)]); emit(value, "store", value.target.id)
                elif isinstance(value, ast.Delete) and all(isinstance(target, ast.Name) for target in value.targets):
                    for target in value.targets:
                        emit(target, "delete", target.id)
                elif isinstance(value, ast.Expr):
                    expr(value.value); emit(value, "pop")
                elif isinstance(value, ast.Return):
                    expr(value.value) if value.value else emit(value, "const", constant(None))
                    emit(value, "return")
                elif isinstance(value, ast.Raise) and value.cause is None:
                    if value.exc:
                        expr(value.exc); emit(value, "raise")
                    else:
                        emit(value, "reraise")
                elif isinstance(value, ast.If):
                    expr(value.test); emit(value, "if", block(value.body), block(value.orelse))
                elif isinstance(value, ast.While):
                    emit(value, "while", block([value.test], True), block(value.body), block(value.orelse))
                elif isinstance(value, ast.For) and isinstance(value.target, ast.Name):
                    emit(value, "for", value.target.id, block([value.iter], True), block(value.body), block(value.orelse))
                elif isinstance(value, ast.Try):
                    handlers = []
                    for handler in value.handlers:
                        types = [] if handler.type is None else list(handler.type.elts) if isinstance(handler.type, ast.Tuple) else [handler.type]
                        if any(not isinstance(type_, ast.Name) for type_ in types):
                            raise FixtureError("Only named builtin exception clauses are adopted")
                        handlers.append([[type_.id for type_ in types], handler.name, block(handler.body), span(handler)])
                    emit(value, "try", block(value.body), handlers, block(value.orelse) if value.orelse else None, block(value.finalbody) if value.finalbody else None)
                elif isinstance(value, (ast.Break, ast.Continue)):
                    emit(value, "break" if isinstance(value, ast.Break) else "continue")
                elif not isinstance(value, ast.Pass):
                    raise FixtureError("Deferred statement: " + type(value).__name__)
            for node_ in nodes:
                expr(node_) if expression else statement(node_)
            emit(nodes[-1] if nodes else node, "end")
            return block_id
        fn["body"] = block(node.body)
        return index
    function(tree, symbols)
    return program
