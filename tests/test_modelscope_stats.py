import unittest

from scripts.update_modelscope_stats import DATASET, PAGE_SIZE, collect_stats


def page(number=1, total=100, target_index=None):
    offset = (number - 1) * PAGE_SIZE
    rows = [
        {"id": f"owner/dataset-{offset + i}", "downloads": 10000 - offset - i}
        for i in range(min(PAGE_SIZE, total - offset))
    ]
    if target_index is not None:
        rows[target_index]["id"] = DATASET
    return {"success": True, "data": {
        "datasets": rows, "total_count": total,
        "page_number": number, "page_size": PAGE_SIZE,
    }}


class ModelScopeStatsTests(unittest.TestCase):
    def test_rank_and_downloads_come_from_same_global_ranking(self):
        stats = collect_stats(lambda _: page(target_index=5))
        self.assertEqual(stats["rank"], 6)
        self.assertEqual(stats["downloads"], 9995)
        self.assertEqual(stats["dataset"], DATASET)

    def test_pagination_keeps_global_position(self):
        stats = collect_stats(lambda n: page(n, total=54, target_index=3 if n == 2 else None))
        self.assertEqual(stats["rank"], 54)
        self.assertEqual(stats["downloads"], 9947)

    def test_same_name_under_another_owner_is_not_a_match(self):
        payload = page(total=1)
        payload["data"]["datasets"][0]["id"] = "someone-else/OpenAoE-2000h"
        with self.assertRaisesRegex(ValueError, "not found"):
            collect_stats(lambda _: payload)

    def test_invalid_rankings_are_rejected(self):
        for change in ("unsorted", "duplicate", "short-page", "wrong-page", "missing-count", "api-error"):
            with self.subTest(change=change):
                payload = page(target_index=5)
                data = payload["data"]
                if change == "unsorted":
                    data["datasets"][10]["downloads"] = 20000
                elif change == "duplicate":
                    data["datasets"][10]["id"] = data["datasets"][0]["id"]
                elif change == "short-page":
                    data["datasets"].pop()
                elif change == "wrong-page":
                    data["page_number"] = 2
                elif change == "missing-count":
                    del data["datasets"][5]["downloads"]
                else:
                    payload["success"] = False
                with self.assertRaises(ValueError):
                    collect_stats(lambda _: payload)

    def test_repeated_page_cannot_produce_a_false_rank(self):
        def fetch(number):
            payload = page(1, target_index=None)
            payload["data"]["page_number"] = number
            return payload
        with self.assertRaises(ValueError):
            collect_stats(fetch)

    def test_api_failure_is_not_replaced_with_a_hardcoded_number(self):
        def fetch(_):
            raise OSError("Network unavailable")
        with self.assertRaises(OSError):
            collect_stats(fetch)


if __name__ == "__main__":
    unittest.main()
