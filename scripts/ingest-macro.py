#!/usr/bin/env python3
"""采集宏观指标（A 股指数、全球指数、汇率、回购利率）并去重入库。"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_TX = '腾讯'
SOURCE_SINA = '新浪'
SOURCE_REPO = '中国外汇交易中心'


def load_env() -> None:
    env_path = ROOT / '.env'
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def with_retry(label: str, action, attempts: int, base_delay: float):
    """为上游偶发断连提供有限重试。"""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except Exception as error:
            last_error = error
            if attempt == attempts:
                break
            wait_seconds = base_delay * (2 ** (attempt - 1)) + random.uniform(0.0, 1.0)
            print(f'{label}第 {attempt}/{attempts} 次请求失败：{error}；{wait_seconds:.1f} 秒后重试。', file=sys.stderr)
            time.sleep(wait_seconds)
    raise RuntimeError(f'{label}连续 {attempts} 次请求失败：{last_error}') from last_error


def safe_change_pct(current: float, previous: float) -> float | None:
    """计算环比涨跌幅，前值为 0 或异常时返回 None。"""
    if not previous or math.isnan(previous) or math.isnan(current):
        return None
    return round(((current - previous) / previous) * 100, 4)


def fetch_a_share_index(ak, symbol: str, indicator_key: str, indicator_name: str) -> dict | None:
    """腾讯接口获取 A 股指数最新行情。"""
    frame = with_retry(
        f'A股指数 {indicator_name}',
        lambda: ak.stock_zh_index_daily_tx(symbol=symbol),
        3, 2.0,
    )
    if frame is None or frame.empty or len(frame) < 2:
        return None
    last = frame.iloc[-1]
    prev = frame.iloc[-2]
    close = float(last['close'])
    change_pct = safe_change_pct(close, float(prev['close']))
    observed_date = last['date']
    if isinstance(observed_date, datetime):
        observed_date = observed_date.date()
    elif isinstance(observed_date, str):
        observed_date = datetime.strptime(observed_date, '%Y-%m-%d').date()
    return {
        'indicator_key': indicator_key,
        'indicator_name': indicator_name,
        'observed_date': observed_date,
        'value': close,
        'value_text': None,
        'change_pct': change_pct,
        'unit': '',
        'source_name': SOURCE_TX,
    }


def fetch_global_index(ak, symbol: str, indicator_key: str, indicator_name: str) -> dict | None:
    """新浪接口获取全球指数最新行情。"""
    frame = with_retry(
        f'全球指数 {indicator_name}',
        lambda: ak.index_global_hist_sina(symbol=symbol),
        3, 2.0,
    )
    if frame is None or frame.empty or len(frame) < 2:
        return None
    last = frame.iloc[-1]
    prev = frame.iloc[-2]
    close = float(last['close'])
    change_pct = safe_change_pct(close, float(prev['close']))
    observed_date = last['date']
    if isinstance(observed_date, datetime):
        observed_date = observed_date.date()
    elif isinstance(observed_date, str):
        observed_date = datetime.strptime(observed_date, '%Y-%m-%d').date()
    return {
        'indicator_key': indicator_key,
        'indicator_name': indicator_name,
        'observed_date': observed_date,
        'value': close,
        'value_text': None,
        'change_pct': change_pct,
        'unit': '',
        'source_name': SOURCE_SINA,
    }


def fetch_usdcny(ak) -> dict | None:
    """新浪中行牌价获取美元兑人民币汇率。"""
    end = date.today().strftime('%Y%m%d')
    start = (date.today() - timedelta(days=7)).strftime('%Y%m%d')
    frame = with_retry(
        '美元/人民币汇率',
        lambda: ak.currency_boc_sina(symbol='美元', start_date=start, end_date=end),
        3, 2.0,
    )
    if frame is None or frame.empty:
        return None
    last = frame.iloc[-1]
    prev = frame.iloc[-2] if len(frame) >= 2 else None
    # 央行中间价为 nan 时用中行折算价回退
    mid_price = last.get('央行中间价')
    if mid_price is None or (isinstance(mid_price, float) and math.isnan(mid_price)):
        mid_price = last.get('中行折算价')
    if mid_price is None:
        return None
    value = float(mid_price) / 100.0  # 中行牌价以 100 外币为单位
    change_pct = None
    if prev is not None:
        prev_mid = prev.get('央行中间价')
        if prev_mid is None or (isinstance(prev_mid, float) and math.isnan(prev_mid)):
            prev_mid = prev.get('中行折算价')
        if prev_mid is not None:
            change_pct = safe_change_pct(value, float(prev_mid) / 100.0)
    observed_date = last['日期']
    if isinstance(observed_date, datetime):
        observed_date = observed_date.date()
    return {
        'indicator_key': 'USDCNY',
        'indicator_name': '美元 / 人民币',
        'observed_date': observed_date,
        'value': value,
        'value_text': None,
        'change_pct': change_pct,
        'unit': '',
        'source_name': SOURCE_SINA,
    }


def fetch_fr007(ak) -> dict | None:
    """中国外汇交易中心回购定盘利率获取 FR007。"""
    frame = with_retry(
        '7天回购利率',
        lambda: ak.repo_rate_query(symbol='回购定盘利率'),
        3, 2.0,
    )
    if frame is None or frame.empty or len(frame) < 2:
        return None
    last = frame.iloc[-1]
    prev = frame.iloc[-2]
    rate = last.get('FR007')
    if rate is None:
        return None
    rate = float(rate)
    prev_rate = prev.get('FR007')
    change_pct = safe_change_pct(rate, float(prev_rate)) if prev_rate is not None else None
    observed_date = last['date']
    if isinstance(observed_date, datetime):
        observed_date = observed_date.date()
    elif isinstance(observed_date, str):
        observed_date = datetime.strptime(observed_date, '%Y-%m-%d').date()
    return {
        'indicator_key': 'FR007',
        'indicator_name': '7 天回购利率',
        'observed_date': observed_date,
        'value': rate,
        'value_text': f'利率 {rate:.2f}%',
        'change_pct': change_pct,
        'unit': '%',
        'source_name': SOURCE_REPO,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description='采集宏观指标并去重入库')
    parser.add_argument('--force', action='store_true', help='覆盖当日已有数据')
    args = parser.parse_args([item for item in sys.argv[1:] if item != '--'])
    load_env()
    if os.environ.get('DB_ENABLED', 'false').lower() != 'true':
        raise SystemExit('请先在 .env 中设置 DB_ENABLED=true。')
    if os.environ.get('AKSHARE_DISABLE_PROXY', 'false').lower() == 'true':
        for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
            os.environ.pop(key, None)
    try:
        import akshare as ak
        import pymysql
    except ModuleNotFoundError as error:
        raise SystemExit('缺少采集依赖，请先执行：python3 -m pip install -r requirements.txt') from error

    connection = pymysql.connect(
        host=os.environ['DB_HOST'], port=int(os.environ.get('DB_PORT', '3306')),
        user=os.environ['DB_USER'], password=os.environ.get('DB_PASSWORD', ''),
        database=os.environ['DB_NAME'], charset=os.environ.get('DB_CHARSET', 'utf8mb4'),
        autocommit=False,
    )
    started_at = datetime.now()
    run_id = None
    written = 0
    errors: list[str] = []
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO aero_ingestion_run (run_date, task_name, status, started_at) VALUES (%s, %s, %s, %s)',
                (date.today(), 'macro_indicator', 'running', started_at),
            )
            run_id = cursor.lastrowid
        connection.commit()

        # 指标定义：(fetcher, args)
        fetchers: list[tuple[str, callable]] = []

        # A 股指数（腾讯接口）
        for symbol, key, name in [
            ('sh000001', 'SSE_INDEX', '上证指数'),
            ('sz399001', 'SZSE_INDEX', '深证成指'),
            ('sz399006', 'CHINEXT_INDEX', '创业板指'),
            ('sh000688', 'STAR50_INDEX', '科创50'),
        ]:
            fetchers.append((name, lambda s=symbol, k=key, n=name: fetch_a_share_index(ak, s, k, n)))

        # 全球指数（新浪接口，用中文名）
        for symbol, key, name in [
            ('日经225指数', 'NIKKEI225_INDEX', '日经 225'),
            ('德国DAX 30种股价指数', 'DAX_INDEX', '德国 DAX'),
            ('英国富时100指数', 'FTSE100_INDEX', '英国富时 100'),
        ]:
            fetchers.append((name, lambda s=symbol, k=key, n=name: fetch_global_index(ak, s, k, n)))

        # 汇率
        fetchers.append(('美元/人民币', lambda: fetch_usdcny(ak)))
        # 回购利率
        fetchers.append(('7天回购利率', lambda: fetch_fr007(ak)))

        records: list[dict] = []
        for label, fetcher in fetchers:
            time.sleep(max(0.5, 0.8 + random.uniform(0.0, 0.5)))
            try:
                record = fetcher()
                if record:
                    records.append(record)
                    print(f'[宏观] {label}: {record["observed_date"]} value={record["value"]} change={record["change_pct"]}')
                else:
                    errors.append(f'{label}: 未获取到数据')
                    print(f'[宏观] {label}: 未获取到数据', file=sys.stderr)
            except Exception as error:
                errors.append(f'{label}: {error}')
                print(f'[宏观] {label}: 失败 - {error}', file=sys.stderr)

        # 写入数据库
        for record in records:
            with connection.cursor() as cursor:
                cursor.execute(
                    '''INSERT INTO aero_macro_indicator (indicator_key, indicator_name, observed_date, value, value_text, change_pct, unit, source_name)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                       ON DUPLICATE KEY UPDATE indicator_name=VALUES(indicator_name), value=VALUES(value), value_text=VALUES(value_text),
                       change_pct=VALUES(change_pct), unit=VALUES(unit), source_name=VALUES(source_name)''',
                    (record['indicator_key'], record['indicator_name'], record['observed_date'],
                     record['value'], record['value_text'], record['change_pct'], record['unit'], record['source_name']),
                )
                written += 1
        connection.commit()

        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                ('success' if not errors else 'partial', datetime.now(), written, '\n'.join(errors)[:65535] or None, run_id),
            )
        connection.commit()
        print(f'宏观指标采集完成：写入 {written} 条，{len(errors)} 个告警。')
    except Exception as error:
        connection.rollback()
        if run_id:
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                    ('failed', datetime.now(), written, str(error)[:65535], run_id),
                )
            connection.commit()
        print(f'宏观指标采集未完成：{error}', file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        connection.close()


if __name__ == '__main__':
    main()
