"""Prepare Chromium, installing system dependencies when a launch needs them."""

import subprocess
import sys

from playwright.sync_api import Error, sync_playwright


def probe():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        browser.close()


def main():
    subprocess.run([sys.executable, '-m', 'playwright', 'install', 'chromium'], check=True)
    try:
        probe()
    except Error:
        print('Browser launch failed; installing system dependencies before retrying.', flush=True)
        subprocess.run([sys.executable, '-m', 'playwright', 'install-deps', 'chromium'], check=True)
        probe()
    print('Chromium launch verified.', flush=True)


if __name__ == '__main__':
    main()
