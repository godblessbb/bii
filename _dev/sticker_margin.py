"""sticker/pricing.json 毛利表：SPEC §3 的表就是这个脚本的输出，改价 / 改成本后重跑再贴回去。

用法：python3 _dev/sticker_margin.py [--check]
--check：任何一格毛利低于 cost_model.target_min_margin_pct 就退出码 1。
"""
from __future__ import annotations

import json
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def unit_cents(p: dict, size: str, qty: int, finish: str) -> int:
    base = p['unit_price_cents'][size][str(qty)]
    fin = next(f for f in p['finishes'] if f['id'] == finish)
    return int((Decimal(base) * (100 + fin['surcharge_pct']) / 100).quantize(Decimal(1), ROUND_HALF_UP))


def rows(p: dict):
    cm = p['cost_model']
    for s in p['sizes']:
        for q in p['quantities']:
            price = unit_cents(p, s['id'], q, 'glossy') * q
            supplier = round(cm['supplier_pack_cost_cents']['3'][str(q)] * cm['size_cost_multiplier'][s['id']])
            stripe = round(price * cm['stripe_pct'] / 100) + cm['stripe_fixed_cents']
            ai = cm['ai_cost_per_order_cents']
            reprint = round(price * cm['reprint_allowance_pct'] / 100)
            contrib = price - supplier - stripe - ai - reprint
            verified = cm['supplier_pack_cost_verified']['3'][str(q)] and (s['id'] == '3' or cm['size_cost_multiplier_verified'])
            yield s['label'], q, price, supplier, stripe, ai, reprint, contrib, contrib / price * 100, verified


def money(c: int) -> str:
    return f'${c / 100:,.2f}'


def main() -> int:
    p = json.loads((ROOT / 'sticker' / 'pricing.json').read_text())
    target = p['cost_model']['target_min_margin_pct']
    print('| 尺寸 | 数量 | 售价（含运费） | 每张 | 印刷+运费成本 | Stripe | AI 摊销 | 重印预留 | 单笔毛利 | 毛利率 | 成本来源 |')
    print('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|')
    low = []
    for label, q, price, sup, stripe, ai, rep, c, m, ver in rows(p):
        print(f'| {label} | {q} | {money(price)} | {money(price // q)} | {money(sup)} | {money(stripe)} | {money(ai)} | {money(rep)} | {money(c)} | {m:.1f}% | {"官网写明" if ver else "推断"} |')
        if m < target:
            low.append(f'{label} x {q}: {m:.1f}%')
    if low:
        print(f'\n低于目标毛利 {target}%：', '; '.join(low))
    return 1 if (low and '--check' in sys.argv) else 0


if __name__ == '__main__':
    sys.exit(main())
