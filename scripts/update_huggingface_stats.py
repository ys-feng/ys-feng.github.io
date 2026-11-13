"""Refresh Hugging Face's cumulative dataset download count for the badges."""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DATASET = "inclusionAI/OpenAoE-2000h"
API_URL = f"https://huggingface.co/api/datasets/{DATASET}?expand=downloadsAllTime"
SHIELDS_URL = "https://img.shields.io/badge/dynamic/json.json?" + urlencode({
    "url": API_URL, "query": "$.downloadsAllTime", "label": "HF total", "cacheSeconds": 300,
})
OUTPUT = Path(__file__).resolve().parents[1] / "data/huggingface-openaoe.json"


def request_json(url):
    request = Request(url, headers={
        "Accept": "application/json", "User-Agent": "ys-feng.github.io dataset statistics",
    })
    with urlopen(request, timeout=10) as response:
        # Do not reset the age of a cached Shields response when syncing it.
        age = max(0, int(response.headers.get("Age", "0")))
        fetched_at = datetime.now(timezone.utc) - timedelta(seconds=age)
        return json.load(response), fetched_at


def collect_stats(fetch=request_json):
    via = "huggingface.co"
    try:
        payload, fetched_at = fetch(API_URL)
        if not isinstance(payload, dict) or payload.get("id") != DATASET:
            raise ValueError("Unexpected Hugging Face dataset")
        total = payload.get("downloadsAllTime")
        if type(total) is not int or total < 0:
            raise ValueError("Missing or invalid Hugging Face all-time download count")
    except (OSError, ValueError):
        # Shields exposes the same public API field where direct HF access fails.
        payload, fetched_at = fetch(SHIELDS_URL)
        message = payload.get("message") if isinstance(payload, dict) else None
        if not isinstance(message, str) or not re.fullmatch(r"[0-9]+", message):
            raise ValueError("Hugging Face cumulative downloads are unavailable")
        total = int(message)
        via = "shields.io"

    return {
        "schemaVersion": 1,
        "dataset": DATASET,
        "downloadsAllTime": total,
        "updatedAt": fetched_at.isoformat(timespec="seconds"),
        "source": API_URL,
        "via": via,
    }


def write_stats(stats, path=OUTPUT):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


if __name__ == "__main__":
    stats = collect_stats()
    write_stats(stats)
    print(f"{DATASET}: {stats['downloadsAllTime']:,} all-time Hugging Face downloads ({stats['via']})")
