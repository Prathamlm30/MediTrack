"""Contract guardrails; real inference is tested by verify-real.mjs (no mocks)."""
import re
from pathlib import Path
import sys
import unittest
from typing import get_args

SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))
from extraction import MedicineForm


class ReferenceTests(unittest.TestCase):
    def test_benchmark_code_is_unchanged(self):
        reference = SERVICE.parent / 'docs' / 'ocr-reference'
        for source, target in [('preprocess.py', 'preprocessing.py'),
                               ('paddle_engine.py', 'paddle_engine.py'),
                               ('extractor.py', 'extractor.py')]:
            # Normalize checkout line endings, never tokens or algorithm behavior.
            self.assertEqual((reference / source).read_text(encoding='utf8'),
                             (SERVICE / target).read_text(encoding='utf8'))

    def test_forms_match_authoritative_schema(self):
        schema = (SERVICE.parent / 'docs' / 'schema.prisma').read_text(encoding='utf8')
        forms = re.search(r'enum MedicineForm\s*{([^}]+)}', schema).group(1).split()
        self.assertEqual(set(forms), set(get_args(MedicineForm)))

    def test_required_pins_remain_in_place(self):
        requirements = (SERVICE / 'requirements.txt').read_text()
        for pin in ['paddleocr==3.7.0', 'paddlepaddle==3.3.1',
                    'opencv-contrib-python==4.10.0.84', 'opencv-python-headless==4.10.0.84']:
            self.assertIn(pin, requirements.splitlines())


if __name__ == '__main__':
    unittest.main()
