"""Verify the native namespace metadata against the pinned CPython oracle."""

import argparse
import builtins
import json
from pathlib import Path
import platform
import re
import types
import sys

ROOT = Path(__file__).resolve().parents[1]


def inventory():
    source = (ROOT / 'runtime/class-values.mjs').read_text(encoding='utf-8')
    declared = re.search(r'const NATIVE_TYPES = new Set\(\[(.*?)\]\);', source, re.S).group(1)
    names = re.findall(r'"([A-Za-z_][A-Za-z_0-9-]*)"', declared)
    exceptions = (ROOT / 'runtime/function-objects.mjs').read_text(encoding='utf-8').split('export const EXCEPTIONS = Object.freeze({', 1)[1].split('});', 1)[0]
    names += re.findall(r'([A-Za-z_][A-Za-z_0-9]*)\s*:', exceptions)
    registry = {name: getattr(builtins, name) for name in names if hasattr(builtins, name)}
    for name, label in {
        'object': 'object', 'mappingproxy': 'MappingProxyType', 'function': 'FunctionType',
        'method': 'MethodType', 'method-wrapper': 'MethodWrapperType',
        'method_descriptor': 'MethodDescriptorType', 'wrapper_descriptor': 'WrapperDescriptorType',
        'builtin_function_or_method': 'BuiltinFunctionType', 'generator': 'GeneratorType',
        'module': 'ModuleType', 'code': 'CodeType', 'frame': 'FrameType', 'cell': 'CellType', 'NoneType': 'NoneType',
        'NotImplementedType': 'NotImplementedType', 'getset_descriptor': 'GetSetDescriptorType',
        'member_descriptor': 'MemberDescriptorType', 'classmethod_descriptor': 'ClassMethodDescriptorType',
    }.items():
        registry[name] = object if label == 'object' else getattr(types, label)

    def proxy_type():
        return type(sys._getframe().f_locals)
    registry['FrameLocalsProxy'] = proxy_type()

    class Indexed:
        def __getitem__(self, key):
            return key

    for value in [iter([]), iter(()), iter('abc'), iter('😀'), iter({}), iter(range(3)),
                  iter(range(10**40, 10**40 + 3)), iter(set()), iter(b'a'),
                  iter(bytearray(b'a')), iter(memoryview(b'a')), iter(Indexed()),
                  iter(lambda: 0, 1), {}.keys(), {}.values(), {}.items(), iter({}.values()),
                  iter({}.items()), reversed({}), reversed({}.values()), reversed({}.items())]:
        registry[type(value).__name__] = type(value)
    return registry


def literal(value):
    if value is None:
        return {'type': 'none'}
    if isinstance(value, str):
        return {'type': 'text', 'value': value}
    if isinstance(value, bool):
        return {'type': 'bool', 'value': value}
    if isinstance(value, int):
        return {'type': 'int', 'value': str(value)}
    if isinstance(value, tuple):
        return {'type': 'tuple', 'items': [literal(item) for item in value]}
    raise TypeError('Unrecorded native literal: ' + type(value).__name__)


def generate():
    if platform.python_version() != '3.14.7':
        raise RuntimeError('Native namespace metadata requires CPython 3.14.7.')
    descriptors = {'wrapper_descriptor', 'method_descriptor', 'classmethod_descriptor',
                   'getset_descriptor', 'member_descriptor', 'builtin_function_or_method', 'staticmethod'}
    records, copies, documents = {}, [], {}
    for name, cls in sorted(inventory().items()):
        entries = []
        for key, value in vars(cls).items():
            kind = type(value).__name__
            if kind in descriptors:
                documents[name + '.' + key] = value.__doc__
            entries.append([key, kind] if kind in descriptors else [key, 'value', literal(value)])
        records[name] = entries
        if isinstance(cls.__doc__, str) and cls.__doc__ is not vars(cls).get('__doc__'):
            copies.append(name)
    for name, value in vars(builtins).items():
        if isinstance(value, types.BuiltinFunctionType):
            documents[name] = value.__doc__
    text = '// Own namespace entries observed with the pinned CPython 3.14.7 oracle.\n'
    text += '// Type documentation is distributed under licenses/CPYTHON.txt.\n'
    text += 'export const NATIVE_NAMESPACES = Object.freeze({\n'
    for name, entries in records.items():
        text += '  ' + json.dumps(name) + ': [\n'
        text += ''.join('    ' + json.dumps(entry, ensure_ascii=False, separators=(',', ':')) + ',\n' for entry in entries)
        text += '  ],\n'
    text += '});\nexport const NATIVE_DOC_COPIES = Object.freeze(' + json.dumps(copies) + ');\n'
    text += 'export const NATIVE_CALLABLE_DOCS = Object.freeze(' + json.dumps(documents, ensure_ascii=False, indent=2) + ');\n'
    return text


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'runtime/native-namespaces.mjs'
    expected = generate()
    if args.write:
        path.write_text(expected, encoding='utf-8', newline='\n')
    elif path.read_text(encoding='utf-8') != expected:
        raise SystemExit('Native namespace metadata differs; review before refreshing it.')
    print('Native namespace metadata verified')
