"""Parse JoinQuant console logs without treating order intent as a fill."""
import datetime as dt
import hashlib
import json
import math
import re

TZ = dt.timezone(dt.timedelta(hours=8))
HEADER = re.compile(r'^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:[.,]\d+)?\s*-\s*(INFO|WARNING|WARN|ERROR|DEBUG)\s*-\s*(.*)$')
CODE = r'\d{6}\.(?:XSHG|XSHE|XBSE)'
SECURITY = re.compile(r'([^\s|:：()（）,，、]+)[(（](' + CODE + r')[)）]')
NUMBER = r'[+-]?[\d,]+(?:\.\d+)?'
STRATEGIES = {'hongli': '红利增强策略', 'tech': '科技股双均线金叉策略',
              'wufu': '五福ETF动量轮动策略', 'lion': '涨停小狮子策略', 'unknown': '未标注策略'}
KEYWORDS = {'hongli': ('红利', '月线MACD', '月度选股', '现金流', '股息率'),
            'tech': ('科技股', '均线交叉策略', '热门板块', '大盘健康度', '金叉', '5日线备选'),
            'wufu': ('ETF', '晨间流水线', '走弱期', '午盘流水线'),
            'lion': ('小狮子',)}


def now_iso():
    return dt.datetime.now(TZ).isoformat(timespec='seconds')


def number(text):
    try:
        result = float(str(text).replace(',', ''))
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def records(text):
    result = []
    current = None
    for line in text.lstrip('\ufeff').splitlines():
        match = HEADER.match(line.strip())
        if match:
            date, time, level, message = match.groups()
            try:
                dt.datetime.fromisoformat(date + 'T' + time)
            except ValueError:
                continue
            current = {'date': date, 'time': time, 'level': level, 'message': message.strip()}
            result.append(current)
        elif current is not None and line.strip():
            current['message'] += '\n' + line.strip()
    return result


def strategy_of(message, fallback='unknown'):
    # Combined report titles contain all names and must not select one strategy.
    exact = [key for key, name in STRATEGIES.items() if key != 'unknown' and name in message]
    if len(exact) > 1:
        return 'unknown'
    if exact:
        return exact[0]
    for key, words in KEYWORDS.items():
        if any(word in message for word in words):
            return key
    return fallback


def empty_day(date):
    return {'schema_version': 1, 'date': date, 'updated_at': now_iso(), 'demo': False,
            'account': dict.fromkeys(['total_value', 'cash', 'positions_value', 'day_pnl', 'day_return',
                                     'cumulative_pnl', 'cumulative_return', 'position_ratio', 'position_count']),
            'morning': None, 'close': None, 'trades': [], 'warnings': [], 'logs': []}


def group(phase, key):
    found = next((item for item in phase['strategies'] if item['key'] == key), None)
    if found is None:
        found = {'key': key, 'name': STRATEGIES[key], 'allocation': None,
                 'lines': [], 'candidates': [], 'positions': []}
        phase['strategies'].append(found)
    return found


def read_account(account, message):
    mappings = {'总资产': 'total_value', '可用现金': 'cash', '持仓市值': 'positions_value',
                '当日盈亏': 'day_pnl', '持仓数量': 'position_count', '总仓位': 'position_ratio'}
    for label, key in mappings.items():
        match = re.match(r'^' + label + r'[：:]\s*(' + NUMBER + r')', message)
        if match:
            account[key] = number(match[1])
            if key == 'position_ratio' and account[key] is not None:
                account[key] /= 100
            if key == 'day_pnl':
                rate = re.search(r'[(（]\s*(' + NUMBER + r')%', message)
                if rate:
                    account['day_return'] = number(rate[1]) / 100
    match = re.match(r'^累计收益率[：:]\s*(' + NUMBER + r')%', message)
    if match:
        account['cumulative_return'] = number(match[1]) / 100
    match = re.search(r'累计盈亏[：:]?\s*(' + NUMBER + r')元', message)
    if match:
        account['cumulative_pnl'] = number(match[1])


def read_position(message):
    security = SECURITY.search(message)
    if not security or '股数' not in message or '市值' not in message:
        return None
    result = {'name': security[1], 'code': security[2]}
    for label, key in [('股数', 'quantity'), ('成本', 'cost'), ('现价', 'price'), ('市值', 'value'),
                       ('仓位', 'weight'), ('盈亏', 'pnl')]:
        match = re.search(label + r'\s*(' + NUMBER + r')', message)
        result[key] = number(match[1]) if match else None
    if result['weight'] is not None:
        result['weight'] /= 100
    rate = re.search(r'盈亏[^|]*?[(（](' + NUMBER + r')%', message)
    result['return'] = number(rate[1]) / 100 if rate else None
    return result


def read_trade(record, key):
    message = record['message']
    structured = re.search(r'【看板成交】(\{.*\})', message)
    if structured:
        try:
            event = json.loads(structured[1])
            quantity, price = number(event.get('quantity')), number(event.get('price'))
            if event.get('side') not in ('buy', 'sell') or not re.fullmatch(CODE, str(event.get('code', ''))):
                return None
            if quantity is None or quantity <= 0 or price is None or price <= 0:
                return None
            key = event.get('strategy') if event.get('strategy') in STRATEGIES else 'unknown'
            return {'id': str(event.get('id') or hashlib.sha256(message.encode()).hexdigest()[:20]),
                    'time': record['time'], 'strategy': key, 'strategy_name': STRATEGIES[key],
                    'side': event['side'], 'code': event['code'], 'name': str(event.get('name', event['code'])),
                    'quantity': quantity, 'price': price, 'amount': round(quantity * price, 4),
                    'status': 'filled', 'reason': str(event.get('reason', '')), 'raw': message}
        except (ValueError, TypeError, AttributeError):
            return None
    # A single legacy log block can include multi-line explicit fill details.
    security = SECURITY.search(message)
    code_match = re.search(CODE, message)
    if not code_match:
        return None
    code = code_match[0]
    side = 'buy' if '买入' in message else 'sell' if '卖出' in message else 'unknown'
    status = None
    if '下单失败' in message or '委托】未提交' in message or '委托未成交' in message:
        status = 'failed'
    elif ('买入成交' in message or '卖出成交' in message) and '本次成交' in message:
        status = 'filled'
    elif any(word in message for word in ('【买入委托】', '【卖出委托】', '委托已提交')):
        status = 'submitted'
    elif '【委托跟踪】' in message or '【委托待核对】' in message:
        status = 'pending' if '待核对' in message or '状态open' in message else 'unknown'
    if status is None:
        return None
    qty = re.search(r'(?:本次成交[：:]|数量)\s*(' + NUMBER + r')', message)
    price = re.search(r'(?:成交价[：:]|买入参考价[：:]|卖出参考价[：:])\s*(' + NUMBER + r')', message)
    quantity, value = number(qty[1]) if qty else None, number(price[1]) if price else None
    if status == 'filled' and (not quantity or not value):
        status = 'unknown'
    reason = re.search(r'原因[：:]([^\n]+)', message)
    return {'id': hashlib.sha256((record['date'] + record['time'] + message).encode()).hexdigest()[:20],
            'time': record['time'], 'strategy': key, 'strategy_name': STRATEGIES[key], 'side': side,
            'code': code, 'name': security[1] if security else code, 'quantity': quantity,
            'price': value, 'amount': round(quantity * value, 4) if quantity and value and status == 'filled' else None,
            'status': status, 'reason': reason[1] if reason else '', 'raw': message}


def parse_texts(texts):
    """Merge overlapping exports; repeated identical records do not duplicate trades."""
    all_records = {}
    for text in texts:
        occurrences = {}
        for item in records(text):
            identity = (item['date'], item['time'], item['message'])
            ordinal = occurrences.get(identity, 0)
            occurrences[identity] = ordinal + 1
            all_records.setdefault(identity + (ordinal,), item)
    days = {}
    phase_keys, roles, runtime_keys = {}, {}, {}
    for record in sorted(all_records.values(), key=lambda item: (item['date'], item['time'])):
        date, time, message = record['date'], record['time'], record['message']
        day = days.setdefault(date, empty_day(date))
        explicit = 'morning' if '【多策略盘前日志】' in message else 'close' if '【多策略收盘日志】' in message else None
        phase = explicit
        if not phase and time < '09:30:00' and not any(term in message for term in ('企业微信', '策略启动', '初始化', '已注册任务')):
            phase = 'morning'
        cleaned = re.sub(r'【多策略(?:盘前|收盘)日志】', '', message).strip()
        fallback = phase_keys.get((date, phase), 'unknown') if explicit else runtime_keys.get(date, 'unknown')
        key = strategy_of(cleaned, fallback)
        if '四合一策略' in cleaned:
            key = 'unknown'
        elif key != 'unknown':
            runtime_keys[date] = key
        if phase:
            if day[phase] is None:
                day[phase] = {'time': time, 'lines': [], 'strategies': []}
            section = day[phase]
            section['time'] = max(time, section['time'])
            if explicit:
                phase_keys[(date, phase)] = key
            if cleaned and cleaned not in section['lines']:
                section['lines'].append(cleaned)
            if explicit or key == 'unknown':
                for line in cleaned.splitlines():
                    read_account(day['account'], line.strip())
            if key != 'unknown':
                bucket = group(section, key)
                if cleaned and cleaned not in bucket['lines']:
                    bucket['lines'].append(cleaned)
                allocation = re.search(r'资金占比\s*(' + NUMBER + r')%', cleaned)
                if allocation:
                    bucket['allocation'] = number(allocation[1]) / 100
                heading = re.match(r'^(?:【|=+\s*)([^】=]+)(?:】|\s*=+)$', cleaned)
                if heading and any(word in heading[1] for word in ('入选', '买入', '卖出', '候补', '补足', '备选', '目标持仓')):
                    roles[(date, key)] = heading[1]
                for line in cleaned.splitlines():
                    if phase == 'close':
                        position = read_position(line)
                        if position:
                            bucket['positions'] = [p for p in bucket['positions'] if p['code'] != position['code']] + [position]
                    else:
                        securities = list(SECURITY.finditer(line))
                        for security in securities:
                            role = roles.get((date, key), '备选')
                            candidate = {'name': security[1], 'code': security[2], 'role': role,
                                         'detail': line[security.end():].strip(' |')}
                            if not any(c['code'] == candidate['code'] and c['role'] == role for c in bucket['candidates']):
                                bucket['candidates'].append(candidate)
                        if not securities and key == 'tech':
                            named = re.search(r'(?:【5日线备选】|【金叉备选】)(?:【热门】)?([^\s-]+)-(.+)', line)
                            if named:
                                candidate = {'name': named[1], 'code': '', 'role': '备选（原文无代码）', 'detail': named[2]}
                                if candidate not in bucket['candidates']:
                                    bucket['candidates'].append(candidate)
        trade = read_trade(record, key) if not explicit else None
        if trade and not any(t['id'] == trade['id'] for t in day['trades']):
            day['trades'].append(trade)
        if record['level'] in ('WARNING', 'WARN', 'ERROR'):
            day['warnings'].append({'time': time, 'level': record['level'], 'message': message})
        day['logs'].append({'time': time, 'level': record['level'], 'strategy': key,
                            'phase': phase or ('trade' if trade else 'other'), 'message': message})
    # The strategy can also log its human-readable notification for the same fill.
    # Prefer the structured event, while retaining both source messages in raw logs.
    for day in days.values():
        signatures = {(t['time'], t['strategy'], t['side'], t['code'], t['quantity'], round(t['price'], 3))
                      for t in day['trades'] if t['raw'].startswith('【看板成交】')}
        day['trades'] = [t for t in day['trades'] if t['status'] != 'filled'
                         or t['raw'].startswith('【看板成交】')
                         or (t['time'], t['strategy'], t['side'], t['code'], t['quantity'], round(t['price'], 3)) not in signatures]
    return days
