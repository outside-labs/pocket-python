"""Command-line interface for explicit runtime assets and source inspection."""

import argparse
import json
from pathlib import Path
import sys

from pocket_python import __version__
from pocket_python.assets import ArtifactError, json_bytes, runtime_lock
from pocket_python.bundles import read_bundle


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
    args = parser.parse_args(argv)
    try:
        if args.command == "lock-runtime":
            result = runtime_lock(args.root, version=args.runtime_version, source_url=args.source_url, files=args.file, license_files=args.license_file)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("xb") as stream:
                stream.write(json_bytes(result))
            print(f"Created {args.output.resolve()}")
        else:
            print(json.dumps(read_bundle(args.bundle).report(), indent=2, sort_keys=True))
    except ArtifactError as error:
        print(f"pocket-python: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        print(f"pocket-python: {error}", file=sys.stderr)
        return 2
    return 0
