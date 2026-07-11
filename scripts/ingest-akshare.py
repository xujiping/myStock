#!/usr/bin/env python3
"""将公司池的 A 股日线行情从 AKShare 幂等写入 aero_daily_quote。"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
import time
from urllib.request import Request, urlopen
from datetime import date, datetime, timedelta
from pathlib import Path

from baostock_client import BaoStockClient

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    """仅读取本地 .env；环境变量优先，避免将凭据写入代码。"""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def nullable(value: object) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
        return None if math.isnan(number) else number
    except (TypeError, ValueError):
        return None


def date_arg(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as error:
        raise argparse.ArgumentTypeError("日期格式应为 YYYY-MM-DD") from error


def latest_weekday(value: date) -> date:
    """默认仅采集最近一个工作日，避免周末发起无效日线请求。"""
    while value.weekday() >= 5:
        value -= timedelta(days=1)
    return value


def market_symbol(stock_code: str) -> str:
    code = stock_code.zfill(6)
    return f"{'sh' if code.startswith(('5', '6', '9')) else 'bj' if code.startswith(('4', '8')) else 'sz'}{code}"


def fetch_history(ak: object, baostock: BaoStockClient, stock_code: str, start: date, end: date):
    """腾讯主源、BaoStock 独立回退、东方财富最后回退。"""
    try:
        frame = ak.stock_zh_a_hist_tx(
            symbol=market_symbol(stock_code), start_date=start.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"), adjust="",
        )
        if not frame.empty:
            return frame, "AKShare/腾讯"
    except Exception as tencent_error:
        primary_error = tencent_error
    else:
        primary_error = RuntimeError("腾讯接口未返回行情")
    try:
        rows = baostock.history(stock_code, start, end)
        return rows, 'BaoStock'
    except Exception as baostock_error:
        fallback_error = baostock_error
    try:
        frame = ak.stock_zh_a_hist(
            symbol=stock_code.zfill(6), period="daily", start_date=start.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"), adjust="",
        )
        if not frame.empty:
            return frame, "AKShare/东方财富"
    except Exception as eastmoney_error:
        raise RuntimeError(f"腾讯接口失败：{primary_error}；BaoStock 失败：{fallback_error}；东方财富接口失败：{eastmoney_error}") from eastmoney_error
    raise RuntimeError(f"腾讯接口失败：{primary_error}；BaoStock 失败：{fallback_error}；东方财富接口未返回行情")


def fetch_tencent_snapshot(stock_code: str) -> dict[str, float | None]:
    """读取腾讯实时快照中的估值指标；数值单位转换为数据库的元。"""
    request = Request(
        f"https://qt.gtimg.cn/q={market_symbol(stock_code)}",
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/"},
    )
    with urlopen(request, timeout=12) as response:
        raw = response.read().decode("gbk", errors="replace")
    if '="' not in raw:
        raise RuntimeError("腾讯快照返回格式异常")
    fields = raw.split('="', 1)[1].rsplit('"', 1)[0].split("~")
    if len(fields) < 47:
        raise RuntimeError("腾讯快照字段不足")
    # 腾讯字段 44/45 的单位为亿元；39 为市盈率，46 为市净率，38 为换手率。
    return {
        "market_cap": (nullable(fields[45]) or 0) * 100_000_000 or None,
        "pe_ttm": nullable(fields[39]),
        "pb": nullable(fields[46]),
        "turnover_rate": nullable(fields[38]),
    }


def fetch_snapshot(baostock: BaoStockClient, stock_code: str, end: date) -> dict[str, float | None]:
    """腾讯实时估值失败时，以 BaoStock 最新收盘估值补齐可得字段。"""
    try:
        return fetch_tencent_snapshot(stock_code)
    except Exception as tencent_error:
        try:
            rows = baostock.history(stock_code, end - timedelta(days=21), end)
            latest = rows[-1]
            return {
                'market_cap': None,
                'pe_ttm': nullable(latest.get('peTTM')),
                'pb': nullable(latest.get('pbMRQ')),
                'turnover_rate': nullable(latest.get('turn')),
            }
        except Exception as baostock_error:
            raise RuntimeError(f'腾讯估值快照失败：{tencent_error}；BaoStock 估值回退失败：{baostock_error}') from baostock_error


def main() -> None:
    parser = argparse.ArgumentParser(description="使用 AKShare 导入公司池 A 股日线行情")
    parser.add_argument("--start", type=date_arg, help="首次建库或强制回补时的开始日期，默认向前覆盖约 250 个交易日")
    parser.add_argument("--end", type=date_arg, default=latest_weekday(date.today()), help="结束日期，默认最近工作日")
    parser.add_argument("--symbols", help="可选，逗号分隔的股票代码；用于定向补数或连通性验证")
    parser.add_argument("--metrics-only", action="store_true", help="仅更新最新交易日的市值、PE、PB、换手率，不重复导入日线")
    parser.add_argument("--snapshot-interval", type=float, default=1.2, help="腾讯快照请求最小间隔（秒），默认 1.2 秒")
    parser.add_argument("--force", action="store_true", help="强制按指定日期范围重新拉取；默认只拉取库中缺失的新日期")
    # pnpm 会将透传分隔符 `--` 一并传给脚本，Python argparse 不接受它之后的选项。
    args = parser.parse_args([argument for argument in sys.argv[1:] if argument != "--"])
    initial_start = args.start or args.end - timedelta(days=370)
    if initial_start > args.end:
        raise SystemExit("开始日期不能晚于结束日期")

    load_env()
    if os.environ.get("AKSHARE_DISABLE_PROXY", "false").lower() == "true":
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            os.environ.pop(key, None)

    try:
        import akshare as ak
        import pymysql
    except ModuleNotFoundError as error:
        raise SystemExit("缺少采集依赖，请先执行：python3 -m pip install -r requirements.txt") from error

    if os.environ.get("DB_ENABLED", "false").lower() != "true":
        raise SystemExit("请先在 .env 中设置 DB_ENABLED=true，再执行行情采集。")
    required = ["DB_HOST", "DB_USER", "DB_NAME"]
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise SystemExit(f".env 缺少数据库配置：{', '.join(missing)}")

    connection = pymysql.connect(
        host=os.environ["DB_HOST"], port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ["DB_USER"], password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ["DB_NAME"], charset=os.environ.get("DB_CHARSET", "utf8mb4"),
        autocommit=False,
    )
    started_at = datetime.now()
    run_id: int | None = None
    written = 0
    errors: list[str] = []
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO aero_ingestion_run (run_date, task_name, status, started_at) VALUES (%s, %s, %s, %s)",
                (args.end, "akshare_daily_quote", "running", started_at),
            )
            run_id = cursor.lastrowid
            cursor.execute(
                """SELECT c.id, c.stock_code, MAX(q.trade_date) AS latest_trade_date
                   FROM aero_company c LEFT JOIN aero_daily_quote q ON q.company_id = c.id
                   WHERE c.is_active = 1 GROUP BY c.id, c.stock_code ORDER BY c.stock_code"""
            )
            companies = cursor.fetchall()
        if args.symbols:
            requested = {item.strip().zfill(6) for item in args.symbols.split(",") if item.strip()}
            companies = [company for company in companies if str(company[1]).zfill(6) in requested]
            if not companies:
                raise SystemExit("指定股票不在已启用的公司池中。")
        connection.commit()

        # 全市场快照依赖东方财富；仅在明确启用时拉取，避免它影响腾讯主行情源。
        market_caps: dict[str, float] = {}
        if os.environ.get("AKSHARE_ENABLE_EM_SNAPSHOT", "false").lower() == "true":
            try:
                spot = ak.stock_zh_a_spot_em()
                if "代码" in spot.columns and "总市值" in spot.columns:
                    market_caps = {str(row["代码"]).zfill(6): nullable(row["总市值"]) or 0 for _, row in spot.iterrows()}
            except Exception as error:  # 快照失败不阻断历史 K 线入库
                errors.append(f"全市场快照失败：{error}")

        requested_companies = 0
        with BaoStockClient() as baostock:
            for company_index, (company_id, stock_code, latest_trade_date) in enumerate(companies):
                try:
                    latest_date = latest_trade_date.date() if hasattr(latest_trade_date, "date") else latest_trade_date
                    fetch_start = initial_start if args.force or latest_date is None else max(initial_start, latest_date + timedelta(days=1))
                    if not args.metrics_only and fetch_start > args.end:
                        print(f"{stock_code}: 已是最新，跳过日线请求")
                        continue
                    # 单请求间隔 + 小幅随机抖动，避免固定节奏的集中访问触发风控。
                    if requested_companies:
                        time.sleep(max(0.3, args.snapshot_interval) + random.uniform(0.15, 0.55))
                    requested_companies += 1
                    try:
                        snapshot = fetch_snapshot(baostock, str(stock_code), args.end)
                    except Exception as snapshot_error:
                        if args.metrics_only:
                            raise RuntimeError(f"腾讯估值快照失败：{snapshot_error}") from snapshot_error
                        errors.append(f"{stock_code}：估值快照未更新：{snapshot_error}")
                        snapshot = {"market_cap": None, "pe_ttm": None, "pb": None, "turnover_rate": None}
                    if args.metrics_only:
                        with connection.cursor() as cursor:
                            cursor.execute(
                                """UPDATE aero_daily_quote SET market_cap=%s, pe_ttm=%s, pb=%s,
                                   turnover_rate=COALESCE(%s, turnover_rate), fetched_at=CURRENT_TIMESTAMP
                                   WHERE company_id=%s AND trade_date=(SELECT latest_trade_date FROM
                                     (SELECT MAX(trade_date) AS latest_trade_date FROM aero_daily_quote WHERE company_id=%s) AS latest)""",
                                (snapshot["market_cap"], snapshot["pe_ttm"], snapshot["pb"], snapshot["turnover_rate"], company_id, company_id),
                            )
                        written += cursor.rowcount
                        connection.commit()
                        print(f"{stock_code}: 更新最新估值指标")
                        continue
                    frame, source_name = fetch_history(ak, baostock, str(stock_code), fetch_start, args.end)
                    history_rows = [row for _, row in frame.iterrows()] if hasattr(frame, 'iterrows') else frame
                    rows = []
                    previous_close: float | None = None
                    for index, row in enumerate(history_rows):
                        trade_date = row.get("日期", row.get("date"))
                        if hasattr(trade_date, "date"):
                            trade_date = trade_date.date()
                        latest = index == len(history_rows) - 1
                        close = nullable(row.get("收盘", row.get("close")))
                        change_pct = nullable(row.get("涨跌幅", row.get("pctChg")))
                        if change_pct is None and close is not None and previous_close not in (None, 0):
                            change_pct = (close - previous_close) / previous_close * 100
                        rows.append((
                            company_id, trade_date, nullable(row.get("开盘", row.get("open"))), nullable(row.get("最高", row.get("high"))), nullable(row.get("最低", row.get("low"))),
                            close, change_pct, nullable(row.get("成交量", row.get("volume"))), nullable(row.get("成交额", row.get("amount"))),
                            snapshot["turnover_rate"] if latest else nullable(row.get("换手率", row.get("turn"))), market_caps.get(str(stock_code).zfill(6), snapshot["market_cap"]) if latest else None, snapshot["pe_ttm"] if latest else None, snapshot["pb"] if latest else None, source_name,
                        ))
                        previous_close = close
                    with connection.cursor() as cursor:
                        cursor.executemany(
                            """INSERT INTO aero_daily_quote
                               (company_id, trade_date, open_price, high_price, low_price, close_price, change_pct, volume, turnover, turnover_rate, market_cap, pe_ttm, pb, source_name)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                               ON DUPLICATE KEY UPDATE open_price=VALUES(open_price), high_price=VALUES(high_price), low_price=VALUES(low_price),
                                 close_price=VALUES(close_price), change_pct=VALUES(change_pct), volume=VALUES(volume), turnover=VALUES(turnover),
                                 turnover_rate=VALUES(turnover_rate), market_cap=COALESCE(VALUES(market_cap), market_cap), pe_ttm=COALESCE(VALUES(pe_ttm), pe_ttm), pb=COALESCE(VALUES(pb), pb),
                                 source_name=VALUES(source_name), fetched_at=CURRENT_TIMESTAMP""",
                            rows,
                        )
                    written += len(rows)
                    connection.commit()
                    print(f"{stock_code}: 写入 {len(rows)} 条")
                except Exception as error:
                    connection.rollback()
                    errors.append(f"{stock_code}：{error}")

        status = "success" if not errors else "partial"
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s",
                (status, datetime.now(), written, "\n".join(errors)[:65535] or None, run_id),
            )
        connection.commit()
        print(f"AKShare 行情采集完成：{written} 条，{len(errors)} 个告警。")
        if errors:
            print("详情已写入 aero_ingestion_run。")
    except Exception as error:
        connection.rollback()
        if run_id:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE aero_ingestion_run SET status=%s, finished_at=%s, records_written=%s, error_message=%s WHERE id=%s",
                    ("failed", datetime.now(), written, str(error)[:65535], run_id),
                )
            connection.commit()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
