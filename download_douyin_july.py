#!/usr/bin/env python3
"""
抖音批量下载 - 凯哥（宏观数据爱好者）

下载指定月份的视频，统一归档到本项目的 `videos/` 目录，
文件名带日期，便于后续 analyze-videos.cjs 扫描并按日期转写。

文件名格式：YYYYMMDD_描述_aweme后6位.mp4
该格式与 analyze-videos.cjs 的 extractDate() 正则兼容。

首次运行：
  cp .env.example .env  # 并填写相关配置（下载仅需 cookies）
  python3 download_douyin_july.py            # 下载当年当月
  python3 download_douyin_july.py --month 7  # 指定月份
"""
import os
import re
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path

import requests

# ─── 项目内固定路径 ───────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = PROJECT_ROOT / "videos"          # 与 analyze-videos.cjs 的 VIDEO_DIR 一致
LOG_FILE = OUTPUT_DIR / "download_log.txt"

# cookies 默认从用户目录读取；如需调整可在下方修改
COOKIES_FILE = Path(os.path.expanduser("~/Downloads/cookies.txt"))

# 抖音目标用户
SEC_USER_ID = "MS4wLjABAAAAlGXcM1dMGB_KOzb8Yzct4HVdP__DwqMjs7f0ytFTz9Q"

# 防风控间隔
DOWNLOAD_DELAY = 8   # 每个视频间隔（秒）
PAGE_DELAY = 15      # 翻页间隔（秒）

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/150.0.0.0 Safari/537.36")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def get_session():
    if not COOKIES_FILE.exists():
        raise FileNotFoundError(f"找不到 cookies 文件：{COOKIES_FILE}")

    cookies = {}
    with open(COOKIES_FILE, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) >= 7 and 'douyin.com' in parts[0]:
                cookies[parts[5]] = parts[6]

    session = requests.Session()
    session.cookies.update(cookies)
    session.headers.update({
        "User-Agent": UA,
        "Referer": f"https://www.douyin.com/user/{SEC_USER_ID}",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    return session


def fetch_page(session, max_cursor=0):
    """获取一页视频列表"""
    url = "https://www.douyin.com/aweme/v1/web/aweme/post/"
    params = {
        "sec_user_id": SEC_USER_ID,
        "count": 18,
        "max_cursor": max_cursor,
        "device_platform": "webapp",
        "aid": "6383",
    }
    resp = session.get(url, params=params, timeout=20)
    return resp.json()


def download_video(url, path):
    headers = {
        'User-Agent': UA,
        'Referer': 'https://www.douyin.com/',
    }
    for retry in range(3):
        try:
            resp = requests.get(url, headers=headers, timeout=60, stream=True)
            if resp.status_code == 200:
                with open(path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                size = os.path.getsize(path)
                if size > 1000:
                    log(f"  ✓ {size / 1024 / 1024:.1f} MB")
                    return True
                os.remove(path)
                log(f"  ✗ 文件太小 ({size}B)")
            else:
                log(f"  ✗ HTTP {resp.status_code}")
        except Exception as e:
            log(f"  ✗ {e}")
            time.sleep(3)
    return False


def sanitize(name):
    """清洗文件名，避免非法字符；与分析脚本对中文友好的排序保持一致。"""
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name[:200] or '视频'


def build_filename(dt, desc, aweme_id):
    """生成符合 analyze-videos.cjs extractDate() 规则的文件名。

    格式：YYYYMMDD_描述_aweme后6位.mp4
    """
    date_str = dt.strftime('%Y%m%d')
    desc_clean = sanitize(desc[:30] if desc else '视频')
    short_id = aweme_id[-6:] if aweme_id else ''
    return f"{date_str}_{desc_clean}_{short_id}.mp4"


def main():
    parser = argparse.ArgumentParser(description="下载抖音指定月份视频到 videos/")
    parser.add_argument('--month', type=int, default=datetime.now().month, help='要下载的月份（默认当年当月）')
    parser.add_argument('--year', type=int, default=datetime.now().year, help='要下载的年份（默认当年）')
    args = parser.parse_args()

    target_month = args.month
    target_year = args.year

    log("=" * 50)
    log(f"开始下载 {target_year} 年 {target_month} 月视频")
    log(f"目标用户: {SEC_USER_ID}")
    log(f"输出目录: {OUTPUT_DIR}")

    session = get_session()

    # 先访问主页，建立 session
    log("初始化 session...")
    try:
        session.get(f"https://www.douyin.com/user/{SEC_USER_ID}", timeout=15)
    except Exception as e:
        log(f"⚠ 访问主页失败（继续尝试）：{e}")
    time.sleep(3)

    max_cursor = 0
    has_more = True
    total_fetched = 0
    total_success = 0
    page = 0

    while has_more:
        page += 1
        log(f"\n--- 翻页 #{page} (cursor={max_cursor}) ---")

        data = fetch_page(session, max_cursor)

        if data.get('status_code') != 0:
            log(f"API 错误: status_code={data.get('status_code')}")
            if data.get('status_code') == 5:
                log("被风控了，等60秒重试...")
                time.sleep(60)
                continue
            break

        aweme_list = data.get('aweme_list', [])
        if not aweme_list:
            log("没有更多视频")
            break

        has_more = data.get('has_more', 0) == 1
        max_cursor = data.get('max_cursor', 0)

        log(f"本页 {len(aweme_list)} 个视频")

        for aweme in aweme_list:
            create_time = aweme.get('create_time', 0)
            dt = datetime.fromtimestamp(create_time)

            # 只下载目标月份
            if dt.year != target_year or dt.month != target_month:
                log(f"跳过 {dt.strftime('%Y%m%d')} (非目标月份 {target_year}-{target_month:02d})")
                # 若已早于目标月份，则不再向后翻
                if (dt.year, dt.month) < (target_year, target_month):
                    has_more = False
                continue

            total_fetched += 1
            aweme_id = aweme.get('aweme_id', '')
            desc = aweme.get('desc', '').strip()

            # 获取下载地址
            video_info = aweme.get('video', {})
            download_url = None
            for addr_key in ['play_addr', 'download_addr']:
                addr = video_info.get(addr_key, {})
                for u in (addr.get('url_list') or addr.get('urlList') or []):
                    if u and u.startswith('http'):
                        download_url = u
                        break
                if download_url:
                    break

            if not download_url:
                log(f"  [{dt.strftime('%Y%m%d')}] {aweme_id} - ⚠ 无下载地址")
                continue

            filename = build_filename(dt, desc, aweme_id)
            filepath = OUTPUT_DIR / filename

            # 断点续传：已存在则跳过
            if filepath.exists():
                size = filepath.stat().st_size
                if size > 1000:
                    log(f"  [{dt.strftime('%Y%m%d')}] {filename} - 已存在 ({size / 1024 / 1024:.1f} MB)，跳过")
                    total_success += 1
                    continue

            log(f"  [{dt.strftime('%Y%m%d')}] {filename}")

            if download_video(download_url, filepath):
                total_success += 1

            time.sleep(DOWNLOAD_DELAY)

        if not has_more:
            log("没有更多页了")
            break

        log(f"等待 {PAGE_DELAY}s 翻到下一页...")
        time.sleep(PAGE_DELAY)

    log(f"\n{'=' * 50}")
    log(f"完成！匹配: {total_fetched}, 成功: {total_success}")
    log(f"保存路径: {OUTPUT_DIR}")
    log(f"日志文件: {LOG_FILE}")
    if total_success:
        log(f"下一步可运行: npm run analyze")


if __name__ == '__main__':
    main()
