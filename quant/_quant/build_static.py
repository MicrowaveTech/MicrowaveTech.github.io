"""Build public dashboard files from validated GitHub upload batches."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re
import shutil

try:
    from .parser import parse_texts, now_iso, records
    from .demo import demo_days
except ImportError:
    from parser import parse_texts, now_iso, records
    from demo import demo_days


def load_groups(inbox, source_id):
    groups = {('sim_trade', ''): {'events': {}, 'sources': [], 'latest': None}}
    for path in sorted(Path(inbox).glob('**/*.json')):
        if path.is_symlink() or path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('Invalid upload file: ' + path.name)
        payload = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(payload, dict) or payload.get('schema_version') != 1 or payload.get('mode') not in ('sim_trade', 'backtest') or payload.get('source_id') != source_id:
            raise ValueError('Upload source or mode mismatch: ' + path.name)
        mode = payload['mode']
        run_id = payload.get('run_id', '') if mode == 'backtest' else ''
        if mode == 'backtest' and (not isinstance(run_id, str) or not re.fullmatch(r'[a-f0-9]{32}', run_id)):
            raise ValueError('Backtest requires a valid run id: ' + path.name)
        group = groups.setdefault((mode, run_id), {'events': {}, 'sources': [], 'latest': None})
        events, sources, latest = group['events'], group['sources'], group['latest']
        if payload.get('batch_id') != path.stem or not re.fullmatch(r'[a-f0-9]{32}', path.stem):
            raise ValueError('Invalid batch id: ' + path.name)
        rows = payload.get('events')
        if not isinstance(rows, list) or not 1 <= len(rows) <= 500:
            raise ValueError('Invalid event count: ' + path.name)
        for event in rows:
            if not isinstance(event, dict):
                raise ValueError('Invalid event: ' + path.name)
            eid, text = event.get('id'), event.get('text')
            if not isinstance(eid, str) or not re.fullmatch(r'[a-f0-9]{32}', eid):
                raise ValueError('Invalid event id: ' + path.name)
            if not isinstance(text, str) or len(text.encode('utf-8')) > 512 * 1024:
                raise ValueError('Invalid event text: ' + path.name)
            parsed_records = records(text)
            if not parsed_records or not text.startswith(parsed_records[0]['date']):
                raise ValueError('Unrecognized event log: ' + path.name)
            if eid in events and events[eid] != text:
                raise ValueError('Conflicting upload event: ' + path.name)
            events[eid] = text
        uploaded = payload.get('uploaded_at')
        if uploaded:
            parsed = dt.datetime.fromisoformat(uploaded)
            if parsed.tzinfo is None:
                raise ValueError('Upload time requires timezone')
            latest = max(latest, parsed) if latest else parsed
            group['latest'] = latest
        sources.append({'name': path.name, 'bytes': path.stat().st_size})
    result = {}
    for (mode, run_id), group in groups.items():
        texts = sorted(group['events'].values(), key=lambda value: value[:19])
        days = parse_texts(['\n'.join(texts)])
        for day in days.values():
            day.update(run_mode=mode, run_id=run_id)
        result[(mode, run_id)] = (days, group['sources'], group['latest'].isoformat() if group['latest'] else None, len(group['events']))
    return result


def load_batches(inbox, source_id):
    return load_groups(inbox, source_id)[('sim_trade', '')]


def write_dataset(destination, days, sources, mode, sync=None, backtests=None):
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'days').mkdir(exist_ok=True)
    index = {'schema_version': 1, 'mode': mode, 'updated_at': now_iso(), 'refresh_seconds': 3600,
             'sources': sources, 'sync': sync, 'dates': []}
    if backtests is not None:
        index['backtests'] = backtests
    for date, day in sorted(days.items(), reverse=True):
        index['dates'].append({'date': date, 'morning': bool(day['morning']), 'close': bool(day['close']),
                               'trades': len(day['trades']), 'warnings': len(day['warnings'])})
        (destination / 'days' / (date + '.json')).write_text(json.dumps(day, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    (destination / 'index.json').write_text(json.dumps(index, ensure_ascii=False, allow_nan=False), encoding='utf-8')


def build(site, inbox, output, source_id='four-strategies'):
    output = Path(output)
    if output.resolve() == Path(site).resolve():
        raise ValueError('Build output must differ from source')
    groups = load_groups(inbox, source_id)
    days, sources, latest, count = groups[('sim_trade', '')]
    backtests = []
    for (mode, run_id), (run_days, _, received, _) in groups.items():
        if mode == 'backtest':
            backtests.append({'run_id': run_id, 'updated_at': received, 'days': len(run_days), 'first_date': min(run_days, default=None), 'last_date': max(run_days, default=None)})
    backtests.sort(key=lambda run: (run['updated_at'] or '', run['run_id']), reverse=True)
    output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(site, output, dirs_exist_ok=True)
    if (output / 'data').exists():
        shutil.rmtree(output / 'data')
    (output / 'config.js').write_text("'use strict';\nwindow.DASHBOARD_CONFIG = {mode: 'static'};\n", encoding='utf-8')
    write_dataset(output / 'data', days, sources, 'github',
                  {'source_id': source_id, 'last_received_at': latest, 'events': count}, backtests=backtests)
    for (mode, run_id), (run_days, run_sources, received, run_count) in groups.items():
        if mode == 'backtest':
            write_dataset(output / 'data/backtests' / run_id, run_days, run_sources, 'backtest',
                          {'source_id': source_id, 'last_received_at': received, 'events': run_count, 'run_id': run_id})
    write_dataset(output / 'data' / 'demo', demo_days(), [], 'demo')
    return len(days)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--site', type=Path, default=Path(__file__).parent / 'site')
    cli.add_argument('--inbox', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    print('Published record days:', build(args.site, args.inbox, args.output))
