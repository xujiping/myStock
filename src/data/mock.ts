import type { OverviewData } from '../types'

export const overviewData: OverviewData = {
  asOf: '2026-07-10 18:42',
  coverage: '42 家航天相关 A 股',
  companies: [
    { code: '688066', name: '航天宏图', level: '核心相关', industry: '计算机应用', concept: '商业航天', price: '24.86', change: 6.28, marketCap: '65.4 亿', signal: '放量上行', signalTone: 'positive', tags: ['卫星应用', '遥感'], spark: [18, 22, 19, 26, 31, 28, 36, 42] },
    { code: '300342', name: '天银机电', level: '强相关', industry: '航天装备', concept: '卫星互联网', price: '18.37', change: 4.55, marketCap: '78.8 亿', signal: '相对强势', signalTone: 'positive', tags: ['星敏感器', '军工'], spark: [24, 21, 27, 25, 32, 35, 33, 39] },
    { code: '002025', name: '航天电器', level: '核心相关', industry: '航天装备', concept: '商业航天', price: '54.12', change: -1.42, marketCap: '247.1 亿', signal: '高位整理', signalTone: 'neutral', tags: ['连接器', '军工电子'], spark: [38, 42, 40, 45, 43, 41, 44, 42] },
    { code: '600879', name: '航天电子', level: '核心相关', industry: '航天装备', concept: '卫星互联网', price: '11.64', change: 2.11, marketCap: '316.5 亿', signal: '资金回流', signalTone: 'positive', tags: ['卫星通信', '军工'], spark: [20, 25, 24, 28, 30, 29, 34, 36] },
    { code: '300053', name: '航宇微', level: '强相关', industry: '国防军工', concept: '卫星导航', price: '12.08', change: -3.08, marketCap: '84.3 亿', signal: '减持中', signalTone: 'negative', tags: ['卫星运营', '遥感'], spark: [45, 42, 40, 38, 41, 35, 32, 30] },
    { code: '002446', name: '盛路通信', level: '部分相关', industry: '通信设备', concept: '卫星通信', price: '8.91', change: 1.25, marketCap: '81.2 亿', signal: '窄幅震荡', signalTone: 'neutral', tags: ['天线', '通信'], spark: [31, 33, 32, 35, 34, 36, 35, 37] },
  ],
  events: [
    { id: 'evt-01', time: '17:36', company: '航天宏图', code: '688066', type: '订单', title: '签署卫星遥感数据服务项目合同', detail: '合同金额占上一年度营业收入约 8.6%，项目周期 24 个月。', level: '中' },
    { id: 'evt-02', time: '16:52', company: '航宇微', code: '300053', type: '减持', title: '控股股东减持计划进展至 63%', detail: '计划期限尚余 11 个交易日，当前状态：减持中。', level: '高', status: '减持中' },
    { id: 'evt-03', time: '16:18', company: '航天电器', code: '002025', type: '投资', title: '拟投资建设高可靠连接器产线', detail: '预计总投资 3.2 亿元，资金来源为自有资金。', level: '低' },
    { id: 'evt-04', time: '15:44', company: '天银机电', code: '300342', type: '业绩', title: '半年度业绩预告：净利润同比增长', detail: '预计归母净利润 1.2 至 1.5 亿元，同比增长 32% 至 64%。', level: '中' },
  ],
  boards: [
    { name: '商业航天', change: 2.38, breadth: '31 / 42', leader: '航天宏图' },
    { name: '卫星互联网', change: 1.74, breadth: '24 / 36', leader: '天银机电' },
    { name: '航天装备', change: 0.62, breadth: '18 / 29', leader: '航天电子' },
    { name: '卫星导航', change: -0.41, breadth: '14 / 28', leader: '华力创通' },
  ],
  macro: [
    { label: '7 天 OMO', value: '净投放 1,250 亿', change: '利率 1.40%', tone: 'up' },
    { label: '上证指数', value: '3,482.91', change: '+0.61%', tone: 'up' },
    { label: '纳斯达克', value: '20,567.84', change: '-0.18%', tone: 'down' },
    { label: '日经 225', value: '39,584.79', change: '+0.42%', tone: 'up' },
    { label: '美元 / 人民币', value: '7.1642', change: '+0.09%', tone: 'down' },
  ],
  observations: [
    { index: '01', title: '板块强度', body: '商业航天连续第 3 个交易日跑赢沪深 300，今日上涨家数扩大，强度仍在。', tone: 'amber' },
    { index: '02', title: '事件风险', body: '航宇微减持计划进入后段，尚余期限较短，需关注后续完成公告和成交节奏。', tone: 'red' },
    { index: '03', title: '宏观背景', body: 'OMO 净投放保持宽松，全球科技指数分化，对高估值成长板块形成中性偏正面环境。', tone: 'cyan' },
  ],
}
