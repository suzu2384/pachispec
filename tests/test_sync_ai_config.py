"""Public Firebase AI config supports optional Gemini 2.5 models."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "sync-ai-config.py"
spec = importlib.util.spec_from_file_location("sync_ai_config", MODULE_PATH)
sync_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync_module)


class ModelVariablesTest(unittest.TestCase):
    def test_2_5_models_are_accepted_without_changing_default(self):
        for model in ("gemini-2.5-flash-lite", "gemini-2.5-flash"):
            with self.subTest(model=model), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "index.html").write_text(
                    '<script src="ai-config.js?v=1.0.1"></script>', encoding="utf-8"
                )
                env = {
                    "PACHISPEC_AI_FIREBASE_CONFIG": json.dumps({
                        "apiKey": "test_web_key",
                        "appId": "1:123:web:456",
                        "projectId": "test-project",
                    }),
                    "PACHISPEC_AI_APP_CHECK_SITE_KEY": "test_public_site_key",
                    "PACHISPEC_AI_SPARK_VERIFIED": "true",
                    "PACHISPEC_AI_MODEL": model,
                }
                fingerprint = sync_module.sync(root, env)
                result = (root / "ai-config.js").read_text(encoding="utf-8")
                self.assertIn('"model":"' + model + '"', result)
                self.assertIn("id=" + fingerprint, (root / "index.html").read_text(encoding="utf-8"))

    def test_default_remains_3_5(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "index.html").write_text(
                '<script src="ai-config.js?v=1.0.1"></script>', encoding="utf-8"
            )
            sync_module.sync(root, {})
            self.assertIn(
                '"model":"gemini-3.5-flash-lite"',
                (root / "ai-config.js").read_text(encoding="utf-8")
            )


if __name__ == "__main__":
    unittest.main()
