"""Refresh public ModelScope statistics before deploying GitHub Pages."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DATASET = "inclusionAI/OpenAoE-2000h"
API_URL = "https://www.modelscope.cn/openapi/v1/datasets"
RANKING_URL = "https://www.modelscope.cn/datasets?page=1&sort=downloads"
PAGE_SIZE = 50
MAX_PAGES = 20
OUTPUT = Path(__file__).resolve().parents[1] / "data/modelscope-openaoe.json"


def request_page(page_number):
    query = urlencode({
        "sort": "downloads", "page_size": PAGE_SIZE, "page_number": page_number,
    })
    request = Request(f"{API_URL}?{query}", headers={
        "Accept": "application/json",
        "User-Agent": "ys-feng.github.io ModelScope statistics",
    })
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                return json.load(response)
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def collect_stats(fetch_page=request_page):
    seen = set()
    previous_downloads = float("inf")
    for page_number in range(1, MAX_PAGES + 1):
        payload = fetch_page(page_number)
        if not isinstance(payload, dict) or payload.get("success") is not True:
            raise ValueError("ModelScope did not return a successful response")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise ValueError("Missing ModelScope dataset list")
        rows = data.get("datasets")
        total = data.get("total_count")
        offset = (page_number - 1) * PAGE_SIZE
        if (type(total) is not int or total <= offset
                or data.get("page_number") != page_number
                or data.get("page_size") != PAGE_SIZE
                or not isinstance(rows, list)
                or len(rows) != min(PAGE_SIZE, total - offset)):
            raise ValueError("Unexpected ModelScope pagination")

        match = None
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError("Invalid dataset record")
            dataset_id = row.get("id")
            downloads = row.get("downloads")
            if (not isinstance(dataset_id, str) or "/" not in dataset_id
                    or dataset_id in seen
                    or type(downloads) is not int or downloads < 0
                    or downloads > previous_downloads):
                raise ValueError("Dataset list is invalid, duplicated, or not sorted by downloads")
            seen.add(dataset_id)
            previous_downloads = downloads
            if dataset_id == DATASET:
                match = {"downloads": downloads, "rank": offset + index + 1}

        if match is not None:
            return {
                "schemaVersion": 1,
                "dataset": DATASET,
                **match,
                "totalDatasets": total,
                "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "source": RANKING_URL,
            }
        if offset + len(rows) >= total:
            break
    raise ValueError(f"{DATASET} not found in the first {len(seen)} ranked datasets")


def write_stats(stats, path=OUTPUT):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


if __name__ == "__main__":
    stats = collect_stats()
    write_stats(stats)
    print(f"{DATASET}: {stats['downloads']:,} downloads, rank #{stats['rank']}")
