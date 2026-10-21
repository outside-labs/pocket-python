"""Assemble known compiler output from an explicit verified client source allowlist."""

from dataclasses import dataclass
import hashlib
import html
import ipaddress
from importlib import metadata, util
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlparse

from pocket_python import __version__
from pocket_python._compiler_lock import COMPILER_FILES, COMPILER_FINGERPRINT, COMPILER_REVISION, COMPILER_VERSION
from pocket_python.assets import ArtifactError, check_names, file_record, json_bytes, read_asset
from pocket_python.compiled_templates import APP, PAGE, SERVICE_WORKER
from pocket_python.templates import ICON
from pocket_python.web import _publish


def _json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ArtifactError('Duplicate JSON field: ' + key)
            result[key] = value
        return result
    try:
        value = json.loads(data, object_pairs_hook=pairs)
    except (ValueError, UnicodeError) as error:
        raise ArtifactError('Invalid compiled input JSON.') from error
    if not isinstance(value, dict):
        raise ArtifactError('Expected a compiled input object.')
    return value


@dataclass(frozen=True)
class ClientSources:
    root: Path
    manifest_bytes: bytes
    files: tuple[tuple[str, bytes], ...]


@dataclass(frozen=True)
class CompilerOutput:
    root: Path
    manifest_bytes: bytes
    files: tuple[tuple[str, bytes], ...]


def _client_manifest(data):
    manifest = _json(data)
    if set(manifest) != {'kind', 'schema_version', 'target', 'entrypoint', 'source_map', 'sources', 'notices', 'fetch_urls'} or manifest['kind'] != 'pocket-python-client' or type(manifest['schema_version']) is not int or manifest['schema_version'] != 1 or manifest['target'] != 'client':
        raise ArtifactError('Expected an explicit schema-1 client-source allowlist.')
    if not isinstance(manifest['entrypoint'], str) or type(manifest['source_map']) is not bool:
        raise ArtifactError('Client entrypoint and source-map policy are required.')
    sources, notices = manifest['sources'], manifest['notices']
    if not isinstance(sources, list) or not 1 <= len(sources) <= 32 or not isinstance(notices, list) or len(notices) > 32:
        raise ArtifactError('Declare 1–32 client sources and at most 32 notices.')
    for record, source in [(item, True) for item in sources] + [(item, False) for item in notices]:
        fields = {'path', 'sha256', 'size_bytes', 'role'} | ({'module', 'is_package'} if source else set())
        if not isinstance(record, dict) or set(record) != fields or record['role'] != ('client-source' if source else 'notice'):
            raise ArtifactError('Only explicit client-source and notice records are accepted.')
        if not isinstance(record['path'], str) or not isinstance(record['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', record['sha256']) or type(record['size_bytes']) is not int or not 0 <= record['size_bytes'] <= 1_048_576:
            raise ArtifactError('Invalid client file hash, path or bounded size.')
        if source and (not record['path'].endswith('.py') or not isinstance(record['module'], str) or type(record['is_package']) is not bool):
            raise ArtifactError('Client sources require Python paths and explicit module identities.')
        if not source and (not record['path'].startswith('LICENSES/') or record['size_bytes'] == 0):
            raise ArtifactError('Notices must be nonempty files under LICENSES/.')
    check_names(record['path'] for record in sources + notices)
    if sum(record['size_bytes'] for record in sources + notices) > 8_388_608:
        raise ArtifactError('Client input exceeds 8 MiB.')
    urls = manifest['fetch_urls']
    if not isinstance(urls, list) or len(urls) > 32 or any(not isinstance(url, str) or len(url) > 8192 for url in urls) or len(set(urls)) != len(urls):
        raise ArtifactError('Fetch grants require at most 32 unique explicit URLs.')
    for url in urls:
        parsed = urlparse(url)
        try:
            port = parsed.port
            if (not url.isascii() or not re.fullmatch(r'https?://[a-z0-9.-]+(?::[1-9][0-9]{0,4})?/[^\s\\#<>"`{}|^]*', url)
                    or parsed.geturl() != url or port == (80 if parsed.scheme == 'http' else 443)
                    or chr(39) in url or any(part in {'.', '..'} for part in unquote(parsed.path).split('/'))
                    or (port is not None and not 1 <= port <= 65535)
                    or re.search(r'%(?![0-9A-Fa-f]{2})', url)):
                raise ValueError
            if re.fullmatch(r'(?:[0-9]+|0x[0-9a-f]+)', parsed.hostname.rsplit('.', 1)[-1]):
                if str(ipaddress.IPv4Address(parsed.hostname)) != parsed.hostname:
                    raise ValueError
        except ValueError as error:
            raise ArtifactError('Fetch grants require canonical ASCII HTTP(S) URLs with an explicit / path, hostname or IPv4 address, and no credentials/fragments/default port.') from error
    return manifest


def _snapshot(client):
    if not isinstance(client, ClientSources) or type(client.manifest_bytes) is not bytes or not isinstance(client.files, tuple):
        raise ArtifactError('Expected an immutable client-source snapshot.')
    manifest = _client_manifest(client.manifest_bytes)
    files = dict(client.files)
    records = manifest['sources'] + manifest['notices']
    if len(files) != len(client.files) or set(files) != {record['path'] for record in records}:
        raise ArtifactError('Client snapshot file set changed.')
    for record in records:
        content = files[record['path']]
        if type(content) is not bytes or file_record(record['path'], content) != {key: record[key] for key in ['path', 'sha256', 'size_bytes']}:
            raise ArtifactError('Client snapshot hash/size changed.')
        if record['role'] == 'notice' and not content.strip():
            raise ArtifactError('Client notice is empty.')
    return manifest, files


def read_client(manifest_path: str | Path) -> ClientSources:
    path = Path(manifest_path).absolute()
    data = read_asset(path.parent, path.name, max_bytes=1_048_576)
    manifest = _client_manifest(data)
    files = tuple((record['path'], read_asset(path.parent, record['path'], max_bytes=record['size_bytes'])) for record in manifest['sources'] + manifest['notices'])
    client = ClientSources(path.parent, data, files)
    _snapshot(client)
    return client


def _compiler():
    spec = util.find_spec('JavaScript')
    if spec is None or not spec.submodule_search_locations:
        raise ArtifactError('The compiled profile requires the pinned compiled-build tooling; no compiler is installed automatically.')
    root = Path(next(iter(spec.submodule_search_locations)))
    digest = hashlib.sha256()
    try:
        for name in COMPILER_FILES:
            for data in [name.encode(), read_asset(root, name, max_bytes=1_048_576).replace(b'\r\n', b'\n')]:
                digest.update(len(data).to_bytes(8, 'big'))
                digest.update(data)
        if digest.hexdigest() != COMPILER_FINGERPRINT or metadata.version('Python-JavaScript') != COMPILER_VERSION:
            raise ArtifactError('Compiler source differs from the supported pinned build.')
        from JavaScript.browser import compile_browser
        from JavaScript.emitter import OutputFile
        from JavaScript.modules import SourceModule
    except (ImportError, OSError, metadata.PackageNotFoundError) as error:
        raise ArtifactError('The supported compiled-build tooling is unavailable.') from error
    return compile_browser, OutputFile, SourceModule


def compile_client(client: ClientSources, *, source_map: bool | None = None):
    manifest, files = _snapshot(client)
    compile_browser, OutputFile, SourceModule = _compiler()
    if source_map is not None and type(source_map) is not bool:
        raise ArtifactError('Source-map policy must be boolean.')
    try:
        sources = tuple(SourceModule.from_text(record['module'], files[record['path']].decode('utf-8'), is_package=record['is_package'], filename=record['path']) for record in manifest['sources'])
        notices = tuple(OutputFile(record['path'], files[record['path']], 'notice') for record in manifest['notices'])
        artifact = compile_browser(sources, entrypoint=manifest['entrypoint'], source_map=manifest['source_map'] if source_map is None else source_map, notices=notices)
    except (ValueError, UnicodeError) as error:
        raise ArtifactError('Client compilation failed: ' + str(error)) from error
    if len(artifact.files) > 256 or sum(len(item.data) for item in artifact.files) > 33_554_432:
        raise ArtifactError('Compiled output exceeds the 256-file / 32-MiB limit.')
    required = set(artifact.manifest['browser']['capabilities'])
    available = {'output/1', 'dom-text/1', 'dom-events/1', 'handles/1'} | ({'fetch/1'} if manifest['fetch_urls'] else set())
    if not required <= available:
        raise ArtifactError('Compiled application requires unavailable host capabilities: ' + ', '.join(sorted(required - available)))
    return artifact


def read_compiled(root: str | Path, client: ClientSources) -> CompilerOutput:
    expected = compile_client(client)
    root = Path(root).absolute()
    data = read_asset(root, 'COMPILED-MANIFEST.json', max_bytes=1_048_576)
    if data != expected.manifest_bytes:
        raise ArtifactError('Compiler manifest differs from deterministic recompilation.')
    files = tuple((item.path, read_asset(root, item.path, max_bytes=len(item.data))) for item in expected.files)
    if files != tuple((item.path, item.data) for item in expected.files):
        raise ArtifactError('Compiler output differs from deterministic recompilation.')
    return CompilerOutput(root, data, files)


def build_compiled(client: ClientSources, output: str | Path, *, compiled: CompilerOutput | None = None,
                   title: str = 'Pocket Python', omit_source_maps: bool = False) -> dict:
    manifest, _ = _snapshot(client)
    artifact = compile_client(client)
    if compiled is not None and (not isinstance(compiled, CompilerOutput) or compiled.manifest_bytes != artifact.manifest_bytes or compiled.files != tuple((item.path, item.data) for item in artifact.files)):
        raise ArtifactError('Compiler snapshot differs from deterministic recompilation.')
    requested = Path(output).absolute()
    if requested.exists() or requested.is_symlink():
        raise ArtifactError('Output already exists; choose a new directory.')
    destination = requested.resolve()
    for root in [client.root, *([compiled.root] if compiled else [])]:
        root = root.resolve()
        if destination.is_relative_to(root) or root.is_relative_to(destination):
            raise ArtifactError('Output overlaps an input root.')
    if not isinstance(title, str) or not title.strip() or len(title) > 256 or type(omit_source_maps) is not bool:
        raise ArtifactError('Title and source-map output policy are invalid.')
    if omit_source_maps and manifest['source_map']:
        artifact = compile_client(client, source_map=False)
    compiled_manifest = artifact.manifest
    namespace = 'application/' + hashlib.sha256(artifact.manifest_bytes).hexdigest()
    files = {namespace + '/' + item.path: item.data for item in artifact.files}
    roles = {namespace + '/' + item.path: item.role for item in artifact.files}
    files[namespace + '/COMPILED-MANIFEST.json'] = artifact.manifest_bytes
    capabilities = [{'id': 'output/1'}, {'id': 'dom-text/1', 'controls': ['input', 'result', 'status']},
                    {'id': 'dom-events/1', 'controls': ['run'], 'events': ['click']}, {'id': 'handles/1'}]
    if manifest['fetch_urls']:
        capabilities.append({'id': 'fetch/1', 'urls': manifest['fetch_urls']})
    config_data = json_bytes({'application': {'manifest_sha256': hashlib.sha256(artifact.manifest_bytes).hexdigest(), 'profile': 'compiled-javascript', 'profile_version': 1, 'entrypoint': 'app.mjs', 'engine': None}, 'capabilities': capabilities})
    config_name = 'app-config-' + hashlib.sha256(config_data).hexdigest() + '.json'
    launcher_data = APP.replace('__APPLICATION__', namespace).replace('__CONFIG__', config_name).encode()
    launcher_name = 'app-' + hashlib.sha256(launcher_data).hexdigest() + '.js'
    files.update({'index.html': PAGE.replace('__LAUNCHER__', launcher_name).replace('__TITLE__', html.escape(title, quote=True)).encode(),
                  launcher_name: launcher_data, config_name: config_data, 'icon.svg': ICON.encode(),
                  'manifest.webmanifest': json_bytes({'name': title, 'short_name': title[:24], 'id': './', 'start_url': './', 'scope': './', 'display': 'standalone', 'theme_color': '#225841', 'background_color': '#f4f7f1', 'icons': [{'src': './icon.svg', 'sizes': 'any', 'type': 'image/svg+xml'}]})})
    records = [file_record(name, data) for name, data in sorted(files.items())]
    cache_version = hashlib.sha256(json_bytes({'profile': 'compiled-javascript/1', 'pocket_python_version': __version__, 'compiler_revision': COMPILER_REVISION, 'compiler_fingerprint': COMPILER_FINGERPRINT, 'service_worker_template': hashlib.sha256(SERVICE_WORKER.encode()).hexdigest(), 'files': records})).hexdigest()
    files['service-worker.js'] = SERVICE_WORKER.replace('__FILES__', json.dumps([*sorted(files), 'service-worker.js', 'POCKET-PYTHON.json'])).replace('__VERSION__', cache_version).encode()
    for name in files:
        roles.setdefault(name, 'executable-module' if name in {launcher_name, 'service-worker.js'} else 'data')
    receipt = {'kind': 'pocket-python-application', 'schema_version': 2, 'profile': 'compiled-javascript', 'profile_version': 1, 'target': 'client',
               'pocket_python_version': __version__, 'title': title, 'entrypoint': {'path': namespace + '/app.mjs', 'kind': 'es-module'}, 'ui_entrypoint': 'index.html', 'launcher': launcher_name, 'configuration': config_name, 'ui_profile': 'text-input/1', 'engine': None,
               'producer': {**compiled_manifest['compiler'], 'source_revision': COMPILER_REVISION, 'source_fingerprint': COMPILER_FINGERPRINT, 'language_profile': compiled_manifest['language_profile']},
               'compiler_manifest': namespace + '/COMPILED-MANIFEST.json', 'source_map': not omit_source_maps and manifest['source_map'], 'sources': compiled_manifest['sources'],
               'capabilities': capabilities, 'imports': [{'from': launcher_name, 'to': namespace + '/browser-host.mjs'}] + [{'from': namespace + '/' + edge['from'], 'to': namespace + '/' + edge['to']} for edge in compiled_manifest['imports']],
               'licenses': [namespace + '/' + name for name in compiled_manifest['notices']], 'cache_version': cache_version,
               'files': [{**file_record(name, data), 'role': roles[name]} for name, data in sorted(files.items())],
               'size': {'source_bytes': sum(record['size'] for record in compiled_manifest['sources']), 'emitted_module_bytes': sum(len(item.data) for item in artifact.files if item.role == 'executable-module'),
                        'helper_bytes': sum(len(item.data) for item in artifact.files if item.role == 'compatibility-helper'), 'source_map_bytes': sum(len(item.data) for item in artifact.files if item.role == 'source-map'),
                        'notice_bytes': sum(len(item.data) for item in artifact.files if item.role == 'notice'), 'engine_bytes': 0,
                        'data_bytes': sum(len(data) for name, data in files.items() if roles[name] == 'data'),
                        'assembly_module_bytes': len(files[launcher_name]) + len(files['service-worker.js']), 'receipt_bytes': 0, 'artifact_bytes': 0}}
    payload_size = sum(map(len, files.values()))
    while True:
        data = json_bytes(receipt)
        total = payload_size + len(data)
        if total == receipt['size']['artifact_bytes'] and len(data) == receipt['size']['receipt_bytes']:
            break
        receipt['size']['artifact_bytes'] = total
        receipt['size']['receipt_bytes'] = len(data)
    files['POCKET-PYTHON.json'] = data
    _publish(destination, files)
    return receipt
