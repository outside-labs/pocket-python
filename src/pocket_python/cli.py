"""Command-line interface for explicit runtime assets and source inspection."""

import argparse
import json
from pathlib import Path
import sys

from pocket_python import __version__
from pocket_python.assets import ArtifactError, json_bytes, read_runtime, runtime_lock
from pocket_python.bundles import read_bundle
from pocket_python.web import build_web


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pocket-python", description="Audit runtime assets and assemble offline Python applications.")
    parser.add_argument("--version", action="version", version=f"pocket-python {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)
    lock = commands.add_parser("lock-runtime", help="Hash an explicit MicroPython runtime asset allowlist.")
    lock.add_argument("root", type=Path)
    lock.add_argument("--runtime-version", required=True)
    lock.add_argument("--source-url", required=True)
    lock.add_argument("--file", action="append", required=True, default=[])
    lock.add_argument("--license-file", action="append", required=True, default=[])
    lock.add_argument("--output", type=Path, required=True)
    inspect = commands.add_parser("inspect", help="Validate and describe a Shimify source bundle.")
    inspect.add_argument("bundle", type=Path)
    web = commands.add_parser("web", help="Build a local-asset MicroPython PWA in a new directory.")
    web.add_argument("bundle", type=Path)
    web.add_argument("--runtime", type=Path, required=True)
    web.add_argument("--runtime-lock", type=Path, required=True)
    web.add_argument("--output", type=Path, required=True)
    web.add_argument("--title", default="Pocket Python")
    compiled = commands.add_parser("compiled-web", help="Build a verified compiler-produced PWA from an explicit client allowlist.")
    compiled.add_argument("client", type=Path, help="Client-source JSON manifest.")
    compiled.add_argument("--compiled", type=Path, help="Optional existing compiler output to verify against recompilation.")
    compiled.add_argument("--output", type=Path, required=True)
    compiled.add_argument("--title", default="Pocket Python")
    compiled.add_argument("--omit-source-maps", action="store_true")
    interpreter = commands.add_parser("interpreter-web", help="Build a source console using the explicitly supplied pinned independent engine.")
    interpreter.add_argument("client", type=Path, help="Console-source JSON manifest.")
    interpreter.add_argument("--engine", type=Path, required=True, help="Directory containing the known source-console engine assets.")
    interpreter.add_argument("--output", type=Path, required=True)
    interpreter.add_argument("--title", default="Pocket Python Console")
    interpreter.add_argument("--library-profile", choices=["core-only/1", "operator/1"], default="core-only/1")
    interpreter.add_argument("--host-profile", choices=["output-only/1"], default="output-only/1")
    interpreter.add_argument("--language-profile", choices=["core-source/1", "classes-source/1"], default="core-source/1")
    args = parser.parse_args(argv)
    try:
        if args.command == "lock-runtime":
            result = runtime_lock(args.root, version=args.runtime_version, source_url=args.source_url, files=args.file, license_files=args.license_file)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("xb") as stream:
                stream.write(json_bytes(result))
            print(f"Created {args.output.resolve()}")
        elif args.command == "interpreter-web":
            from pocket_python.interpreter import build_interpreter, read_console_source, read_interpreter
            receipt = build_interpreter(read_console_source(args.client), read_interpreter(args.engine, library_profile=args.library_profile), args.output,
                                        title=args.title, host_profile=args.host_profile, language_profile=args.language_profile)
            print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
        elif args.command == "compiled-web":
            from pocket_python.compiled import build_compiled, read_client, read_compiled
            client = read_client(args.client)
            compiled = read_compiled(args.compiled, client) if args.compiled else None
            receipt = build_compiled(client, args.output, compiled=compiled, title=args.title, omit_source_maps=args.omit_source_maps)
            print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
            print("Serve over HTTPS or localhost; offline use follows the first successful installation.")
        elif args.command == "web":
            manifest = build_web(read_bundle(args.bundle), read_runtime(args.runtime, args.runtime_lock), args.output, title=args.title)
            print(f"Created {args.output.resolve()} ({manifest['size']['artifact_bytes']} bytes)")
            print("Serve over HTTPS or localhost; test this application against MicroPython.")
        else:
            print(json.dumps(read_bundle(args.bundle).report(), indent=2, sort_keys=True))
    except ArtifactError as error:
        print(f"pocket-python: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        print(f"pocket-python: {error}", file=sys.stderr)
        return 2
    return 0
