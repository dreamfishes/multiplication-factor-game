#!/usr/bin/env python3
"""Generate MiniMax pronunciation audio for the English quiz game."""

from __future__ import annotations

import argparse
import binascii
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


API_URL = "https://api.minimaxi.com/v1/t2a_v2"
DEFAULT_MODEL = "speech-2.8-hd"
DEFAULT_VOICE_ID = "English_Graceful_Lady"


def strip_env_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def load_local_env(script_dir: Path) -> list[Path]:
    english_dir = script_dir.parent
    repo_dir = english_dir.parent
    loaded: list[Path] = []

    for env_path in (english_dir / ".env.local", repo_dir / ".env.local"):
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export ") :].strip()
            key, separator, value = line.partition("=")
            key = key.strip()
            if separator and key and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                os.environ.setdefault(key, strip_env_quotes(value.strip()))
        loaded.append(env_path)

    return loaded


def audio_slug(text: str) -> str:
    text = text.lower().replace("'", "").replace("’", "")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def extract_speech_texts(html: str) -> list[str]:
    texts: set[str] = set()
    texts.update(re.findall(r"\{en:'([^']+)'", html))
    texts.update(re.findall(r"\{word:'([^']+)'", html))
    texts.update(re.findall(r'\{en:"([^"]+)"', html))
    texts.add("cake")
    return sorted(texts, key=lambda value: (audio_slug(value), value))


def request_json(api_key: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"MiniMax HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"MiniMax request failed: {error}") from error


def save_audio(response: dict[str, Any], output_path: Path, timeout: int) -> None:
    audio = (response.get("data") or {}).get("audio")
    if not isinstance(audio, str) or not audio:
        raise RuntimeError(f"No audio in MiniMax response: {json.dumps(response, ensure_ascii=False)[:500]}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if audio.startswith(("http://", "https://")):
        request = urllib.request.Request(audio, headers={"User-Agent": "english-quiz-audio-generator/1.0"})
        with urllib.request.urlopen(request, timeout=timeout) as response_file:
            output_path.write_bytes(response_file.read())
        return

    try:
        output_path.write_bytes(binascii.unhexlify(audio))
    except binascii.Error as error:
        raise RuntimeError("MiniMax audio was neither a URL nor valid hex data.") from error


def build_payload(text: str, model: str, voice_id: str, speed: float) -> dict[str, Any]:
    return {
        "model": model,
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": speed,
            "vol": 1.0,
            "pitch": 0,
            "emotion": "happy",
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
        "language_boost": "English",
        "subtitle_enable": False,
        "output_format": "url",
        "aigc_watermark": False,
    }


def update_audio_manifest(html_path: Path, output_dir: Path) -> None:
    html = html_path.read_text(encoding="utf-8")
    slugs = sorted(path.stem for path in output_dir.glob("*.mp3"))
    values = ",\n  ".join(json.dumps(slug) for slug in slugs)
    replacement = f"const PREGENERATED_AUDIO = new Set([\n  {values}\n]);"
    new_html, count = re.subn(
        r"const PREGENERATED_AUDIO = new Set\(\[[\s\S]*?\]\);",
        replacement,
        html,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Could not find PREGENERATED_AUDIO manifest in HTML.")
    html_path.write_text(new_html, encoding="utf-8")
    print(f"Updated HTML audio manifest with {len(slugs)} files.")


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    english_dir = script_dir.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, default=english_dir / "英语闯关小游戏.html")
    parser.add_argument("--output-dir", type=Path, default=english_dir / "assets/audio/en")
    parser.add_argument("--api-key-env", default="MINIMAX_API_KEY")
    parser.add_argument("--model", default=os.environ.get("MINIMAX_SPEECH_MODEL", DEFAULT_MODEL))
    parser.add_argument("--voice-id", default=os.environ.get("MINIMAX_ENGLISH_VOICE_ID", DEFAULT_VOICE_ID))
    parser.add_argument("--speed", type=float, default=float(os.environ.get("MINIMAX_ENGLISH_SPEED", "0.86")))
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--limit", type=int, default=0, help="Generate only the first N entries. 0 means all.")
    parser.add_argument("--force", action="store_true", help="Regenerate existing files.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned files without calling MiniMax.")
    parser.add_argument("--sleep", type=float, default=3.2, help="Pause between requests.")
    parser.add_argument("--retries", type=int, default=5, help="Retry MiniMax rate limits this many times.")
    parser.add_argument("--rate-limit-sleep", type=float, default=45.0, help="Pause before retrying after a rate limit.")
    parser.add_argument("--no-update-html", action="store_true", help="Do not update PREGENERATED_AUDIO in HTML.")
    return parser.parse_args()


def main() -> int:
    loaded_env_files = load_local_env(Path(__file__).resolve().parent)
    args = parse_args()
    html = args.html.read_text(encoding="utf-8")
    texts = extract_speech_texts(html)
    if args.limit > 0:
        texts = texts[: args.limit]

    print(f"Found {len(texts)} pronunciation texts.")
    for text in texts:
        print(f"{audio_slug(text)}.mp3\t{text}")

    if args.dry_run:
        return 0

    api_key = os.environ.get(args.api_key_env)
    if not api_key:
        checked = ", ".join(str(path) for path in loaded_env_files) or "no .env.local file found"
        print(
            f"Missing API key. Set {args.api_key_env} in your shell or in 英语/.env.local. Checked: {checked}",
            file=sys.stderr,
        )
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for index, text in enumerate(texts, start=1):
        output_path = args.output_dir / f"{audio_slug(text)}.mp3"
        if output_path.exists() and not args.force:
            print(f"[{index}/{len(texts)}] skip {output_path.name}")
            continue

        print(f"[{index}/{len(texts)}] generate {output_path.name}: {text}", flush=True)
        payload = build_payload(text, args.model, args.voice_id, args.speed)
        for attempt in range(args.retries + 1):
            response = request_json(api_key, payload, args.timeout)
            base_resp = response.get("base_resp") or {}
            if base_resp.get("status_code") == 0:
                save_audio(response, output_path, args.timeout)
                break
            if base_resp.get("status_code") == 1002 and attempt < args.retries:
                wait_seconds = args.rate_limit_sleep * (attempt + 1)
                print(f"  rate limited; waiting {wait_seconds:.0f}s before retry", flush=True)
                time.sleep(wait_seconds)
                continue
            raise RuntimeError(f"MiniMax returned error for {text}: {json.dumps(base_resp, ensure_ascii=False)}")
        time.sleep(args.sleep)

    if not args.no_update_html:
        update_audio_manifest(args.html, args.output_dir)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
