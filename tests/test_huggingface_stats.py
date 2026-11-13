from datetime import datetime, timezone
import unittest

from scripts.update_huggingface_stats import API_URL, DATASET, SHIELDS_URL, collect_stats

FETCHED_AT = datetime(2026, 10, 16, tzinfo=timezone.utc)


class HuggingFaceStatsTests(unittest.TestCase):
    def test_uses_cumulative_downloads_not_monthly_downloads(self):
        result = collect_stats(lambda _: ({
            "id": DATASET, "downloads": 269774, "downloadsAllTime": 923691,
        }, FETCHED_AT))
        self.assertEqual(result["downloadsAllTime"], 923691)
        self.assertEqual(result["via"], "huggingface.co")

    def test_falls_back_to_the_same_public_field_if_direct_hf_access_fails(self):
        requests = []

        def fetch(url):
            requests.append(url)
            if url == API_URL:
                raise OSError("Connection timed out")
            return {"message": "923691"}, FETCHED_AT

        result = collect_stats(fetch)
        self.assertEqual(requests, [API_URL, SHIELDS_URL])
        self.assertEqual(result["downloadsAllTime"], 923691)
        self.assertEqual(result["via"], "shields.io")
        self.assertEqual(result["updatedAt"], FETCHED_AT.isoformat(timespec="seconds"))

    def test_missing_total_never_uses_monthly_count_or_badge_error_text(self):
        for message in ["inaccessible", "invalid", "923.7K", "", "-1", None]:
            with self.subTest(message=message):
                def fetch(url):
                    if url == API_URL:
                        return {"id": DATASET, "downloads": 269774}, FETCHED_AT
                    return {"message": message}, FETCHED_AT
                with self.assertRaises(ValueError):
                    collect_stats(fetch)

    def test_wrong_dataset_or_invalid_total_is_not_accepted(self):
        for payload in [
            {"id": "another/dataset", "downloadsAllTime": 923691},
            {"id": DATASET, "downloadsAllTime": True},
            {"id": DATASET, "downloadsAllTime": -1},
            {"id": DATASET, "downloadsAllTime": "923691"},
        ]:
            def fetch(url):
                if url == API_URL:
                    return payload, FETCHED_AT
                raise OSError("Fallback also unavailable")
            with self.assertRaises(OSError):
                collect_stats(fetch)


if __name__ == "__main__":
    unittest.main()
