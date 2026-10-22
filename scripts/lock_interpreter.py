"""Check or explicitly refresh the known source-console engine allowlist."""

import argparse
import hashlib
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
NAMES = sorted(['browser-protocol.mjs', 'bytecode.mjs', 'class-policy.mjs', 'class-values.mjs', 'function-bytecode.mjs',
    'function-objects.mjs', 'functions.mjs', 'interpreter-host.mjs', 'interpreter-worker.mjs',
    'memory.mjs', 'numeric.mjs', 'operation-runtime.mjs', 'operations.mjs', 'module-context.mjs', 'module-registry.mjs', 'module-session.mjs',
    'source-compiler.mjs', 'source-identifiers.mjs', 'source-modules.mjs',
    'source-parser.mjs', 'source-tokens.mjs', 'string-printability.mjs', 'values.mjs', 'vm.mjs',
    'library-selection.mjs', 'library-catalog.mjs',
    'licenses/POCKET-PYTHON.txt', 'licenses/UNICODE.txt'])


def generate():
    files, imports, digest = [], [], hashlib.sha256()
    for name in NAMES:
        data = (ROOT / 'runtime' / name).read_bytes().replace(b'\r\n', b'\n')
        files.append((name, len(data), hashlib.sha256(data).hexdigest()))
        for part in (name.encode(), data):
            digest.update(len(part).to_bytes(8, 'big'))
            digest.update(part)
        if name.endswith('.mjs'):
            for target in re.findall(r'^import\b[^;]*?\bfrom\s+"\./([^"\n]+)";', data.decode(), flags=re.MULTILINE):
                if target not in NAMES:
                    raise ValueError('Unrecorded engine dependency: ' + target)
                imports.append((name, target))
    imports.append(('interpreter-host.mjs', 'interpreter-worker.mjs'))
    text = '"""Known source-console assets, canonical LF bytes; refresh with scripts/lock_interpreter.py."""\n\n'
    text += 'ENGINE_FINGERPRINT = ' + repr(digest.hexdigest()) + '\n'
    text += 'ENGINE_FILES = (\n' + ''.join('    ' + repr(item) + ',\n' for item in files) + ')\n'
    text += 'ENGINE_IMPORTS = (\n' + ''.join('    ' + repr(item) + ',\n' for item in sorted(imports)) + ')\n'
    return text


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Refresh the checked-in allowlist after reviewing engine changes.')
    args = parser.parse_args()
    target = ROOT / 'src/pocket_python/_interpreter_lock.py'
    expected = generate()
    if args.write:
        target.write_text(expected, encoding='utf-8', newline='\n')
    elif not target.is_file() or target.read_text(encoding='utf-8') != expected:
        sys.exit('Source-console engine lock differs; review changes before refreshing it.')
    print('Source-console engine lock verified')
