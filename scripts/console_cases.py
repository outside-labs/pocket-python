"""Resolve bulk console expectations from the independently validated corpus."""

from functools import lru_cache
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


@lru_cache
def reference_stdout(source):
    return subprocess.check_output([sys.executable, '-I', '-S', '-X', 'utf8', '-c', source],
                                   text=True, encoding='utf-8', timeout=5)


def program_expectations(programs, corpus_root=ROOT / 'tests/fixtures/interpreter'):
    recorded = {}
    for path in sorted(corpus_root.glob('*.json')):
        corpus = json.loads(path.read_bytes())
        for case in corpus.get('cases', []):
            if ('source' not in case or 'stdout' not in case or 'error_type' in case or
                    case.get('modules') or case.get('stage') not in corpus.get('implemented_stages', [])):
                continue
            source, stdout = case['source'], case['stdout']
            if source in recorded and recorded[source] != stdout:
                raise ValueError('Conflicting corpus expectations for identical source')
            recorded[source] = stdout
    return [recorded[source] if source in recorded else reference_stdout(source) for source in programs]
