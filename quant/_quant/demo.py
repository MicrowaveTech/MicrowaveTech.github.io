"""Fictional fixtures, available only through the explicit demo endpoints."""
import json

try:
    from .parser import parse_texts
except ImportError:
    from parser import parse_texts


def demo_days():
    lines = []
    strategies = [
        ('hongli', '红利增强策略', 24, '月度调仓，首个交易日 09:30', '工商银行', '601398.XSHG', 6.30,
         '股息率:6.63% | PE:6.9 | ROE:2.0% | 营收增速:8.3% | 净利增速:3.9% | beta:-2.50'),
        ('tech', '科技股双均线金叉策略', 40, '日度信号，10:30 买入，盘中检查退出', '中际旭创', '300308.XSHE', 120,
         '5 日线向上穿越 20 日线 | 量比:1.35 | 热门行业:通信设备'),
        ('wufu', '五福ETF动量轮动策略', 16, '日度调仓，13:10', '沪深300ETF', '510300.XSHG', 4.1,
         '动量排名:1 | 得分:1.82 | 均线过滤:通过'),
        ('lion', '涨停小狮子策略', 20, '周度调仓，第 2 个交易日 10:26 卖 / 10:27 买', '示例标的', '600001.XSHG', 10,
         '历史涨停基因 | 近期量价筛选通过 | 目标持仓:4 只'),
    ]
    quantities = {'hongli': 2400, 'tech': 300, 'wufu': 3000, 'lion': 1600}
    positions_value = sum(quantities[s[0]] * s[6] for s in strategies)
    previous_value = 100000
    for day, value in [('2026-09-07', 100860), ('2026-09-08', 101240), ('2026-09-09', 101580)]:
        def emit(time, message, level='INFO'):
            lines.append('{} {} - {} - {}'.format(day, time, level, message))
        for key, name, allocation, schedule, stock, code, price, detail in strategies:
            emit('09:00:00', '【多策略盘前日志】【{}】资金占比 {}%'.format(name, allocation))
            emit('09:00:00', '【多策略盘前日志】调仓周期：' + schedule)
            if key == 'hongli':
                emit('09:00:00', '【多策略盘前日志】月线MACD：红利低波 2 只，红利价值 4 只')
                emit('09:00:00', '【多策略盘前日志】全市场5207 → 基础过滤4337 → 现金流3252 → 盈利性2435')
            emit('09:00:00', '【多策略盘前日志】========== 计划买入 ==========')
            emit('09:00:00', '【多策略盘前日志】{}({}) | {}'.format(stock, code, detail))
            event = {'id': day + '-' + key, 'strategy': key, 'side': 'sell' if key == 'wufu' else 'buy',
                     'name': stock, 'code': code, 'quantity': 100 if key == 'tech' else 500,
                     'price': price, 'reason': '演示成交：' + schedule}
            emit('13:10:00' if key == 'wufu' else '10:30:00', '【看板成交】' + json.dumps(event, ensure_ascii=False))
        emit('14:20:00', '演示风险提示：科技策略单票仓位接近配置上限', 'WARNING')
        for text in ['【四合一策略】', '总资产：{}'.format(value), '可用现金：{}'.format(value - positions_value),
                     '持仓市值：{}'.format(positions_value),
                     '当日盈亏：{:+.2f} ({:+.2f}%)'.format(value - previous_value, (value / previous_value - 1) * 100),
                     '累计收益率：{:+.2f}%'.format((value / 100000 - 1) * 100),
                     '总仓位：{:.2f}%'.format(positions_value / value * 100), '持仓数量：4']:
            emit('15:01:00', '【多策略收盘日志】' + text)
        for key, name, allocation, schedule, stock, code, price, detail in strategies:
            emit('15:01:00', '【多策略收盘日志】【{}】资金占比 {}%'.format(name, allocation))
            qty = quantities[key]
            emit('15:01:00', '【多策略收盘日志】{}({}) 股数{} | 成本{:.2f} | 现价{:.2f} | 市值{:.2f} | 仓位{:.2f}% | 盈亏{:+.2f} ({:+.2f}%)'.format(
                stock, code, qty, price - .1, price, price * qty, price * qty / value * 100,
                .1 * qty, .1 / (price - .1) * 100))
        previous_value = value
    days = parse_texts(['\n'.join(lines)])
    for day in days.values():
        day['demo'] = True
    return days
