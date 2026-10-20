"""Exercise the same independent VM lifetime checks in Node and a browser worker."""

import argparse
import json
from pathlib import Path
import subprocess

from check_conformance import run_browser


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=['node', 'browser'], default='node')
    parser.add_argument('--channel')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.target == 'node':
        module = (Path(__file__).parent / 'memory_checks.mjs').resolve().as_uri()
        runner = 'import {runMemoryChecks} from ' + json.dumps(module) + '; console.log(JSON.stringify({host:process.version,result:runMemoryChecks()}));'
        response = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', runner], text=True, timeout=15))
        version, result = response['host'], response['result']
    else:
        version, responses = run_browser({'worker': 'memory-worker.mjs'}, [{'id': 'memory'}], args.channel)
        if len(responses) != 1 or not responses[0]['ok']:
            raise RuntimeError(str(responses))
        result = responses[0]['result']
    if result['suite'] != 'interpreter-memory/1' or len(result['checks']) != 11 or len(set(result['checks'])) != 11:
        raise RuntimeError('Incomplete lifetime report.')
    report = {'schema_version': 1, 'target': args.target, 'version': version, **result}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
