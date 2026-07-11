"""BaoStock 会话与数据读取的轻量封装，供各采集任务复用。"""

from __future__ import annotations

from datetime import date
from typing import Any


class BaoStockClient:
    """延迟登录，确保 BaoStock 不可用时不会阻断其他数据源。"""

    def __init__(self) -> None:
        try:
            import baostock as bs
        except ModuleNotFoundError as error:
            raise RuntimeError('未安装 baostock，请执行：python3 -m pip install -r requirements.txt') from error
        self._bs = bs
        self._logged_in = False

    def __enter__(self) -> 'BaoStockClient':
        return self

    def __exit__(self, *_: object) -> None:
        if self._logged_in:
            self._bs.logout()
            self._logged_in = False

    def _login(self) -> None:
        if self._logged_in:
            return
        result = self._bs.login()
        if result.error_code != '0':
            raise RuntimeError(f'BaoStock 登录失败：{result.error_msg}')
        self._logged_in = True

    @staticmethod
    def _rows(result: Any) -> list[dict[str, str]]:
        if result.error_code != '0':
            raise RuntimeError(f'BaoStock 查询失败：{result.error_msg}')
        rows: list[dict[str, str]] = []
        while result.next():
            rows.append(dict(zip(result.fields, result.get_row_data())))
        return rows

    @staticmethod
    def symbol(stock_code: str) -> str:
        code = stock_code.zfill(6)
        exchange = 'sh' if code.startswith(('5', '6', '9')) else 'bj' if code.startswith(('4', '8')) else 'sz'
        return f'{exchange}.{code}'

    def history(self, stock_code: str, start: date, end: date) -> list[dict[str, str]]:
        self._login()
        result = self._bs.query_history_k_data_plus(
            self.symbol(stock_code),
            'date,code,open,high,low,close,volume,amount,turn,pctChg,peTTM,pbMRQ',
            start_date=start.isoformat(), end_date=end.isoformat(), frequency='d', adjustflag='3',
        )
        rows = self._rows(result)
        if not rows:
            raise RuntimeError('BaoStock 未返回日线数据')
        return rows

    def industry(self, stock_code: str) -> str:
        self._login()
        result = self._bs.query_stock_industry(code=self.symbol(stock_code), date='')
        rows = self._rows(result)
        for row in rows:
            industry = row.get('industry', '').strip()
            if industry and industry != '-':
                return industry
        raise RuntimeError('BaoStock 未返回行业字段')

    def profit(self, stock_code: str, year: int, quarter: int) -> list[dict[str, str]]:
        self._login()
        return self._rows(self._bs.query_profit_data(code=self.symbol(stock_code), year=year, quarter=quarter))
