#!/usr/bin/env python3
"""Run this source bundle: python -I -S run.py [arguments]."""
import runpy
import sys
from pathlib import Path

root = Path(__file__).resolve().parent / "_sources"
sys.path.insert(0, str(root))
sys.argv[0] = str(root / 'app.py')
runpy.run_path(sys.argv[0], run_name="__main__")
