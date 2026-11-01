"""Shared validation inventory; commands run from the repository root."""

from dataclasses import dataclass
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Check:
    id: str
    suite: str
    command: tuple[str, ...]
    seconds: float = 1


# Aliases compose the same checks used by the individual CI jobs.
SUITES = {
    'python': ('python',),
    'prepare-browser': ('prepare-browser',),
    'node-unit': ('node-unit',),
    'node-conformance': ('node-conformance',),
    'reference': ('reference',),
    'browser-conformance': ('browser-conformance',),
    'browser-integration': ('browser-integration',),
    'measurements': ('measurements',),
    'smoke': ('smoke',),
    'focused': ('node-unit', 'node-conformance'),
    'interpreter': ('node-unit', 'node-conformance'),
    'browser': ('browser-conformance', 'browser-integration'),
    'pr': ('python', 'prepare-browser', 'node-unit', 'node-conformance',
           'browser-conformance', 'browser-integration'),
    'full': ('python', 'prepare-browser', 'node-unit', 'node-conformance',
             'reference', 'browser-conformance', 'browser-integration', 'measurements', 'smoke'),
}

CORPORA = (
    'practical-containers',
    'object-integration',
    'dynamic-imports', 'dynamic-exec', 'dynamic-eval', 'dynamic-compile',
    'property-diagnostics',
    'native-attributes', 'native-protocols',
    'arithmetic-dispatch',
    'reassignment',
    'native-object-subclasses',
    'mutable-subclasses',
    'immutable-subclasses',
    'slots',
    'metaclass-protocols',
    'custom-mro',
    'metaclass-factories',
    'prepared-class-namespaces',
    'expanded-class-bases',
    'native-directory-closure',
    'wrapper-super-directories',
    'advertised-directories',
    'integer-identity',
    'generator-frames',
    'code-cells',
    'function-state',
    'wrapper-metadata',
    'class-mapping-proxies',
    'native-namespaces',
    'class-body-namespaces',
    'module-namespaces',
    'iterator-type-directories',
    'callable-type-directories',
    'container-type-directories',
    'numeric-type-directories',
    'classes', 'private-names', 'descriptors', 'special-calls', 'length-truth',
    'formatting', 'indexing', 'iteration', 'equality', 'numeric', 'sequences',
    'function-binding', 'function-dictionaries', 'instance-dictionaries', 'class-namespaces', 'function-directories', 'method-directories', 'namespace-view-directories', 'property-directories', 'native-callable-directories', 'generator-directories', 'iterator-directories', 'numeric-directories', 'sequence-directories', 'container-directories', 'buffer-directories', 'instance-directories', 'class-directories', 'ordinary-syntax', 'value-families', 'generators',
    'construction', 'attribute-hooks', 'type-checks', 'reflection', 'repetition',
    'subclass-initialization', 'metaclass-attributes', 'nested-descriptors',
    'native-descriptors', 'descriptor-binding', 'native-rebinding', 'property-names', 'abstract-flags', 'documentation', 'function-metadata', 'type-reflection', 'execution', 'object-hashing', 'ordering', 'object-protocols',
)
CORE_CORPORA = {'practical-containers', 'sequences', 'function-binding', 'ordinary-syntax', 'value-families',
                'generators', 'repetition', 'ordering'}
PARKED_CORPORA = {'practical-containers', 'object-integration','dynamic-imports', 'dynamic-exec', 'dynamic-eval', 'dynamic-compile','property-diagnostics','native-attributes', 'native-protocols','arithmetic-dispatch','reassignment','native-object-subclasses','mutable-subclasses','immutable-subclasses','slots','metaclass-protocols','custom-mro','metaclass-factories','prepared-class-namespaces','expanded-class-bases','native-directory-closure','wrapper-super-directories','advertised-directories','integer-identity','generator-frames','code-cells','function-state','wrapper-metadata','class-mapping-proxies', 'native-namespaces', 'class-body-namespaces', 'module-namespaces', 'iterator-type-directories', 'callable-type-directories', 'container-type-directories', 'numeric-type-directories', 'instance-directories', 'class-directories', 'namespace-view-directories', 'property-directories', 'native-callable-directories', 'generator-directories', 'iterator-directories', 'numeric-directories', 'sequence-directories', 'container-directories', 'buffer-directories', 'instance-directories', 'class-directories', 'method-directories', 'function-directories', 'class-namespaces', 'instance-dictionaries', 'function-dictionaries', 'metaclass-attributes', 'nested-descriptors', 'native-descriptors', 'descriptor-binding', 'native-rebinding', 'property-names', 'abstract-flags', 'documentation', 'function-metadata', 'type-reflection',
                  'execution', 'object-hashing'}
REFERENCE_CORPORA = {
    'practical-containers',
    'object-integration',
    'dynamic-imports', 'dynamic-exec', 'dynamic-eval', 'dynamic-compile',
    'property-diagnostics',
    'native-attributes', 'native-protocols',
    'arithmetic-dispatch',
    'reassignment',
    'native-object-subclasses',
    'mutable-subclasses',
    'immutable-subclasses',
    'slots',
    'metaclass-protocols',
    'custom-mro',
    'metaclass-factories',
    'prepared-class-namespaces',
    'expanded-class-bases',
    'native-directory-closure',
    'wrapper-super-directories',
    'advertised-directories',
    'integer-identity',
    'generator-frames',
    'code-cells',
    'function-state',
    'wrapper-metadata',
    'class-mapping-proxies',
    'native-namespaces',
    'class-body-namespaces',
    'module-namespaces',
    'iterator-type-directories',
    'callable-type-directories',
    'container-type-directories',
    'numeric-type-directories',
    'instance-directories', 'class-directories', 'classes', 'ordering', 'subclass-initialization', 'metaclass-attributes',
    'function-binding', 'function-dictionaries', 'instance-dictionaries', 'class-namespaces', 'function-directories', 'method-directories', 'namespace-view-directories', 'property-directories', 'native-callable-directories', 'generator-directories', 'iterator-directories', 'numeric-directories', 'sequence-directories', 'container-directories', 'buffer-directories', 'instance-directories', 'class-directories', 'ordinary-syntax', 'value-families', 'iteration', 'equality',
    'indexing', 'private-names', 'descriptors', 'nested-descriptors',
    'native-descriptors', 'descriptor-binding', 'native-rebinding', 'property-names', 'abstract-flags', 'documentation', 'function-metadata', 'type-reflection', 'special-calls', 'length-truth', 'execution', 'formatting',
    'numeric',
}
STAGES = {'numeric': ('N1', 'N2', 'N3', 'N4', 'N5', 'Future'),
          'sequences': ('Q1', 'Q2', 'Q3', 'Hints')}


def checks():
    """Expand profile/driver matrices once for local and CI callers."""
    result = []

    def add(id, suite, *command, seconds=1):
        result.append(Check(id, suite, tuple(command), seconds))

    for name, command in (
        ('prepare-runtime', ('python', 'scripts/prepare_runtime.py')),
        ('lock-interpreter', ('python', 'scripts/lock_interpreter.py')),
        ('lock-library-profiles', ('python', 'scripts/lock_library_profiles.py')),
        ('python-unit', ('python', '-m', 'unittest', 'discover', '-s', 'tests', '-v')),
        ('build-distributions', ('uv', 'build')),
        ('check-distributions', ('python', 'scripts/check_distributions.py')),
    ):
        add(name, 'python', *command)
    add('prepare-browser', 'prepare-browser', 'python', 'scripts/prepare_browser.py')

    for path in sorted((ROOT / 'runtime').glob('*.test.mjs')):
        add('node-unit-' + path.name.removesuffix('.test.mjs'), 'node-unit',
            'node', '--test', path.relative_to(ROOT).as_posix())
    add('object-scope-inventory', 'node-conformance', 'python', 'runtime/check_object_scope.py',
        '--report', 'build/object-scope-report.json')
    add('generate-native-namespaces', 'node-conformance', 'python', 'scripts/generate_native_namespaces.py')
    for name in ('identifiers', 'printability'):
        add('generate-' + name, 'node-conformance', 'python',
            f'runtime/generate_{name}.py', '--check')

    for target in ('node', 'browser'):
        suite = target + '-conformance'
        for corpus in CORPORA:
            path = f'tests/fixtures/interpreter/{corpus}.json'
            # Case counts are stable cost estimates, not timing assertions.
            weight = max(1, len(json.loads((ROOT / path).read_bytes())['cases']) / 10)
            profiles = ('classes', 'core') if corpus in CORE_CORPORA else ('classes',)
            for profile in profiles:
                modes = ('drain', 'stepped', 'parked') if corpus in PARKED_CORPORA else ('drain', 'stepped')
                for mode in modes:
                    id = f'{corpus}-{profile}-{mode}-{target}'
                    args = ['--target', target, '--corpus', path]
                    if profile == 'core':
                        args += ['--profile', 'core-source/1']
                    elif corpus in STAGES:
                        args += ['--stages', *STAGES[corpus]]
                    if mode != 'drain':
                        args += ['--' + mode]
                    add(id, suite, 'python', 'runtime/check_classes.py', *args,
                        '--report', f'build/{id}-report.json', seconds=weight)
            if target == 'node' and corpus in REFERENCE_CORPORA:
                id = corpus + '-reference'
                add(id, 'reference', 'python', 'runtime/check_classes.py',
                    '--reference-only', '--corpus', path,
                    '--report', f'build/{id}-report.json', seconds=weight)

        for engine, name in (('prototype', 'interpreter'), ('vm1', 'vm1'),
                             ('vm2', 'vm2'), ('vm3', 'vm3'), ('vm4', 'modules'),
                             ('source', 'source')):
            args = [] if engine == 'prototype' else ['--engine', engine]
            add(f'{name}-{target}', suite, 'python', 'runtime/check_conformance.py',
                *args, '--target', target, '--report', f'build/{name}-{target}-report.json', seconds=5)
        for name in ('source_tokens', 'functions', 'memory', 'compatibility', 'library_profiles', 'callbacks'):
            id = name.replace('_', '-') + '-' + target
            add(id, suite, 'python', f'runtime/check_{name}.py', '--target', target,
                '--report', f'build/{id}-report.json', seconds=10)
    add('browser-worker-startup', 'browser-conformance', 'python', 'runtime/browser_smoke.py')

    for name, script, weight in (
        ('compiled', 'compiled_browser_smoke', 30),
        ('shared-application', 'shared_application_smoke', 30),
        ('interpreter-console', 'interpreter_browser_smoke', 45),
        ('library-console', 'library_profiles_browser_smoke', 30),
        ('classes-console', 'classes_console_browser_smoke', 300),
        ('object-console', 'object_integration_browser_smoke', 15),
    ):
        add(name + '-browser', 'browser-integration', 'python', f'scripts/{script}.py',
            '--report', f'build/{name}-browser-report.json', seconds=weight)
    add('micropython-browser', 'browser-integration', 'python', 'scripts/browser_smoke.py', seconds=30)
    add('containers-browser', 'browser-integration', 'python', 'scripts/object_integration_browser_smoke.py',
        '--containers', '--report', 'build/containers-browser-report.json', seconds=20)
    add('interpreter-node-measurements', 'measurements', 'python', 'scripts/interpreter_measurements.py',
        '--no-browser', '--repeats', '3', '--output', 'build/interpreter-node-measurements', seconds=10)
    add('interpreter-browser-measurements', 'measurements', 'python', 'scripts/interpreter_measurements.py',
        '--compiled', '--micropython-runtime', 'build/runtime', '--repeats', '3',
        '--output', 'build/interpreter-measurements', seconds=30)
    add('application-measurements', 'measurements', 'python', 'scripts/measure_applications.py',
        '--compiler-report', 'build/compiler-reference/docs/measurements/2026-10-20-compiler.json',
        '--repeats', '3', '--output', 'build/application-measurements', seconds=30)
    add('smoke-build-wheel', 'smoke', 'uv', 'build', '--wheel')
    add('smoke-installed-cli', 'smoke', 'python', 'scripts/smoke_install.py')
    add('smoke-interpreter-startup', 'smoke', 'node', 'scripts/startup_smoke.mjs')
    return result
