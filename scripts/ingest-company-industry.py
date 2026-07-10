#!/usr/bin/env python3
"""从东方财富个股公开页补齐公司池的行业标签；默认只请求缺失项。"""

from __future__ import annotations

import argparse
import os
import random
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

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


def market_prefix(stock_code: str) -> str:
    code = stock_code.zfill(6)
    return 'sh' if code.startswith(('5', '6', '9')) else 'bj' if code.startswith(('4', '8')) else 'sz'


def fetch_industry_from_page(opener, stock_code: str) -> str:
    url = f'https://quote.eastmoney.com/{market_prefix(stock_code)}{stock_code.zfill(6)}.html'
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9'})
    with opener.open(request, timeout=20) as response:
        html = response.read().decode('utf-8', errors='replace')
    match = re.search(r'"bk_name"\s*:\s*"([^"]+)"', html)
    if not match or not match.group(1).strip():
        raise RuntimeError('页面未包含行业字段')
    return match.group(1).strip()


def fetch_industry(ak, opener, stock_code: str) -> tuple[str, str]:
    """优先走 AKShare 个股信息接口，公开页面仅作为网络兼容性回退。"""
    try:
        frame = ak.stock_individual_info_em(symbol=stock_code.zfill(6), timeout=20)
        matches = frame.loc[frame['item'] == '行业', 'value']
        if not matches.empty and str(matches.iloc[0]).strip() and str(matches.iloc[0]) != '-':
            return str(matches.iloc[0]).strip(), 'AKShare/东方财富个股信息'
        raise RuntimeError('AKShare 未返回行业字段')
    except Exception:
        return fetch_industry_from_page(opener, stock_code), '东方财富个股页（AKShare 回退）'


def main() -> None:
    parser = argparse.ArgumentParser(description='补齐公司池行业标签（东方财富公开个股页）')
    parser.add_argument('--symbols', help='可选，逗号分隔的股票代码；用于定向补数')
    parser.add_argument('--force', action='store_true', help='重新读取已存在行业标签的公司')
    parser.add_argument('--interval', type=float, default=1.5, help='站点请求最小间隔（秒），默认 1.5')
    args = parser.parse_args([item for item in sys.argv[1:] if item != '--'])
    load_env()
    if os.environ.get('DB_ENABLED', 'false').lower() != 'true':
        raise SystemExit('请先在 .env 中设置 DB_ENABLED=true。')

    try:
        import akshare as ak
        import pymysql
    except ModuleNotFoundError as error:
        raise SystemExit('缺少采集依赖，请先执行：python3 -m pip install -r requirements.txt') from error

    connection = pymysql.connect(
        host=os.environ['DB_HOST'], port=int(os.environ.get('DB_PORT', '3306')),
        user=os.environ['DB_USER'], password=os.environ.get('DB_PASSWORD', ''), database=os.environ['DB_NAME'],
        charset=os.environ.get('DB_CHARSET', 'utf8mb4'), autocommit=False,
    )
    opener = build_opener(ProxyHandler({}))
    started_at = datetime.now()
    run_id = None
    written = 0
    errors: list[str] = []
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO aero_ingestion_run (run_date, task_name, status, started_at) VALUES (%s, %s, %s, %s)',
                (date.today(), 'eastmoney_company_industry', 'running', started_at),
            )
            run_id = cursor.lastrowid
            where = '' if args.force else "HAVING COALESCE(SUM(t.tag_type = '行业'), 0) = 0"
            cursor.execute(f'''
                SELECT c.id, c.stock_code, c.company_name
                FROM aero_company c LEFT JOIN aero_company_tag t ON t.company_id = c.id
                WHERE c.is_active = 1
                GROUP BY c.id, c.stock_code, c.company_name
                {where}
                ORDER BY c.stock_code
            ''')
            companies = cursor.fetchall()
        if args.symbols:
            requested = {item.strip().zfill(6) for item in args.symbols.split(',') if item.strip()}
            companies = [company for company in companies if str(company[1]).zfill(6) in requested]
        connection.commit()

        if not companies:
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s WHERE id=%s',
                    ('success', datetime.now(), 0, run_id),
                )
            connection.commit()
            print('行业标签已是最新，无需请求。')
            return
        for index, (company_id, stock_code, company_name) in enumerate(companies):
            if index:
                # 东方财富默认策略：1.5~3 秒，随机抖动避免固定节奏。
                time.sleep(max(1.5, args.interval) + random.uniform(0.0, 1.5))
            try:
                industry, source_name = fetch_industry(ak, opener, str(stock_code))
                with connection.cursor() as cursor:
                    cursor.execute(
                        '''INSERT INTO aero_company_tag (company_id, tag_type, tag_name, source_name)
                           SELECT %s, '行业', %s, %s
                           WHERE NOT EXISTS (
                             SELECT 1 FROM aero_company_tag WHERE company_id=%s AND tag_type='行业'
                               AND tag_name=%s AND (effective_to IS NULL OR effective_to >= CURDATE())
                           )''',
                        (company_id, industry, source_name, company_id, industry),
                    )
                    written += cursor.rowcount
                connection.commit()
                print(f'{stock_code} {company_name}: {industry}')
            except Exception as error:
                connection.rollback()
                errors.append(f'{stock_code} {company_name}：{error}')
                print(f'{stock_code} {company_name}: 失败 - {error}', file=sys.stderr)

        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                ('success' if not errors else 'partial', datetime.now(), written, '\n'.join(errors)[:65535] or None, run_id),
            )
        connection.commit()
        print(f'行业标签采集完成：写入 {written} 条，{len(errors)} 个告警。')
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
