#!/usr/bin/env python3
"""A 股数据源对比测试脚本：逐个测试各数据源的可用性和数据覆盖面。"""

from __future__ import annotations
import time
import sys

TEST_CODE_AK = "600879"   # 航天电子
TEST_CODE_SH = "sh.600879"
TEST_CODE_SZ = "sz.000001"  # 平安银行


def test_baostock():
    print("=" * 60)
    print("【BaoStock 测试】")
    print("=" * 60)
    try:
        import baostock as bs
        print("✓ 模块导入成功")
        lg = bs.login()
        print(f"  登录: error_code={lg.error_code}, msg={lg.error_msg}")

        # 日K线
        print("\n--- 日K线 (sh.600879, 最近一周) ---")
        t0 = time.time()
        rs = bs.query_history_k_data_plus(
            "sh.600879",
            "date,code,open,high,low,close,volume,amount,turn,pctChg",
            start_date="2025-07-01", end_date="2025-07-08",
            frequency="d", adjustflag="3"
        )
        rows = []
        while (rs.error_code == '0') and rs.next():
            rows.append(rs.get_row_data())
        print(f"  {len(rows)} 条, {time.time()-t0:.2f}s, fields={rs.fields}")
        if rows:
            print(f"  首行: {rows[0]}")
            print(f"  末行: {rows[-1]}")

        # 分钟K线
        print("\n--- 5分钟K线 (sh.600879) ---")
        t0 = time.time()
        rs2 = bs.query_history_k_data_plus(
            "sh.600879", "date,time,code,open,high,low,close,volume,amount",
            start_date="2025-07-07", end_date="2025-07-08",
            frequency="5", adjustflag="3"
        )
        rows2 = []
        while (rs2.error_code == '0') and rs2.next():
            rows2.append(rs2.get_row_data())
        print(f"  {len(rows2)} 条, {time.time()-t0:.2f}s")
        if rows2:
            print(f"  首行: {rows2[0]}")

        # 估值指标
        print("\n--- 估值指标 PE/PB (sh.600879) ---")
        t0 = time.time()
        rs3 = bs.query_history_k_data_plus(
            "sh.600879", "date,code,peTTM,pbMRQ,psTTM,pcfNcfTTM",
            start_date="2025-07-01", end_date="2025-07-08", frequency="d"
        )
        rows3 = []
        while (rs3.error_code == '0') and rs3.next():
            rows3.append(rs3.get_row_data())
        print(f"  {len(rows3)} 条, {time.time()-t0:.2f}s")
        if rows3:
            print(f"  数据: {rows3[0]}")

        # 行业分类
        print("\n--- 行业分类 (申万) ---")
        t0 = time.time()
        rs4 = bs.query_stock_industry(code="sh.600879")
        rows4 = []
        while (rs4.error_code == '0') and rs4.next():
            rows4.append(rs4.get_row_data())
        print(f"  {len(rows4)} 条, {time.time()-t0:.2f}s, fields={rs4.fields}")
        if rows4:
            print(f"  数据: {rows4[0]}")

        # 季频财务
        print("\n--- 季频盈利能力 (2024Q4) ---")
        t0 = time.time()
        rs5 = bs.query_profit_data(code="sh.600879", year=2024, quarter=4)
        rows5 = []
        while (rs5.error_code == '0') and rs5.next():
            rows5.append(rs5.get_row_data())
        print(f"  {len(rows5)} 条, {time.time()-t0:.2f}s")
        if rows5:
            print(f"  fields={rs5.fields}")
            print(f"  数据: {rows5[0]}")

        bs.logout()
        print("\n✅ BaoStock 测试完成\n")
        return True
    except Exception as e:
        import traceback
        print(f"\n❌ BaoStock 失败: {e}")
        traceback.print_exc()
        return False


def test_efinance():
    print("=" * 60)
    print("【efinance 测试】")
    print("=" * 60)
    try:
        import efinance as ef
        print("✓ 模块导入成功")

        # 日K线
        print("\n--- 日K线 (600879, 最近30天) ---")
        t0 = time.time()
        df = ef.stock.get_quote_history("600879", kctypes="日K")
        print(f"  {len(df)} 条, {time.time()-t0:.2f}s")
        print(f"  列: {list(df.columns)}")
        if not df.empty:
            print(f"  末2行:\n{df.tail(2).to_string()}")

        # 实时行情
        print("\n--- 实时行情快照 ---")
        t0 = time.time()
        df2 = ef.stock.get_realtime_quotes()
        print(f"  全市场 {len(df2)} 条, {time.time()-t0:.2f}s")
        print(f"  列: {list(df2.columns)[:15]}...")
        sample = df2[df2['股票名称'].str.contains('航天电子', na=False)] if '股票名称' in df2.columns else df2.head(1)
        if not sample.empty:
            print(f"  样本:\n{sample.to_string()}")

        # 财务指标
        print("\n--- 财务指标 (600879) ---")
        t0 = time.time()
        try:
            df3 = ef.stock.get_base_info("600879")
            print(f"  {len(df3)} 条, {time.time()-t0:.2f}s")
            print(f"  列: {list(df3.columns) if hasattr(df3, 'columns') else 'N/A'}")
            print(f"  数据:\n{df3.to_string() if not df3.empty else '空'}")
        except Exception as e:
            print(f"  基本面接口: {e}")

        print("\n✅ efinance 测试完成\n")
        return True
    except Exception as e:
        import traceback
        print(f"\n❌ efinance 失败: {e}")
        traceback.print_exc()
        return False


def test_tushare():
    print("=" * 60)
    print("【Tushare 测试】（需要 token，测试导入和免费接口）")
    print("=" * 60)
    try:
        import tushare as ts
        print(f"✓ 模块导入成功, 版本: {ts.__version__}")
        # 没有 token 时测试基础接口
        print("\n--- 测试基础接口（无需token）: 实时行情 ---")
        t0 = time.time()
        try:
            df = ts.get_realtime_quotes("600879")
            print(f"  {len(df)} 条, {time.time()-t0:.2f}s")
            if not df.empty:
                cols = [c for c in ['code','name','price','open','high','low','volume','amount','pe','pb','market_value'] if c in df.columns]
                print(f"  可用列: {cols}")
                print(f"  数据:\n{df[cols].to_string()}")
        except Exception as e:
            print(f"  实时行情: {e}")

        print("\n--- 测试旧版接口（无需token）: 历史数据 ---")
        t0 = time.time()
        try:
            df2 = ts.get_hist_data("600879", start="2025-07-01", end="2025-07-08")
            print(f"  {len(df2)} 条, {time.time()-t0:.2f}s")
            if not df2.empty:
                print(f"  末2行:\n{df2.tail(2).to_string()}")
        except Exception as e:
            print(f"  历史数据: {e}")

        print("\n✅ Tushare 测试完成（注：Pro接口需要注册token）\n")
        return True
    except ImportError:
        print("⚠ Tushare 未安装")
        return False
    except Exception as e:
        import traceback
        print(f"\n❌ Tushare 失败: {e}")
        traceback.print_exc()
        return False


def test_adata():
    print("=" * 60)
    print("【AData 测试】")
    print("=" * 60)
    try:
        import adata
        print(f"✓ 模块导入成功, 版本: {adata.__version__}")
        
        print("\n--- 日K线 (600879) ---")
        t0 = time.time()
        df = adata.stock.market.get_market(stock_code="600879", start_date="2025-07-01")
        print(f"  {len(df)} 条, {time.time()-t0:.2f}s")
        print(f"  列: {list(df.columns)}")
        if not df.empty:
            print(f"  末2行:\n{df.tail(2).to_string()}")

        print("\n--- 实时行情 ---")
        t0 = time.time()
        try:
            df2 = adata.stock.market.get_market_realtime()
            print(f"  全市场 {len(df2)} 条, {time.time()-t0:.2f}s")
            print(f"  列: {list(df2.columns)[:15]}")
        except Exception as e:
            print(f"  实时行情: {e}")

        print("\n✅ AData 测试完成\n")
        return True
    except ImportError:
        print("⚠ AData 未安装")
        return False
    except Exception as e:
        import traceback
        print(f"\n❌ AData 失败: {e}")
        traceback.print_exc()
        return False


def test_tickflow():
    print("=" * 60)
    print("【TickFlow 测试】")
    print("=" * 60)
    try:
        import tickflow
        print(f"✓ 模块导入成功")
        print(f"  可用方法: {[m for m in dir(tickflow) if not m.startswith('_')]}")
        print("\n✅ TickFlow 测试完成\n")
        return True
    except ImportError:
        print("⚠ TickFlow SDK 未安装（pip install tickflow）")
        return False
    except Exception as e:
        print(f"\n❌ TickFlow 失败: {e}")
        return False


if __name__ == "__main__":
    print("A股数据源对比测试")
    print(f"测试时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    results = {}
    for name, fn in [
        ("BaoStock", test_baostock),
        ("efinance", test_efinance),
        ("Tushare", test_tushare),
        ("AData", test_adata),
        ("TickFlow", test_tickflow),
    ]:
        try:
            results[name] = fn()
        except Exception as e:
            print(f"\n❌ {name} 异常: {e}\n")
            results[name] = False

    print("\n" + "=" * 60)
    print("汇总")
    print("=" * 60)
    for name, ok in results.items():
        print(f"  {name}: {'✅ 通过' if ok else '❌ 失败/未安装'}")
