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
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_KEY = 'akshare_eastmoney_concept_membership_v1'
EASTMONEY_PUSH_HOSTS = ('79.push2.eastmoney.com', '82.push2.eastmoney.com', '81.push2.eastmoney.com', '29.push2.eastmoney.com')


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


def with_retry(label: str, action, attempts: int, base_delay: float):
    """为东方财富的偶发断连提供有限重试，避免一次网络抖动中止整批任务。"""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except Exception as error:
            last_error = error
            if attempt == attempts:
                break
            # 指数退避加少量抖动，降低被上游短时限流后的再次碰撞概率。
            wait_seconds = base_delay * (2 ** (attempt - 1)) + random.uniform(0.0, 1.5)
            print(
                f'{label}第 {attempt}/{attempts} 次请求失败：{error}；{wait_seconds:.1f} 秒后重试。',
                file=sys.stderr,
            )
            time.sleep(wait_seconds)
    raise RuntimeError(f'{label}连续 {attempts} 次请求失败：{last_error}') from last_error


def install_eastmoney_host_rotation() -> None:
    """让 AKShare 在东财推送节点不可用时切换同一接口集群的其他节点。"""
    from akshare.utils import func as akshare_func

    original_request = akshare_func.request_with_retry

    def request_with_host_rotation(url: str, *args, **kwargs):
        parsed = urlsplit(url)
        if not parsed.hostname or not parsed.hostname.endswith('.push2.eastmoney.com'):
            return original_request(url, *args, **kwargs)
        hosts = (parsed.hostname, *[host for host in EASTMONEY_PUSH_HOSTS if host != parsed.hostname])
        last_error: Exception | None = None
        for host in hosts:
            candidate_url = urlunsplit((parsed.scheme, host, parsed.path, parsed.query, parsed.fragment))
            try:
                return original_request(candidate_url, *args, **kwargs)
            except Exception as error:
                last_error = error
        raise RuntimeError(f'东方财富推送节点均不可用：{last_error}') from last_error

    akshare_func.request_with_retry = request_with_host_rotation


def explain_network_error(error: Exception) -> str:
    text = str(error)
    if 'ProxyError' in text or 'Unable to connect to proxy' in text:
        return (
            '东方财富概念接口经本机系统代理访问失败。请在代理客户端中为 *.push2.eastmoney.com '
            '配置可用节点或直连规则，然后手动重新执行；失败板块会保留为待补，不会被标记为已完成。'
        )
    return text


def tushare_code(stock_code: str) -> str:
    if stock_code.startswith(('4', '8')):
        return f'{stock_code}.BJ'
    return f'{stock_code}.SH' if stock_code.startswith(('5', '6', '9')) else f'{stock_code}.SZ'


def sync_tushare_concepts(connection, companies: dict[str, int], checkpoint: dict[str, object], args) -> tuple[int, list[str], list[str]]:
    """按公司查询 Tushare 概念明细，作为东方财富不可用时的独立回退源。"""
    token = os.environ.get('TUSHARE_TOKEN', '').strip()
    if not token:
        raise RuntimeError('东方财富概念接口不可用，且未配置 TUSHARE_TOKEN，无法启用 Tushare Pro 概念明细回退。')
    try:
        import tushare as ts
    except ModuleNotFoundError as error:
        raise RuntimeError('缺少 tushare 依赖，请执行 python3 -m pip install -r requirements.txt。') from error

    pro = ts.pro_api(token, timeout=30)
    retry_companies = checkpoint.get('failed_companies', [])
    target_codes = [str(code).zfill(6) for code in retry_companies] if retry_companies else sorted(companies)
    written = 0
    errors: list[str] = []
    failed_codes: list[str] = []
    for index, stock_code in enumerate(target_codes):
        if index:
            # Tushare Pro 的概念明细按公司查询，控制在约 40 次/分钟以内。
            time.sleep(max(1.5, args.interval))
        try:
            frame = with_retry(
                f'Tushare 概念明细 {stock_code}',
                lambda: pro.concept_detail(
                    ts_code=tushare_code(stock_code),
                    fields='id,concept_name,ts_code,name,in_date,out_date',
                ),
                3,
                2.0,
            )
            concept_names = {
                str(row.get('concept_name', '')).strip()
                for row in frame.to_dict('records')
                if str(row.get('concept_name', '')).strip()
                and str(row.get('out_date', '')).strip().lower() in {'', 'nan', 'none', 'nat'}
            }
            with connection.cursor() as cursor:
                for concept_name in concept_names:
                    cursor.execute(
                        '''INSERT INTO aero_company_tag (company_id, tag_type, tag_name, source_name)
                           SELECT %s, '概念', %s, 'Tushare Pro 概念明细'
                           WHERE NOT EXISTS (
                             SELECT 1 FROM aero_company_tag WHERE company_id=%s AND tag_type='概念'
                               AND tag_name=%s AND (effective_to IS NULL OR effective_to >= CURDATE())
                           )''',
                        (companies[stock_code], concept_name, companies[stock_code], concept_name),
                    )
                    written += cursor.rowcount
                save_checkpoint(cursor, {
                    'source': 'tushare', 'failed_companies': failed_codes,
                    'completed_companies': index + 1, 'total_companies': len(target_codes),
                }, 'running')
            connection.commit()
            print(f'[Tushare {index + 1}/{len(target_codes)}] {stock_code}: 匹配 {len(concept_names)} 个概念')
        except Exception as error:
            connection.rollback()
            errors.append(f'{stock_code} Tushare：{error}')
            failed_codes.append(stock_code)
            with connection.cursor() as cursor:
                save_checkpoint(cursor, {
                    'source': 'tushare', 'failed_companies': failed_codes,
                    'completed_companies': index + 1, 'total_companies': len(target_codes),
                }, 'partial')
            connection.commit()
            print(f'[Tushare {index + 1}/{len(target_codes)}] {stock_code}: 失败 - {error}', file=sys.stderr)
    return written, errors, failed_codes


def main() -> None:
    parser = argparse.ArgumentParser(description='补齐公司池概念标签（东方财富主源，Tushare Pro 自动回退）')
    parser.add_argument('--refresh', action='store_true', help='从首个概念板块重新扫描，用于周期性刷新归属')
    parser.add_argument('--interval', type=float, default=1.5, help='每个概念板块请求最小间隔（秒），默认 1.5')
    parser.add_argument('--max-boards', type=int, help='最多处理多少个概念板块，供分段执行或连通性验证')
    parser.add_argument('--retries', type=int, default=4, help='每个东方财富请求最多尝试次数，默认 4')
    parser.add_argument('--retry-delay', type=float, default=5.0, help='首次重试等待秒数，后续指数退避，默认 5')
    args = parser.parse_args([item for item in sys.argv[1:] if item != '--'])
    load_env()
    if os.environ.get('DB_ENABLED', 'false').lower() != 'true':
        raise SystemExit('请先在 .env 中设置 DB_ENABLED=true。')
    try:
        import akshare as ak
        import pymysql
    except ModuleNotFoundError as error:
        raise SystemExit('缺少采集依赖，请先执行：python3 -m pip install -r requirements.txt') from error
    install_eastmoney_host_rotation()

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
        try:
            concepts = with_retry(
                '概念板块清单',
                lambda: ak.stock_board_concept_name_em()[['板块代码', '板块名称']].dropna().sort_values('板块代码').to_dict('records'),
                max(1, args.retries),
                max(0.1, args.retry_delay),
            )
        except Exception as eastmoney_error:
            print('东方财富概念接口不可用，切换至 Tushare Pro 概念明细。', file=sys.stderr)
            fallback_written, fallback_errors, failed_companies = sync_tushare_concepts(connection, companies, checkpoint, args)
            written += fallback_written
            errors.extend(fallback_errors)
            with connection.cursor() as cursor:
                save_checkpoint(cursor, {
                    'source': 'tushare', 'failed_companies': failed_companies,
                    'total_companies': len(companies),
                }, 'completed' if not failed_companies else 'partial')
                cursor.execute(
                    'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                    ('success' if not errors else 'partial', datetime.now(), written, '\n'.join(errors)[:65535] or None, run_id),
                )
            connection.commit()
            print(f'概念标签采集完成（Tushare 回退）：写入 {written} 条，{len(errors)} 个告警。')
            return
        if offset >= len(concepts) and not checkpoint.get('failed_boards'):
            offset = 0
        pending_failures = [] if args.refresh else checkpoint.get('failed_boards', [])
        concept_by_code = {str(item['板块代码']): item for item in concepts}
        # 上次没有成功的板块优先补齐；只有它们全成功后才继续向后扫描，避免静默漏采。
        retry_concepts = [concept_by_code[str(item.get('code'))] for item in pending_failures if str(item.get('code')) in concept_by_code]
        retrying_failures = bool(retry_concepts)
        if retrying_failures:
            work_items = [(concepts.index(item), item) for item in retry_concepts]
            next_offset = offset
        else:
            end = min(len(concepts), offset + args.max_boards) if args.max_boards else len(concepts)
            work_items = list(enumerate(concepts[offset:end], start=offset))
            next_offset = end
        failed_by_code: dict[str, dict[str, str]] = {
            str(item.get('code')): {'code': str(item.get('code')), 'name': str(item.get('name', ''))}
            for item in pending_failures if item.get('code')
        }

        for position, (index, concept) in enumerate(work_items):
            code, name = str(concept['板块代码']), str(concept['板块名称']).strip()
            if position > 0:
                # 东方财富默认策略：1.5~3 秒，带随机抖动，降低集中请求风险。
                time.sleep(max(1.5, args.interval) + random.uniform(0.0, 1.5))
            try:
                frame = with_retry(
                    f'概念板块 {name}（{code}）',
                    lambda: ak.stock_board_concept_cons_em(symbol=code),
                    max(1, args.retries),
                    max(0.1, args.retry_delay),
                )
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
                    failed_by_code.pop(code, None)
                    progress_offset = next_offset if retrying_failures else index + 1
                    save_checkpoint(cursor, {
                        'offset': progress_offset, 'total': len(concepts), 'last_board': code,
                        'failed_boards': list(failed_by_code.values()),
                    }, 'running')
                connection.commit()
                print(f'[{index + 1}/{len(concepts)}] {name}: 匹配 {len(matched_codes)} 家')
            except Exception as error:
                connection.rollback()
                errors.append(f'{code} {name}：{error}')
                failed_by_code[code] = {'code': code, 'name': name}
                with connection.cursor() as cursor:
                    progress_offset = next_offset if retrying_failures else index + 1
                    save_checkpoint(cursor, {
                        'offset': progress_offset, 'total': len(concepts), 'last_board': code,
                        'failed_boards': list(failed_by_code.values()),
                    }, 'partial')
                connection.commit()
                print(f'[{index + 1}/{len(concepts)}] {name}: 失败 - {error}', file=sys.stderr)

        completed = next_offset == len(concepts) and not failed_by_code
        with connection.cursor() as cursor:
            save_checkpoint(cursor, {
                'offset': 0 if completed else next_offset, 'total': len(concepts),
                'failed_boards': list(failed_by_code.values()),
            }, 'completed' if completed else ('partial' if failed_by_code else 'paused'))
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
        print(f'概念归属未完成：{explain_network_error(error)}', file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        connection.close()


if __name__ == '__main__':
    main()
