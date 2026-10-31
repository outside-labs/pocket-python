// Report ownership of stored native entries without invoking their APIs.
import {ClassRuntime} from '../runtime/class-values.mjs';
import {NATIVE_NAMESPACES} from '../runtime/native-namespaces.mjs';
import {CLASS_SPECIAL_POLICY, METACLASS_PROTOCOLS, NATIVE_PROTOCOL_KEYS} from '../runtime/class-policy.mjs';
const classes = new ClassRuntime();
const codeFields = new Set(['co_name', 'co_qualname', 'co_filename', 'co_firstlineno', 'co_argcount',
  'co_posonlyargcount', 'co_kwonlyargcount', 'co_nlocals', 'co_varnames', 'co_freevars',
  'co_cellvars', 'co_flags', 'co_names', 'co_consts']);
function fieldOwner(type, key) {
  if (['__annotations__', '__annotate__', '__type_params__'].includes(key)) return '#125';
  if (type === 'code') return codeFields.has(key) ? 'O73' : 'boundary:source-interface';
  if (type === 'frame') return ['f_code', 'f_back', 'f_globals', 'f_builtins', 'f_locals', 'f_lineno', 'f_trace'].includes(key) ? 'O74' : 'boundary:source-interface';
  if (type === 'type' && ['__basicsize__', '__itemsize__', '__flags__', '__weakrefoffset__', '__dictoffset__'].includes(key)) return 'boundary:source-interface';
  if (key === '__abstractmethods__') return '#126';
  const owner = classes.nativeFieldOwner(key);
  if (owner) return owner;
  if (type.endsWith('Error') || type === 'BaseException' || type === 'StopIteration') return '#124';
  if (type === 'memoryview') return '#117';
  if (['int', 'float', 'complex'].includes(type)) return '#184';
  if (['range', 'slice', 'dict_keys', 'dict_values', 'dict_items'].includes(type)) return '#116';
  if (type === 'property') return 'O71';
  if (type === 'super') return 'O77';
  if (type === 'generator') return 'O74';
  if (key === '__dict__') return type === 'module' ? 'O67' : 'O69';
  if (key === '__class__') return 'O69';
  if (['__base__', '__bases__', '__mro__'].includes(key)) return 'O88';
  if (['__module__', '__doc__', '__name__', '__qualname__', '__self__', '__func__', '__wrapped__', '__objclass__', '__text_signature__', '__isabstractmethod__'].includes(key)) return 'O71';
  throw new Error('Unowned native field ' + type + '.' + key);
}
const entries = Object.entries(NATIVE_NAMESPACES).flatMap(([type, entries]) => entries.map(([key, kind]) => ({
  type, key, kind, namespace_owner: 'O69',
  owner: kind === 'value' ? 'O69' : ['getset_descriptor', 'member_descriptor'].includes(kind) ?
    fieldOwner(type, key) : classes.nativeInvocationOwner({name: type + '.' + key}),
})));
process.stdout.write(JSON.stringify({types: Object.keys(NATIVE_NAMESPACES), entries,
  slots: Object.keys(CLASS_SPECIAL_POLICY), metaclass_protocols: METACLASS_PROTOCOLS, native_protocols: NATIVE_PROTOCOL_KEYS}));
