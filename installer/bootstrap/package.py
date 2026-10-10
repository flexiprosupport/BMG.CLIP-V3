"""Create the embedded app payload. Python stdlib only; no account credentials."""
import argparse
import hashlib
import pathlib
import subprocess
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--root", type=pathlib.Path, default=HERE.parents[1])
parser.add_argument("--revision", default=None)
args = parser.parse_args()
root = args.root.resolve()

revision = args.revision
if revision is None:
    try:
        revision = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        revision = "local source"

files = []
for folder in ("app", "web/dist", "static", "caption_renderer", "assets/fonts"):
    directory = root / folder
    if not directory.is_dir():
        raise SystemExit(f"Missing app folder: {directory}")
    for source in sorted(directory.rglob("*")):
        if source.is_file() and not {"__pycache__", "node_modules"}.intersection(source.parts) and source.suffix != ".pyc":
            files.append((source, source.relative_to(root).as_posix()))
for name in (
    "requirements.txt", "Launch.ps1", "Setup.ps1", "Setup.cmd",
    "BMG.CLIP-V3.vbs", "Stop BMG.CLIP-V3.vbs", "BMG.CLIP-V3-yellow.ico", "README.md",
):
    source = root / name
    if not source.is_file():
        raise SystemExit(f"Missing app file: {source}")
    files.append((source, name))

output = HERE / "payload.zip"
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for source, name in files:
        archive.write(source, name)
    archive.writestr(
        "INSTALLER-INFO.txt",
        f"BMG.CLIP-V3\nSource revision: {revision}\n"
        "Native Windows x64 online setup executable; app files are embedded.\n"
        "Python and Node caption packages are installed during setup. Missing Python/FFmpeg/Node require confirmation.\n"
        "Unsigned build. A complete installation on a Windows PC has not been verified here.\n",
    )
digest = hashlib.sha256(output.read_bytes()).hexdigest()
(HERE / "payload.sha256").write_text(digest + "\n", encoding="ascii")
print(f"Packaged {len(files)} app files, source {revision}, SHA256 {digest}")
