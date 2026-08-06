/*
 * 行情数据解析纯函数。
 *
 * 从各采集脚本抽离，便于在无网络环境下做单元测试。
 * 所有函数都不发起网络请求，只负责把原始文本/JSON 解析成结构化数据。
 */

// ── 新浪行情 ────────────────────────────────────────────────────

/**
 * 解析新浪指数/个股行情。
 * @param {string} body  hq.sinajs.cn 原始响应（已 GBK→UTF-8）
 * @param {string} code  如 sh000001、sz002714
 */
function parseSinaQuote(body, code) {
  const m = body.match(new RegExp(`var hq_str_${code}="([^"]*)"`));
  if (!m) return null;
  const f = m[1].split(',');
  if (f.length < 32) return null;
  const price = Number(f[3]);
  const prevClose = Number(f[2]);
  const changePct = prevClose ? (price - prevClose) / prevClose * 100 : 0;
  return {
    name: f[0],
    price,
    prevClose,
    open: Number(f[1]),
    high: Number(f[4]),
    low: Number(f[5]),
    turnover: Number(f[9]),
    date: f[30],
    time: f[31],
    changePct: Number(changePct.toFixed(2)),
  };
}

/**
 * 解析新浪个股批量行情，返回 { code: quote } 映射（不含 prevClose 等完整字段，只取关键项）。
 */
function parseSinaStocks(body) {
  const result = {};
  const re = /var hq_str_(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(body))) {
    const code = m[1];
    const f = m[2].split(',');
    if (f.length < 10) continue;
    const price = Number(f[3]);
    const prevClose = Number(f[2]);
    result[code] = {
      code,
      name: f[0],
      price,
      prevClose,
      changePct: prevClose ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0,
    };
  }
  return result;
}

/**
 * 解析新浪板块行情（概念 / 行业）。
 * @param {string} body  newFLJK.php / newSinaHy.php 原始响应
 * @param {string} varName  S_Finance_bankuai_class | S_Finance_bankuai_sinaindustry
 */
function parseSinaBoard(body, varName) {
  const m = body.match(new RegExp(`var\\s+${varName}\\s*=\\s*([\\s\\S]+)`));
  if (!m) return {};
  let raw = m[1].trim();
  if (raw.endsWith(';')) raw = raw.slice(0, -1);
  let obj;
  try { obj = JSON.parse(raw); } catch { return {}; }
  const result = {};
  for (const [code, val] of Object.entries(obj)) {
    const f = String(val).split(',');
    if (f.length < 13) continue;
    result[f[1]] = {
      code,
      name: f[1],
      changePct: Number(f[5]),
      turnover: Number(f[7]),
      leaderStock: f[12],
      leaderChangePct: Number(f[10]),
    };
  }
  return result;
}

// ── 东方财富（zjlx 页 innerText）─────────────────────────────────

/**
 * 从东方财富大盘资金流向页 innerText 抽取主力资金净流入等数字。
 */
function parseMainFunds(innerText) {
  const pick = (re) => {
    const m = innerText.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    mainNet: pick(/主力净流入[：:\s]*([-\d.]+)\s*亿/),
    mainPct: pick(/主力净比[：:\s]*([-\d.]+)\s*%/),
    superLargeNet: pick(/超大单净流入[：:\s]*([-\d.]+)\s*亿/),
    superLargePct: pick(/超大单净比[：:\s]*([-\d.]+)\s*%/),
    largeNet: pick(/大单净流入[：:\s]*([-\d.]+)\s*亿/),
    largePct: pick(/大单净比[：:\s]*([-\d.]+)\s*%/),
    mediumNet: pick(/中单净流入[：:\s]*([-\d.]+)\s*亿/),
    mediumPct: pick(/中单净比[：:\s]*([-\d.]+)\s*%/),
    smallNet: pick(/小单净流入[：:\s]*([-\d.]+)\s*亿/),
    smallPct: pick(/小单净比[：:\s]*([-\d.]+)\s*%/),
  };
}

/**
 * 从 innerText 抽取涨跌平家数。
 * 形如：上证 : 3832.26 ↑27.57 ↑0.72% 1.19万亿元 (涨: 1886 平: 71 跌: 392 )
 */
function parseAdvanceDecline(innerText) {
  const block = innerText.match(/上证\s*:[\s\S]{0,120}?跌:\s*\d+/);
  if (!block) return null;
  const up = block[0].match(/涨:\s*(\d+)/);
  const flat = block[0].match(/平:\s*(\d+)/);
  const down = block[0].match(/跌:\s*(\d+)/);
  return {
    up: up ? Number(up[1]) : null,
    flat: flat ? Number(flat[1]) : null,
    down: down ? Number(down[1]) : null,
  };
}

module.exports = {
  parseSinaQuote,
  parseSinaStocks,
  parseSinaBoard,
  parseMainFunds,
  parseAdvanceDecline,
};
