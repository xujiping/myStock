#!/usr/bin/env python3
"""从已入库公告中规则抽取重大事项、解析关键字段并维护减持状态机。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 事件类型 → (关键词列表, 风险等级)
# 顺序敏感：减持/增持等高优先级类型在前，避免被"公告"等通用词误匹配。
EVENT_RULES: list[tuple[str, list[str], str]] = [
    ('减持', ['减持计划', '减持股份', '减持进展', '减持实施', '减持完成', '减持结果', '减持数量过半', '减持时间过半', '减持预披露', '股东减持'], '高'),
    ('增持', ['增持计划', '增持股份', '增持进展', '增持实施', '增持完成', '增持结果', '股东增持'], '低'),
    ('回购', ['回购报告书', '回购股份', '回购进展', '回购完成', '回购实施', '股份回购', '回购注销'], '低'),
    ('解禁', ['限售股上市', '解除限售', '限售股解禁', '股份上市流通'], '中'),
    ('定增', ['非公开发行', '定向增发', '配股说明书', '配股结果'], '中'),
    ('业绩', ['业绩预告', '业绩快报', '业绩预盈', '业绩预亏', '业绩修正', '年度报告', '年报披露', '半年度报告', '半年报', '一季报', '三季报', '第一季度报告', '第三季度报告'], '低'),
    ('股权', ['实际控制人变更', '实际控制人发生变更', '控股权变更', '股权结构变动', '控股股东变更', '一致行动人', '表决权委托'], '高'),
    ('诉讼', ['诉讼', '仲裁', '行政处罚', '监管问询', '问询函', '立案调查', '责令改正', '警示函', '纪律处分'], '高'),
    ('订单', ['中标', '合同', '签署协议', '项目中标', '中标结果', '业务合同', '框架协议', '战略合作协议'], '低'),
    ('投资', ['对外投资', '设立子公司', '设立全资子公司', '项目投资', '增资', '投资建设', '设立合资公司', '产业基地'], '低'),
    ('并购', ['重大资产重组', '资产收购', '资产出售', '吸收合并', '并购重组', '发行股份购买资产'], '中'),
]


def load_env() -> None:
    env_path = ROOT / '.env'
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def classify_event(title: str) -> tuple[str | None, str]:
    """根据公告标题匹配事件类型和风险等级。返回 (event_type, risk_level) 或 (None, '低')。"""
    for event_type, keywords, risk_level in EVENT_RULES:
        if any(keyword in title for keyword in keywords):
            return event_type, risk_level
    return None, '低'


def parse_percentage(text: str, pattern: str) -> float | None:
    """从文本中提取百分比数值。"""
    match = re.search(pattern, text)
    if not match:
        return None
    try:
        return float(match.group(1))
    except (ValueError, IndexError):
        return None


def parse_date_range(text: str) -> tuple[date | None, date | None]:
    """从公告标题中解析起止日期，匹配 YYYY年M月D日 或 YYYY-MM-DD。"""
    date_pattern = r'(\d{4})年(\d{1,2})月(\d{1,2})日'
    matches = re.findall(date_pattern, text)
    if not matches:
        iso_pattern = r'(\d{4})-(\d{1,2})-(\d{1,2})'
        matches = re.findall(iso_pattern, text)
    if not matches:
        return None, None
    parsed = []
    for y, m, d in matches:
        try:
            parsed.append(date(int(y), int(m), int(d)))
        except ValueError:
            continue
    if len(parsed) >= 2:
        return parsed[0], parsed[1]
    if len(parsed) == 1:
        return parsed[0], None
    return None, None


def parse_reduction_fields(title: str) -> dict:
    """解析减持公告的关键字段。"""
    fields: dict = {}
    # 计划减持比例：不超过 X%
    planned = parse_percentage(title, r'不超过.*?(\d+(?:\.\d+)?)\s*%')
    if planned is not None:
        fields['planned_quantity'] = planned
    # 已减持比例
    completed = parse_percentage(title, r'已减持.*?(\d+(?:\.\d+)?)\s*%')
    if completed is not None:
        fields['completed_quantity'] = completed
    # 进展类标题里如有"X%"也可能表示完成比例
    elif '进展' in title or '实施' in title:
        progress = parse_percentage(title, r'(\d+(?:\.\d+)?)\s*%')
        if progress is not None:
            fields['completed_quantity'] = progress
    # 起止日期
    start_date, end_date = parse_date_range(title)
    if start_date:
        fields['planned_start_date'] = start_date
    if end_date:
        fields['planned_end_date'] = end_date
    return fields


def parse_order_amount(title: str) -> str | None:
    """从订单/合同公告中解析金额信息，作为 detail 的一部分。"""
    amount_match = re.search(r'(约|不超过|不低于)?\s*([\d.]+)\s*亿元', title)
    if amount_match:
        prefix = amount_match.group(1) or ''
        return f'{prefix}{amount_match.group(2)}亿元'
    pct = parse_percentage(title, r'占.*?营业收入.*?(\d+(?:\.\d+)?)\s*%')
    if pct is not None:
        return f'占营业收入约{pct}%'
    return None


def determine_reduction_status(title: str, planned_end_date: date | None, today: date) -> str:
    """减持状态机：根据标题关键词和计划日期判断当前状态。"""
    if any(keyword in title for keyword in ['减持完成', '减持完毕', '减持结果', '已完成减持']):
        return '减持完毕'
    if any(keyword in title for keyword in ['减持进展', '减持实施', '减持数量过半', '减持时间过半', '减持预披露']):
        if planned_end_date and today > planned_end_date:
            return '计划到期未完成'
        return '减持中'
    if any(keyword in title for keyword in ['减持计划', '股东减持']):
        if planned_end_date and today > planned_end_date:
            return '计划到期未完成'
        return '即将减持' if '计划' in title else '减持中'
    return '待确认'


def build_event_detail(event_type: str, title: str, fields: dict) -> str:
    """构造事件详情摘要。"""
    parts = [title]
    if event_type == '减持':
        detail_parts = []
        if 'planned_quantity' in fields:
            detail_parts.append(f'计划减持不超过 {fields["planned_quantity"]}%')
        if 'completed_quantity' in fields:
            detail_parts.append(f'已减持 {fields["completed_quantity"]}%')
        if 'planned_start_date' in fields:
            detail_parts.append(f'起始 {fields["planned_start_date"]}')
        if 'planned_end_date' in fields:
            detail_parts.append(f'截止 {fields["planned_end_date"]}')
        if detail_parts:
            parts.append('；'.join(detail_parts) + '。')
    elif event_type == '订单':
        amount = parse_order_amount(title)
        if amount:
            parts.append(f'金额约 {amount}。')
    return ' '.join(parts)[:2000]


def main() -> None:
    parser = argparse.ArgumentParser(description='从已入库公告规则抽取重大事项并维护减持状态机')
    parser.add_argument('--reprocess', action='store_true', help='重新处理全部公告，而不仅处理尚未抽取的')
    args = parser.parse_args([item for item in sys.argv[1:] if item != '--'])
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
    started_at = datetime.now()
    run_id = None
    written = 0
    errors: list[str] = []
    today = date.today()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO aero_ingestion_run (run_date, task_name, status, started_at) VALUES (%s, %s, %s, %s)',
                (date.today(), 'rule_event_extraction', 'running', started_at),
            )
            run_id = cursor.lastrowid
            # 只处理尚未抽取的公告（LEFT JOIN 找无事件的）；--reprocess 时处理全部
            if args.reprocess:
                cursor.execute('''
                    SELECT a.id, a.company_id, a.title, a.published_at, a.source_name, a.source_url
                    FROM aero_announcement a
                    WHERE a.company_id IS NOT NULL
                    ORDER BY a.published_at DESC
                ''')
            else:
                cursor.execute('''
                    SELECT a.id, a.company_id, a.title, a.published_at, a.source_name, a.source_url
                    FROM aero_announcement a
                    LEFT JOIN aero_event e ON e.announcement_id = a.id
                    WHERE a.company_id IS NOT NULL AND e.id IS NULL
                    ORDER BY a.published_at DESC
                ''')
            announcements = cursor.fetchall()
        connection.commit()

        print(f'待处理公告：{len(announcements)} 条')

        for announcement_id, company_id, title, published_at, source_name, source_url in announcements:
            try:
                title_str = str(title or '').strip()
                if not title_str:
                    continue
                event_type, risk_level = classify_event(title_str)
                if event_type is None:
                    continue

                fields = {}
                if event_type == '减持':
                    fields = parse_reduction_fields(title_str)

                status = None
                if event_type == '减持':
                    status = determine_reduction_status(title_str, fields.get('planned_end_date'), today)

                detail = build_event_detail(event_type, title_str, fields)
                announced_at = published_at if isinstance(published_at, datetime) else (
                    datetime.combine(published_at, datetime.min.time()) if isinstance(published_at, date) else datetime.now()
                )
                evidence = {'source_name': str(source_name or ''), 'source_url': str(source_url or ''), 'title': title_str[:500]}

                with connection.cursor() as cursor:
                    # 幂等：查是否已有同公司+同公告+同类型的事件
                    cursor.execute(
                        'SELECT id, status FROM aero_event WHERE company_id=%s AND announcement_id=%s AND event_type=%s LIMIT 1',
                        (company_id, announcement_id, event_type),
                    )
                    existing = cursor.fetchone()
                    if existing:
                        existing_id, old_status = existing
                        # 更新已有事件的字段
                        cursor.execute(
                            '''UPDATE aero_event SET risk_level=%s, title=%s, detail=%s, status=%s,
                               planned_start_date=%s, planned_end_date=%s, planned_quantity=%s, completed_quantity=%s,
                               evidence_json=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s''',
                            (risk_level, title_str[:512], detail, status,
                             fields.get('planned_start_date'), fields.get('planned_end_date'),
                             fields.get('planned_quantity'), fields.get('completed_quantity'),
                             json.dumps(evidence, ensure_ascii=False), existing_id),
                        )
                        # 减持状态变化时追加历史
                        if event_type == '减持' and status and status != old_status:
                            cursor.execute(
                                'INSERT INTO aero_event_status_history (event_id, old_status, new_status, changed_at, evidence_announcement_id) VALUES (%s, %s, %s, %s, %s)',
                                (existing_id, old_status, status, datetime.now(), announcement_id),
                            )
                        written += 1
                    else:
                        cursor.execute(
                            '''INSERT INTO aero_event (company_id, announcement_id, event_type, status, risk_level, title, detail, announced_at,
                               planned_start_date, planned_end_date, planned_quantity, completed_quantity, evidence_json)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
                            (company_id, announcement_id, event_type, status, risk_level, title_str[:512], detail, announced_at,
                             fields.get('planned_start_date'), fields.get('planned_end_date'),
                             fields.get('planned_quantity'), fields.get('completed_quantity'),
                             json.dumps(evidence, ensure_ascii=False)),
                        )
                        new_event_id = cursor.lastrowid
                        # 首次创建减持事件时写初始状态历史
                        if event_type == '减持' and status:
                            cursor.execute(
                                'INSERT INTO aero_event_status_history (event_id, old_status, new_status, changed_at, evidence_announcement_id) VALUES (%s, %s, %s, %s, %s)',
                                (new_event_id, None, status, datetime.now(), announcement_id),
                            )
                        written += 1
                connection.commit()
            except Exception as error:
                connection.rollback()
                errors.append(f'公告 {announcement_id}（{str(title)[:30]}）：{error}')
                print(f'公告 {announcement_id} 抽取失败：{error}', file=sys.stderr)

        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                ('success' if not errors else 'partial', datetime.now(), written, '\n'.join(errors)[:65535] or None, run_id),
            )
        connection.commit()
        print(f'事件抽取完成：写入 {written} 条，{len(errors)} 个告警。')
    except Exception as error:
        connection.rollback()
        if run_id:
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s',
                    ('failed', datetime.now(), written, str(error)[:65535], run_id),
                )
            connection.commit()
        print(f'事件抽取未完成：{error}', file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        connection.close()


if __name__ == '__main__':
    main()
