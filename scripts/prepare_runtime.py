"""Fetch only the pinned, hashed upstream acceptance-test fixture."""

import hashlib
import io
from pathlib import Path
import sys
import tarfile
from urllib.request import urlopen

from pocket_python.assets import json_bytes, runtime_lock

VERSION = "1.29.0-6"
TARBALL_URL = "https://registry.npmjs.org/@micropython/micropython-webassembly-pyscript/-/micropython-webassembly-pyscript-1.29.0-6.tgz"
TARBALL_SHA256 = "416fd43c3ff9c60c871e520cda90e725ad866339b5f59668ef79388330454444"
LICENSE_URL = "https://raw.githubusercontent.com/micropython/micropython/v1.29.0/LICENSE"
LICENSE_SHA256 = "80d3459978572b5bbb1dd274a98b01a625aeff467588ad69cefdf7eb607c1306"
ASSETS = {
    "micropython.mjs": "26cc7a99064a16518ab9a695e848efb248bfce504aee56ae73b2af35f3dcbf8b",
    "micropython.wasm": "d5913c9327072e71d3e7a2e9384ea326f7d784bcc2f50a01b602c52bd2bdcafd",
}


def download(url: str, digest: str) -> bytes:
    with urlopen(url, timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError("Pinned fixture digest mismatch: " + url)
    return data


def prepare(destination: Path) -> Path:
    # Do not extract archive paths to disk. Read only these two exact members.
    archive = download(TARBALL_URL, TARBALL_SHA256)
    content = {"LICENSE": download(LICENSE_URL, LICENSE_SHA256)}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
        for name, digest in ASSETS.items():
            member = package.getmember("package/" + name)
            if not member.isfile():
                raise ValueError("Expected an ordinary runtime file.")
            data = package.extractfile(member).read()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError("Runtime asset digest mismatch: " + name)
            content[name] = data
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in content.items():
        path = destination / name
        if path.exists() or path.is_symlink():
            if path.is_symlink() or path.read_bytes() != data:
                raise ValueError("Refusing to replace a different fixture asset: " + name)
        else:
            with path.open("xb") as stream:
                stream.write(data)
    lock = runtime_lock(destination, version=VERSION, source_url=TARBALL_URL, files=list(ASSETS), license_files=["LICENSE"])
    lock_path = destination / "runtime-lock.json"
    encoded = json_bytes(lock)
    if lock_path.exists() or lock_path.is_symlink():
        if lock_path.is_symlink() or lock_path.read_bytes() != encoded:
            raise ValueError("Refusing to replace a different fixture lock.")
    else:
        with lock_path.open("xb") as stream:
            stream.write(encoded)
    return lock_path


if __name__ == "__main__":
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else "build/runtime").absolute()
    print(prepare(directory))
