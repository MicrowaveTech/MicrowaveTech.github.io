"""Portable tests also shipped in the website's _quant/tests directory."""
import json
import shutil
from pathlib import Path
import sys
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[1]
MODULES = PROJECT / 'dashboard' if (PROJECT / 'dashboard').exists() else PROJECT
sys.path.insert(0, str(MODULES))
from build_static import build, load_batches


def batch(batch_id='a' * 32):
    return {'schema_version': 1, 'source_id': 'four-strategies', 'mode': 'sim_trade', 'batch_id': batch_id,
            'uploaded_at': '2026-09-09T02:00:00+00:00', 'events': [
                {'id': 'b' * 32, 'text': '2026-09-08 09:00:00 - INFO - 【多策略盘前日志】【红利增强策略】资金占比 24%\n2026-09-08 09:00:00 - INFO - 【多策略盘前日志】工商银行(601398.XSHG) | PE:6.9'},
                {'id': 'c' * 32, 'text': '2026-09-08 10:30:00 - INFO - 【看板成交】{"id":"fill-1","strategy":"hongli","side":"buy","code":"601398.XSHG","name":"工商银行","quantity":100,"price":6}'},
                {'id': 'd' * 32, 'text': '2026-09-08 15:01:00 - INFO - 【多策略收盘日志】总资产：100100'}]}


class StaticBuildTests(unittest.TestCase):
    def write_batch(self, inbox, data):
        inbox.mkdir(parents=True, exist_ok=True)
        (inbox / (data['batch_id'] + '.json')).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

    def test_empty_site_does_not_publish_historical_local_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build(MODULES / 'site', root / 'inbox', root / 'quant')
            index = json.loads((root / 'quant/data/index.json').read_text())
            self.assertEqual(index['dates'], [])
            self.assertEqual(index['mode'], 'github')
            self.assertEqual(index['sync']['events'], 0)
            self.assertTrue((root / 'quant/data/demo/index.json').exists())
            self.assertIn("mode: 'static'", (root / 'quant/config.js').read_text())
            html = (root / 'quant/index.html').read_text()
            self.assertIn('./app.js', html)
            self.assertNotIn('src="/app.js"', html)

    def test_duplicate_batches_publish_single_fill(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_batch(root / 'inbox', batch())
            self.write_batch(root / 'inbox', batch('e' * 32))
            build(MODULES / 'site', root / 'inbox', root / 'quant')
            day = json.loads((root / 'quant/data/days/2026-09-08.json').read_text())
            self.assertEqual(len(day['trades']), 1)
            self.assertEqual(day['trades'][0]['amount'], 600)
            self.assertEqual(day['account']['total_value'], 100100)
            self.assertEqual(len(day['morning']['strategies'][0]['candidates']), 1)

    def test_invalid_batch_fails_before_overwriting_previous_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_batch(root / 'inbox', batch())
            build(MODULES / 'site', root / 'inbox', root / 'quant')
            previous = (root / 'quant/data/index.json').read_bytes()
            invalid = batch('e' * 32)
            invalid['mode'] = 'backtest'
            self.write_batch(root / 'inbox', invalid)
            with self.assertRaises(ValueError):
                build(MODULES / 'site', root / 'inbox', root / 'quant')
            self.assertEqual(previous, (root / 'quant/data/index.json').read_bytes())

    def test_conflicting_event_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_batch(root, batch())
            conflicting = batch('e' * 32)
            conflicting['events'][0]['text'] += 'changed'
            self.write_batch(root, conflicting)
            with self.assertRaises(ValueError):
                load_batches(root, 'four-strategies')

    def test_rebuild_preserves_sources_and_uploads_inside_quant(self):
        with tempfile.TemporaryDirectory() as directory:
            quant = Path(directory) / 'quant'
            site = quant / '_quant/site'
            inbox = quant / '_quant/inbox/four-strategies/2026-09-08'
            shutil.copytree(MODULES / 'site', site)
            self.write_batch(inbox, batch())
            for _ in range(2):
                build(site, quant / '_quant/inbox', quant)
                self.assertTrue((site / 'index.html').exists())
                self.assertTrue((inbox / ('a' * 32 + '.json')).exists())
                self.assertFalse((quant / 'quant').exists())
                day = json.loads((quant / 'data/days/2026-09-08.json').read_text())
                self.assertEqual(len(day['trades']), 1)


if __name__ == '__main__':
    unittest.main()
