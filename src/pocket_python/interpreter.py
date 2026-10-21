"""Assemble the pinned independent source engine and one explicit console source."""

from dataclasses import dataclass
import hashlib
import html
import json
from pathlib import Path
import re

from pocket_python import __version__
from pocket_python._interpreter_lock import ENGINE_FILES, ENGINE_FINGERPRINT, ENGINE_IMPORTS
from pocket_python._library_lock import LIBRARY_PROFILES
from pocket_python.assets import ArtifactError, check_names, file_record, json_bytes, read_asset
from pocket_python.interpreter_templates import APP, PAGE, SERVICE_WORKER
from pocket_python.templates import ICON
from pocket_python.web import _publish


ENGINE = {'implementation': 'pocket-python-source', 'version': '1', 'backend': 'javascript-vm',
          'bytecode_version': 4, 'language_profile': 'core-source/1'}
LANGUAGE_ENGINES = {'core-source/1': ENGINE,
                    'classes-source/1': {**ENGINE, 'bytecode_version': 5, 'language_profile': 'classes-source/1'}}
LIMITS = {'message_bytes': 1048576, 'value_depth': 16, 'pending_requests': 1, 'subscriptions': 0,
          'output_codepoints': 16384, 'response_bytes': 1048576, 'deadline_ms': 10000,
          'source_bytes': 65536, 'compile_work': 4194304, 'execution_steps': 1000000,
          'execution_work': 100000000, 'memory_bytes': 8388608, 'memory_objects': 4096, 'memory_frames': 64}


@dataclass(frozen=True)
class InterpreterAssets:
    root: Path
    files: tuple[tuple[str, bytes], ...]
    library_profile: str = 'core-only/1'


@dataclass(frozen=True)
class ConsoleSource:
    root: Path
    manifest_bytes: bytes
    files: tuple[tuple[str, bytes], ...]


def _manifest(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ArtifactError('Duplicate console-source field: ' + key)
            result[key] = value
        return result
    try:
        manifest = json.loads(data, object_pairs_hook=pairs)
    except ArtifactError:
        raise
    except (ValueError, UnicodeError, RecursionError) as error:
        raise ArtifactError('Invalid console-source JSON.') from error
    fields = {'kind', 'schema_version', 'target', 'source', 'notice'}
    if (not isinstance(manifest, dict) or set(manifest) != fields
            or manifest['kind'] != 'pocket-python-console-source' or type(manifest['schema_version']) is not int
            or manifest['schema_version'] != 1 or manifest['target'] != 'client'):
        raise ArtifactError('Expected an explicit schema-1 client console-source allowlist.')
    for key, role in [('source', 'client-source'), ('notice', 'notice')]:
        record = manifest[key]
        if (not isinstance(record, dict) or set(record) != {'path', 'size_bytes', 'sha256', 'role'}
                or record['role'] != role or not isinstance(record['path'], str)
                or type(record['size_bytes']) is not int or not 0 <= record['size_bytes'] <= 65536
                or not isinstance(record['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', record['sha256'])):
            raise ArtifactError('Invalid bounded console source/notice record.')
        if key == 'source' and not record['path'].endswith('.py'):
            raise ArtifactError('Console source requires a Python file path.')
        if key == 'notice' and (not record['path'].startswith('LICENSES/') or not record['size_bytes']):
            raise ArtifactError('Console source requires a nonempty notice under LICENSES/.')
    check_names(manifest[key]['path'] for key in ['source', 'notice'])
    return manifest


def _source_snapshot(source):
    if not isinstance(source, ConsoleSource) or type(source.manifest_bytes) is not bytes or not isinstance(source.files, tuple):
        raise ArtifactError('Expected an immutable console-source snapshot.')
    manifest, files = _manifest(source.manifest_bytes), dict(source.files)
    if len(files) != len(source.files) or set(files) != {manifest[key]['path'] for key in ['source', 'notice']}:
        raise ArtifactError('Console-source snapshot file set changed.')
    for key in ['source', 'notice']:
        record = manifest[key]
        data = files[record['path']]
        if type(data) is not bytes or file_record(record['path'], data) != {field: record[field] for field in ['path', 'size_bytes', 'sha256']}:
            raise ArtifactError('Console-source snapshot hash/size differs.')
        try:
            text = data.decode('utf-8')
        except UnicodeError as error:
            raise ArtifactError('Console source and notice require UTF-8.') from error
        if key == 'notice' and not text.strip():
            raise ArtifactError('Console source notice is empty.')
        if key == 'source' and text.startswith('\ufeff'):
            raise ArtifactError('The console editor requires UTF-8 source without a BOM.')
    return manifest, files


def _library_profile(identity):
    if not isinstance(identity, str) or identity not in LIBRARY_PROFILES:
        raise ArtifactError('Unknown library profile; no fallback is selected.')
    return LIBRARY_PROFILES[identity]


def _engine_snapshot(engine):
    if not isinstance(engine, InterpreterAssets) or not isinstance(engine.files, tuple):
        raise ArtifactError('Expected an immutable independent-engine snapshot.')
    files = dict(engine.files)
    profile = _library_profile(engine.library_profile)
    optional = {record['source']['path']: record['source'] for record in profile['modules']}
    if len(files) != len(engine.files) or set(files) != {name for name, _, _ in ENGINE_FILES} | set(optional):
        raise ArtifactError('Independent-engine file set differs from the pinned allowlist.')
    digest = hashlib.sha256()
    for name, size, sha in ENGINE_FILES:
        data = files[name]
        if type(data) is not bytes or len(data) != size or hashlib.sha256(data).hexdigest() != sha:
            raise ArtifactError('Independent-engine asset differs from the supported pinned build: ' + name)
        for part in (name.encode(), data):
            digest.update(len(part).to_bytes(8, 'big'))
            digest.update(part)
    if digest.hexdigest() != ENGINE_FINGERPRINT:
        raise ArtifactError('Independent-engine fingerprint differs.')
    for record in [*optional.values(), *(record['notice'] for record in profile['modules'])]:
        if record['path'] not in files or type(files[record['path']]) is not bytes or file_record(record['path'], files[record['path']]) != record:
            raise ArtifactError('Library source/notice differs from its reviewed identity.')
    return files


def read_console_source(manifest_path: str | Path) -> ConsoleSource:
    path = Path(manifest_path).absolute()
    data = read_asset(path.parent, path.name, max_bytes=65536)
    manifest = _manifest(data)
    files = tuple((record['path'], read_asset(path.parent, record['path'], max_bytes=record['size_bytes']))
                  for record in [manifest['source'], manifest['notice']])
    result = ConsoleSource(path.parent, data, files)
    _source_snapshot(result)
    return result


def read_interpreter(root: str | Path, *, library_profile: str = 'core-only/1') -> InterpreterAssets:
    root = Path(root).absolute()
    profile = _library_profile(library_profile)
    # Canonicalize checkout line endings only; source inputs retain exact bytes.
    files = tuple((name, read_asset(root, name, max_bytes=max(2 * size, 1)).replace(b'\r\n', b'\n')) for name, size, _ in ENGINE_FILES)
    files += tuple((record['source']['path'], read_asset(root, record['source']['path'], max_bytes=2 * record['source']['size_bytes']).replace(b'\r\n', b'\n')) for record in profile['modules'])
    result = InterpreterAssets(root, files, library_profile)
    _engine_snapshot(result)
    return result


def build_interpreter(source: ConsoleSource, engine: InterpreterAssets, output: str | Path,
                      *, title: str = 'Pocket Python Console', host_profile: str = 'output-only/1',
                      language_profile: str = 'core-source/1') -> dict:
    if not isinstance(language_profile, str) or language_profile not in LANGUAGE_ENGINES:
        raise ArtifactError('Unavailable source language profile.')
    language = dict(LANGUAGE_ENGINES[language_profile])
    manifest, source_files = _source_snapshot(source)
    engine_files = _engine_snapshot(engine)
    profile = _library_profile(engine.library_profile)
    if host_profile != 'output-only/1':
        raise ArtifactError('Unavailable host-module profile; async adapters require INT-10.')
    requested = Path(output).absolute()
    if requested.exists() or requested.is_symlink():
        raise ArtifactError('Output already exists; choose a new directory.')
    destination = requested.resolve()
    for root in [source.root.resolve(), engine.root.resolve()]:
        if destination.is_relative_to(root) or root.is_relative_to(destination):
            raise ArtifactError('Output overlaps an input root.')
    if not isinstance(title, str) or not title.strip() or len(title) > 256:
        raise ArtifactError('Console title requires 1–256 characters.')

    engine_root = 'engine/' + ENGINE_FINGERPRINT
    identity = {'kind': 'pocket-python-source-console', 'schema_version': 1,
                'profile': 'in-house-interpreter', 'profile_version': 1, 'engine': {**language, 'fingerprint': ENGINE_FINGERPRINT},
                'library_profile': profile, 'host_profile': host_profile,
                'source': manifest['source'], 'notice': manifest['notice'], 'capabilities': [{'id': 'output/1'}], 'limits': LIMITS}
    identity_bytes = json_bytes(identity)
    source_root = 'application/' + hashlib.sha256(identity_bytes).hexdigest()
    files = {engine_root + '/' + name: data for name, data in engine_files.items()}
    source_path = source_root + '/sources/app.py'
    notice_path = source_root + '/' + manifest['notice']['path']
    files.update({source_path: source_files[manifest['source']['path']], notice_path: source_files[manifest['notice']['path']],
                  source_root + '/APPLICATION.json': identity_bytes})
    libraries = [{**{key: record[key] for key in ['name', 'package', 'imports']},
                  **{key: file_record(engine_root + '/' + record[key]['path'], engine_files[record[key]['path']]) for key in ['source', 'notice']}}
                 for record in profile['modules']]
    config = {'application': {'manifest_sha256': hashlib.sha256(identity_bytes).hexdigest(), 'profile': 'in-house-interpreter',
                             'profile_version': 1, 'entrypoint': 'sources/app.py', 'engine': language},
              'library_profile': profile['id'], 'libraries': libraries, 'host_profile': host_profile,
              'source': file_record(source_path, files[source_path]), 'capabilities': identity['capabilities'], 'limits': LIMITS}
    config_bytes = json_bytes(config)
    config_sha = hashlib.sha256(config_bytes).hexdigest()
    config_path = 'app-config-' + config_sha + '.json'
    launcher = APP.replace('__ENGINE__', engine_root).replace('__CONFIG__', config_path).replace('__CONFIG_SHA__', config_sha).encode()
    launcher_path = 'app-' + hashlib.sha256(launcher).hexdigest() + '.js'
    files.update({config_path: config_bytes, launcher_path: launcher,
                  'index.html': PAGE.replace('__LAUNCHER__', launcher_path).replace('__TITLE__', html.escape(title, quote=True)).encode(),
                  'icon.svg': ICON.encode(), 'manifest.webmanifest': json_bytes({'name': title, 'short_name': title[:24], 'id': './',
                  'start_url': './', 'scope': './', 'display': 'standalone', 'theme_color': '#225841', 'background_color': '#f4f7f1',
                  'icons': [{'src': './icon.svg', 'sizes': 'any', 'type': 'image/svg+xml'}]})})
    roles = {name: 'data' for name in files}
    roles.update({engine_root + '/' + name: 'notice' if name.startswith('licenses/') else 'engine' for name in engine_files})
    roles.update({record['source']['path']: 'library' for record in libraries})
    roles.update({source_path: 'source', notice_path: 'notice', launcher_path: 'executable-module'})
    records = [file_record(name, data) for name, data in sorted(files.items())]
    cache_version = hashlib.sha256(json_bytes({'profile': 'in-house-interpreter/1', 'pocket_python_version': __version__,
        'service_worker_template': hashlib.sha256(SERVICE_WORKER.encode()).hexdigest(), 'files': records})).hexdigest()
    files['service-worker.js'] = SERVICE_WORKER.replace('__RECORDS__', json.dumps(records, sort_keys=True)).replace('__VERSION__', cache_version).encode()
    roles['service-worker.js'] = 'executable-module'
    receipt = {'kind': 'pocket-python-application', 'schema_version': 2, 'target': 'client', 'profile': 'in-house-interpreter',
               'profile_version': 1, 'pocket_python_version': __version__, 'title': title, 'ui_profile': 'source-console/1',
               'entrypoint': {'path': source_path, 'kind': 'python-source'}, 'ui_entrypoint': 'index.html',
               'launcher': launcher_path, 'configuration': config_path, 'application_manifest': source_root + '/APPLICATION.json',
               'engine': {**language, 'fingerprint': ENGINE_FINGERPRINT, 'entrypoint': engine_root + '/interpreter-worker.mjs'},
               'producer': {'name': 'pocket-python', 'version': __version__, 'language_profile': language_profile},
               'source_execution': True, 'input_mode': 'source', 'capabilities': identity['capabilities'], 'limits': LIMITS,
               'library_profile': {'id': profile['id'], 'fingerprint': profile['fingerprint']}, 'libraries': libraries, 'host_profile': host_profile,
               'sources': [{**file_record(source_path, files[source_path]), 'original_path': manifest['source']['path'], 'logical_path': 'sources/app.py'}] +
                          [{**record['source'], 'original_path': definition['source']['path'],
                            'logical_path': 'sources/' + record['name'].replace('.', '/') + '.py'} for record, definition in zip(libraries, profile['modules'])],
               'imports': [{'from': launcher_path, 'to': engine_root + '/interpreter-host.mjs'}] +
                          [{'from': engine_root + '/' + origin, 'to': engine_root + '/' + target} for origin, target in ENGINE_IMPORTS],
               'licenses': sorted(name for name in files if roles[name] == 'notice'), 'cache_version': cache_version,
               'files': [{**file_record(name, data), 'role': roles[name]} for name, data in sorted(files.items())],
               'size': {**{role + '_bytes': sum(len(data) for name, data in files.items() if roles[name] == role)
                          for role in ['source', 'engine', 'library', 'notice', 'data']},
                        'assembly_module_bytes': sum(len(data) for name, data in files.items() if roles[name] == 'executable-module'),
                        'receipt_bytes': 0, 'artifact_bytes': 0}}
    payload_size = sum(map(len, files.values()))
    while True:
        data = json_bytes(receipt)
        total = payload_size + len(data)
        if total == receipt['size']['artifact_bytes'] and len(data) == receipt['size']['receipt_bytes']:
            break
        receipt['size']['artifact_bytes'], receipt['size']['receipt_bytes'] = total, len(data)
    files['POCKET-PYTHON.json'] = data
    _publish(destination, files)
    return receipt
