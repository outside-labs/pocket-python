"""Check one installed wheel's CLI without repeating distribution acceptance."""

from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
version = tomllib.loads((ROOT / 'pyproject.toml').read_text(encoding='utf-8'))['project']['version']
wheel, = (ROOT / 'dist').glob(f'pocket_python-{version}-*.whl')
with tempfile.TemporaryDirectory() as directory:
    result = subprocess.run(
        ['uv', 'run', '--isolated', '--no-project', '--python', sys.executable,
         '--with', str(wheel), 'python', '-I', '-m', 'pocket_python', '--version'],
        cwd=directory, check=True, capture_output=True, text=True,
    )
    assert result.stdout.strip() == f'pocket-python {version}', result.stdout
print(f'Installed wheel CLI started: {version}')
