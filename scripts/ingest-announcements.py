#!/usr/bin/env python3
"""采集公司池公告并去重入库；东财个股公告为主源，巨潮资讯为非科创板回退。"""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_KEY = 'announcement_last_fetch'
SOURCE_EASTMONEY = '东方财富'
SOURCE_CNINFO = '巨潮资讯'


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
    """为上游偶发断连提供有限重试，避免一次网络抖动中止整批任务。"""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except Exception as error:
            last_error = error
            if attempt == attempts:
                break
            wait_seconds = base_delay * (2 ** (attempt - 1)) + random.uniform(0.0, 1.5)
            print(f'{label}第 {attempt}/{attempts} 次请求失败：{error}；{wait_seconds:.1f} 秒后重试。', file=sys.stderr)
            time.sleep(wait_seconds)
    raise RuntimeError(f'{label}连续 {attempts} 次请求失败：{last_error}') from last_error


def extract_external_key(source_name: str, url: str) -> str:
    """从公告链接中提取外部唯一标识。"""
    if not url:
        return ''
    path = urlsplit(url).path
    parts = [p for p in path.split('/') if p]
    if parts:
        candidate = parts[-1].replace('.html', '')
        if candidate:
            return candidate
    return url


def normalize_published_at(value) -> datetime | None:
    """把东财 date 或巨潮字符串统一为 datetime。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    text = str(value).strip()
    if not text:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d', '%Y/%m/%d'):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def fetch_eastmoney(ak, stock_code: str, start: str, end: str):
    """东财个股公告接口，支持全部代码（含科创板 688）。"""
    frame = ak.stock_individual_notice_report(security=stock_code, begin_date=start, end_date=end)
    if frame is None or frame.empty or '公告标题' not in frame.columns:
        return []
    records = []
    for _, row in frame.iterrows():
        url = str(row.get('网址', '') or '')
        published_at = row.get('公告日期')
        records.append({
            'stock_code': str(row.get('代码', stock_code)).zfill(6),
            'title': str(row.get('公告标题', '')).strip(),
            'published_at': published_at,
            'source_url': url,
            'external_key': extract_external_key(SOURCE_EASTMONEY, url) or f'{stock_code}-{normalize_published_at(published_at)}',
            'notice_type': str(row.get('公告类型', '')).strip(),
        })
    return records


def fetch_cninfo(ak, stock_code: str, start: str, end: str):
    """巨潮资讯接口，官方披露平台，对非科创板代码可用。"""
    frame = ak.stock_zh_a_disclosure_report_cninfo(symbol=stock_code, market='沪深京', start_date=start, end_date=end)
    if frame is None or frame.empty:
        return []
    # 巨潮返回列名可能因版本差异包含额外字段，按实际存在的列读取。
    title_col = '公告标题' if '公告标题' in frame.columns else frame.columns[2] if len(frame.columns) > 2 else None
    time_col = '公告时间' if '公告时间' in frame.columns else None
    link_col = '公告链接' if '公告链接' in frame.columns else None
    if title_col is None:
        return []
    records = []
    for _, row in frame.iterrows():
        title = str(row.get(title_col, '')).strip()
        if not title:
            continue
        url = str(row.get(link_col, '') or '') if link_col else ''
        published_at = normalize_published_at(row.get(time_col)) if time_col else None
        records.append({
            'stock_code': str(row.get('代码', stock_code)).zfill(6),
            'title': title,
            'published_at': published_at,
            'source_url': url,
            'external_key': extract_external_key(SOURCE_CNINFO, url) or f'{stock_code}-{published_at}',
            'notice_type': '',
        })
    return records


def fetch_announcements(ak, stock_code: str, start_date: date, end_date: date, retries: int, retry_delay: float) -> tuple[list[dict], str]:
    """东财主源，巨潮回退；返回公告列表和实际使用的源名。"""
    start_str = start_date.strftime('%Y%m%d')
    end_str = end_date.strftime('%Y%m%d')
    try:
        records = with_retry(
            f'东财公告 {stock_code}',
            lambda: fetch_eastmoney(ak, stock_code, start_str, end_str),
            max(1, retries),
            max(0.1, retry_delay),
        )
        return records, SOURCE_EASTMONEY
    except Exception as eastmoney_error:
        if stock_code.startswith('688'):
            # 巨潮不支持科创板，东财失败时直接报错
            raise RuntimeError(f'东财公告 {stock_code} 不可用，科创板无巨潮回退：{eastmoney_error}') from eastmoney_error
        print(f'东财公告 {stock_code} 不可用，切换至巨潮资讯：{eastmoney_error}', file=sys.stderr)
        records = with_retry(
            f'巨潮公告 {stock_code}',
            lambda: fetch_cninfo(ak, stock_code, start_str, end_str),
            max(1, retries),
            max(0.1, retry_delay),
        )
        return records, SOURCE_CNINFO


def save_checkpoint(cursor, last_date: str, status: str) -> None:
    cursor.execute(
        '''INSERT INTO aero_sync_checkpoint (checkpoint_key, checkpoint_value, status)
           VALUES (%s, %s, %s)
           ON DUPLICATE KEY UPDATE checkpoint_value=VALUES(checkpoint_value), status=VALUES(status)''',
        (CHECKPOINT_KEY, last_date, status),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description='采集公司池公告并去重入库（东财主源，巨潮回退）')
    parser.add_argument('--symbols', type=str, default='', help='逗号分隔的股票代码，留空则处理全部活跃公司')
    parser.add_argument('--backfill-days', type=int, default=14, help='首次回补天数，默认 14')
    parser.add_argument('--force', action='store_true', help='忽略断点，按 --backfill-days 重新回补')
    parser.add_argument('--interval', type=float, default=1.5, help='每公司请求最小间隔（秒），默认 1.5')
    parser.add_argument('--retries', type=int, default=3, help='每个请求最多尝试次数，默认 3')
    parser.add_argument('--retry-delay', type=float, default=3.0, help='首次重试等待秒数，后续指数退避，默认 3')
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
        user=os.environ['DB_USER'], password=os.environ.get('DB_PASSWORD', ''), database=os.environ['DB_NAME'],
        charset=os.environ.get('DB_CHARSET', 'utf8mb4'), autocommit=False,
    )
    started_at = datetime.now()
    run_id = None
    written = 0
    errors: list[str] = []
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO aero_ingestion_run (run_date, task_name, status, started_at) VALUES (%s, %s, %s, %s)',
                (date.today(), 'cninfo_announcement', 'running', started_at),
            )
            run_id = cursor.lastrowid
            cursor.execute('SELECT id, stock_code FROM aero_company WHERE is_active=1 ORDER BY stock_code')
            companies = {str(code).zfill(6): int(company_id) for company_id, code in cursor.fetchall()}
            cursor.execute('SELECT checkpoint_value, status FROM aero_sync_checkpoint WHERE checkpoint_key=%s', (CHECKPOINT_KEY,))
            checkpoint_row = cursor.fetchone()
        connection.commit()

        # 确定采集日期范围：断点续跑用上次截止日，首次或 --force 用 backfill_days。
        today = date.today()
        if args.force or not checkpoint_row or not checkpoint_row[0]:
            start_date = today - timedelta(days=args.backfill_days)
        else:
            try:
                last_fetched = datetime.strptime(str(checkpoint_row[0]).strip(), '%Y-%m-%d').date()
                start_date = last_fetched
            except ValueError:
                start_date = today - timedelta(days=args.backfill_days)
        end_date = today

        if args.symbols:
            target_codes = [c.strip().zfill(6) for c in args.symbols.split(',') if c.strip()]
        else:
            target_codes = sorted(companies.keys())

        latest_fetched = start_date
        for index, stock_code in enumerate(target_codes):
            if stock_code not in companies:
                continue
            if index:
                time.sleep(max(1.0, args.interval) + random.uniform(0.0, 0.8))
            try:
                records, source_name = fetch_announcements(ak, stock_code, start_date, end_date, args.retries, args.retry_delay)
                company_written = 0
                with connection.cursor() as cursor:
                    for record in records:
                        published_at = normalize_published_at(record['published_at'])
                        if not record['title'] or not record['external_key']:
                            continue
                        content_hash = hashlib.sha256(record['title'].encode('utf-8')).hexdigest()
                        cursor.execute(
                            '''INSERT INTO aero_announcement (company_id, external_key, title, published_at, source_name, source_url, content_hash)
                               VALUES (%s, %s, %s, %s, %s, %s, %s)
                               ON DUPLICATE KEY UPDATE title=VALUES(title), published_at=VALUES(published_at), source_url=VALUES(source_url)''',
                            (companies[stock_code], record['external_key'], record['title'][:512], published_at, source_name, record['source_url'][:1024] or None, content_hash),
                        )
                        company_written += cursor.rowcount if cursor.rowcount > 0 else 0
                        if published_at and published_at.date() > latest_fetched:
                            latest_fetched = published_at.date()
                    save_checkpoint(cursor, latest_fetched.isoformat(), 'running')
                connection.commit()
                written += company_written
                print(f'[{index + 1}/{len(target_codes)}] {stock_code}: {len(records)} 条公告（{source_name}），新增 {company_written}')
            except Exception as error:
                connection.rollback()
                errors.append(f'{stock_code}：{error}')
                with connection.cursor() as cursor:
                    save_checkpoint(cursor, latest_fetched.isoformat(), 'partial')
                connection.commit()
                print(f'[{index + 1}/{len(target_codes)}] {stock_code}: 失败 - {error}', file=sys.stderr)

        with connection.cursor() as cursor:
            save_checkpoint(cursor, latest_fetched.isoformat(), 'completed' if not errors else 'partial')
            cursor.execute(
                'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                ('success' if not errors else 'partial', datetime.now(), written, '\n'.join(errors)[:65535] or None, run_id),
            )
        connection.commit()
        print(f'公告采集完成：写入 {written} 条，{len(errors)} 个告警。')
    except Exception as error:
        connection.rollback()
        if run_id:
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                    ('failed', datetime.now(), written, str(error)[:65535], run_id),
                )
            connection.commit()
        print(f'公告采集未完成：{error}', file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        connection.close()


if __name__ == '__main__':
    main()
