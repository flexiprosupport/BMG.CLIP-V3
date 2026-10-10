# BMG.CLIP-V3

<p align="center"><img src="docs/logo.png" alt="BMG.CLIP-V3" width="320"></p>

A local AI video clipping app with a React dashboard, Whisper transcription, styled captions, manual reframing, and FFmpeg rendering.

**Contact:** [Telegram @bmg009](https://t.me/bmg009)

![App preview](docs/preview.png)

## Features

- Import a video URL or upload a local video.
- Transcribe locally with faster-whisper.
- Select highlights and create captioned short clips.
- Customize caption styles, framing, effects, and background music.
- Review and download finished clips.
- Yellow BMG.CLIP-V3 branding, browser icon, and Windows icon.

## Run on Windows

For guided desktop setup on Windows 10/11, extract the full ZIP to a permanent
folder (for example, a folder on your Desktop), then double-click `Setup.cmd`.
Confirm the setup prompts. It creates a local `.venv`, installs the required
Python packages, and creates **BMG.CLIP-V3 Preview** and **Stop BMG.CLIP-V3 Preview**
desktop shortcuts without replacing existing shortcuts. Missing 64-bit Python
3.11 or FFmpeg can be installed through WinGet, with your confirmation; WinGet
requires Microsoft's App Installer. The guided setup accepts 64-bit Python
3.11–3.13. Internet access is needed during setup and for first-use models/fonts.
Keep the extracted folder in place because the shortcuts point to it.

The setup launcher has not been verified on a Windows machine here. If it fails,
it keeps the console open and saves a `setup-*.log` in the app folder.

For manual setup:

Install Python 3.11 or newer and FFmpeg (including ffprobe). Both must be available on PATH. From this repository folder:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. After setup you can also double-click `BMG.CLIP-V3.vbs` to start the server and open the browser; `Stop BMG.CLIP-V3.vbs` stops it.

Model weights and fonts download on first use. Transcription and rendering then run locally; fetching video URLs still requires the internet. CPU processing is supported. GPU use depends on compatible CUDA/cuDNN dependencies.

## Run on macOS or Linux

With Python and FFmpeg installed:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Edit the dashboard

The repository includes a built dashboard in `web/dist`, so Node.js is only needed to change/rebuild the frontend.

```bash
cd web
npm ci
npm run build
```

For frontend development, run the backend and `npm run dev` in separate terminals. The Vite configuration proxies API requests to port 8000.

## Repository contents

- `app/`: Python backend and video pipeline.
- `web/src/`: React dashboard source.
- `web/public/assets/`: approved logo and icons.
- `web/dist/`: production dashboard.
- `static/`: legacy fallback dashboard.
- `docs/`: logo and app screenshot.

Personal videos, generated clips, transcripts, music uploads, downloaded fonts/models, and bundled Python/FFmpeg runtimes are excluded. They are created or supplied locally.

## Project provenance

This is a rebranded and customized copy of an existing local video-clipping application. No upstream license file was present in the installed application. No new license or claim of authorship over upstream code has been added here; upstream licensing remains unspecified in this package. Third-party dependencies retain their own licenses.

## Validation

The installed app's branded dashboard and asset URLs were checked locally. This source export requires a separate fresh-environment setup before treating installation on another computer as verified.
