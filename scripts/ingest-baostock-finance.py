#!/usr/bin/env python3
"""将 BaoStock 季频盈利能力原样归档到 aero_financial_profit。"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

from baostock_client import BaoStockClient

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    env_path = ROOT / '.env'
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def recent_periods(lookback: int) -> list[tuple[int, int]]:
    current_index = date.today().year * 4 + (date.today().month - 1) // 3
    return [((current_index - offset) // 4, (current_index - offset) % 4 + 1) for offset in range(lookback)]


def main() -> None:
    parser = argparse.ArgumentParser(description='采集公司池季频盈利能力（BaoStock）')
    parser.add_argument('--symbols', help='可选，逗号分隔的股票代码；用于定向补数')
    parser.add_argument('--year', type=int, help='指定报告年份，须同时指定 --quarter')
    parser.add_argument('--quarter', type=int, choices=(1, 2, 3, 4), help='指定报告季度，须同时指定 --year')
    parser.add_argument('--lookback', type=int, default=8, help='未指定报告期时回补最近季度数，默认 8')
    args = parser.parse_args([item for item in sys.argv[1:] if item != '--'])
    if bool(args.year) != bool(args.quarter):
        raise SystemExit('--year 与 --quarter 必须同时指定。')
    if args.lookback < 1:
        raise SystemExit('--lookback 必须大于 0。')

    load_env()
    if os.environ.get('DB_ENABLED', 'false').lower() != 'true':
        raise SystemExit('请先在 .env 中设置 DB_ENABLED=true。')
    try:
        import pymysql
    except ModuleNotFoundError as error:
        raise SystemExit('缺少采集依赖，请先执行：python3 -m pip install -r requirements.txt') from error

    connection = pymysql.connect(
        host=os.environ['DB_HOST'], port=int(os.environ.get('DB_PORT', '3306')),
        user=os.environ['DB_USER'], password=os.environ.get('DB_PASSWORD', ''), database=os.environ['DB_NAME'],
        charset=os.environ.get('DB_CHARSET', 'utf8mb4'), autocommit=False,
    )
    periods = [(args.year, args.quarter)] if args.year else recent_periods(args.lookback)
    started_at = datetime.now()
    run_id = None
    written = 0
    errors: list[str] = []
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO aero_ingestion_run (run_date, task_name, status, started_at) VALUES (%s, %s, %s, %s)',
                (date.today(), 'baostock_financial_profit', 'running', started_at),
            )
            run_id = cursor.lastrowid
            cursor.execute('SELECT id, stock_code, company_name FROM aero_company WHERE is_active=1 ORDER BY stock_code')
            companies = cursor.fetchall()
        if args.symbols:
            requested = {item.strip().zfill(6) for item in args.symbols.split(',') if item.strip()}
            companies = [company for company in companies if str(company[1]).zfill(6) in requested]
            if not companies:
                raise SystemExit('指定股票不在已启用的公司池中。')
        connection.commit()

        with BaoStockClient() as baostock:
            for company_id, stock_code, company_name in companies:
                for report_year, report_quarter in periods:
                    try:
                        rows = baostock.profit(str(stock_code), report_year, report_quarter)
                        if not rows:
                            continue
                        with connection.cursor() as cursor:
                            for row in rows:
                                cursor.execute(
                                    '''INSERT INTO aero_financial_profit
                                       (company_id, report_year, report_quarter, metrics_json, source_name)
                                       VALUES (%s, %s, %s, %s, 'BaoStock')
                                       ON DUPLICATE KEY UPDATE metrics_json=VALUES(metrics_json), source_name=VALUES(source_name), fetched_at=CURRENT_TIMESTAMP''',
                                    (company_id, report_year, report_quarter, json.dumps(row, ensure_ascii=False)),
                                )
                                written += cursor.rowcount
                        connection.commit()
                    except Exception as error:
                        connection.rollback()
                        errors.append(f'{stock_code} {company_name} {report_year}Q{report_quarter}：{error}')
                        print(errors[-1], file=sys.stderr)

        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                ('success' if not errors else 'partial', datetime.now(), written, '\n'.join(errors)[:65535] or None, run_id),
            )
        connection.commit()
        print(f'BaoStock 财务采集完成：写入 {written} 条，{len(errors)} 个告警。')
    except Exception as error:
        connection.rollback()
        if run_id:
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                    ('failed', datetime.now(), written, str(error)[:65535], run_id),
                )
            connection.commit()
        raise
    finally:
        connection.close()


if __name__ == '__main__':
    main()
