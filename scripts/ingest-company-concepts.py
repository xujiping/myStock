#!/usr/bin/env python3
"""用 AKShare 概念板块成分反向匹配公司池；默认断点续跑且不重复全量扫描。"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_KEY = 'akshare_eastmoney_concept_membership_v1'


def load_env() -> None:
    env_path = ROOT / '.env'
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def save_checkpoint(cursor, value: dict[str, object], status: str) -> None:
    cursor.execute(
        '''INSERT INTO aero_sync_checkpoint (checkpoint_key, checkpoint_value, status)
           VALUES (%s, %s, %s)
           ON DUPLICATE KEY UPDATE checkpoint_value=VALUES(checkpoint_value), status=VALUES(status)''',
        (CHECKPOINT_KEY, json.dumps(value, ensure_ascii=False), status),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description='使用 AKShare 补齐公司池概念标签')
    parser.add_argument('--refresh', action='store_true', help='从首个概念板块重新扫描，用于周期性刷新归属')
    parser.add_argument('--interval', type=float, default=1.5, help='每个概念板块请求最小间隔（秒），默认 1.5')
    parser.add_argument('--max-boards', type=int, help='最多处理多少个概念板块，供分段执行或连通性验证')
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
    started_at = datetime.now()
    run_id = None
    written = 0
    errors: list[str] = []
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO aero_ingestion_run (run_date, task_name, status, started_at) VALUES (%s, %s, %s, %s)',
                (date.today(), 'akshare_company_concept', 'running', started_at),
            )
            run_id = cursor.lastrowid
            cursor.execute('SELECT id, stock_code FROM aero_company WHERE is_active=1')
            companies = {str(code).zfill(6): int(company_id) for company_id, code in cursor.fetchall()}
            cursor.execute('SELECT checkpoint_value, status FROM aero_sync_checkpoint WHERE checkpoint_key=%s', (CHECKPOINT_KEY,))
            checkpoint_row = cursor.fetchone()
        connection.commit()

        checkpoint = json.loads(checkpoint_row[0]) if checkpoint_row and checkpoint_row[0] else {'offset': 0}
        if checkpoint_row and checkpoint_row[1] == 'completed' and not args.refresh:
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s WHERE id=%s',
                    ('success', datetime.now(), 0, run_id),
                )
            connection.commit()
            print('概念归属已完成；如需周期性重新核对，请显式传入 --refresh。')
            return
        offset = 0 if args.refresh else int(checkpoint.get('offset', 0))
        concepts = ak.stock_board_concept_name_em()[['板块代码', '板块名称']].dropna().sort_values('板块代码').to_dict('records')
        if offset >= len(concepts):
            offset = 0
        end = min(len(concepts), offset + args.max_boards) if args.max_boards else len(concepts)

        for index in range(offset, end):
            concept = concepts[index]
            code, name = str(concept['板块代码']), str(concept['板块名称']).strip()
            if index > offset:
                # 东方财富默认策略：1.5~3 秒，带随机抖动，降低集中请求风险。
                time.sleep(max(1.5, args.interval) + random.uniform(0.0, 1.5))
            try:
                frame = ak.stock_board_concept_cons_em(symbol=code)
                matched_codes = {str(value).zfill(6) for value in frame['代码'].tolist()} & companies.keys()
                with connection.cursor() as cursor:
                    for stock_code in matched_codes:
                        cursor.execute(
                            '''INSERT INTO aero_company_tag (company_id, tag_type, tag_name, source_name)
                               SELECT %s, '概念', %s, 'AKShare/东方财富概念板块'
                               WHERE NOT EXISTS (
                                 SELECT 1 FROM aero_company_tag WHERE company_id=%s AND tag_type='概念'
                                   AND tag_name=%s AND (effective_to IS NULL OR effective_to >= CURDATE())
                               )''',
                            (companies[stock_code], name, companies[stock_code], name),
                        )
                        written += cursor.rowcount
                    save_checkpoint(cursor, {'offset': index + 1, 'total': len(concepts), 'last_board': code}, 'running')
                connection.commit()
                print(f'[{index + 1}/{len(concepts)}] {name}: 匹配 {len(matched_codes)} 家')
            except Exception as error:
                connection.rollback()
                errors.append(f'{code} {name}：{error}')
                with connection.cursor() as cursor:
                    save_checkpoint(cursor, {'offset': index + 1, 'total': len(concepts), 'last_board': code}, 'running')
                connection.commit()
                print(f'[{index + 1}/{len(concepts)}] {name}: 失败 - {error}', file=sys.stderr)

        completed = end == len(concepts)
        with connection.cursor() as cursor:
            save_checkpoint(cursor, {'offset': 0 if completed else end, 'total': len(concepts)}, 'completed' if completed else 'paused')
            cursor.execute(
                'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                ('success' if not errors else 'partial', datetime.now(), written, '\n'.join(errors)[:65535] or None, run_id),
            )
        connection.commit()
        print(f'概念标签采集完成：写入 {written} 条，{len(errors)} 个告警。')
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
