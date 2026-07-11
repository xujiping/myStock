import type { CompanySpaceProfile, OverviewData } from '../types'

export const demoProfiles: Record<string, CompanySpaceProfile> = {
  '688066': {
    commercialRevenueShare: '约 58%', commercialRevenueState: '公开资料推算', commercialRevenueConfidence: '中', updatedAt: '2026-07-10',
    nonSpaceCoreBusinesses: ['数字地球', '智慧城市'], businessSummary: '以卫星遥感数据服务及行业应用为商业航天主要抓手，同时保有数字地球与行业数字化业务。',
    businesses: [
      { id: 'ht-1', primarySector: '航天应用与数据服务', secondarySector: '遥感应用', role: '核心业务', revenueShare: '约 65%', companyRevenueShare: '约 38%', status: '持续经营', confidence: '中', dataState: '公开资料推算', chainValue: '系统价值量 20%–35%', chainImportance: 4, companyImportance: 5, source: '公司年报及产品资料', sourceDate: '2025-12-31', note: '遥感应用口径包含数据处理与行业解决方案。' },
      { id: 'ht-2', primarySector: '航天应用与数据服务', secondarySector: '卫星数据服务', role: '重要业务', revenueShare: '约 35%', companyRevenueShare: '约 20%', status: '持续经营', confidence: '中', dataState: '研究估计', chainValue: '服务价值量 15%–25%', chainImportance: 4, companyImportance: 4, source: '公司公告、合同及研究整理', sourceDate: '2026-07-10' },
    ],
    evidences: [{ id: 'e1', title: '年度报告：主营业务与卫星应用介绍', source: '公司年报', publishedAt: '2026-04-28', dataState: '明确披露', excerpt: '披露遥感应用、数据服务及行业解决方案的业务布局。' }],
    revisions: [{ id: 'r1', entityType: '公司画像', action: '更新', fieldName: '商业航天收入占比', beforeValue: '待确认', afterValue: '约 58%', reason: '结合分部披露与项目清单重新估算', operatorName: '研究员 XJ', isManual: true, createdAt: '2026-07-10 18:30' }],
  },
  '300342': {
    commercialRevenueShare: '约 22%–35%', commercialRevenueState: '研究估计', commercialRevenueConfidence: '低', updatedAt: '2026-07-10',
    nonSpaceCoreBusinesses: ['冰箱压缩机零部件', '智能家电控制'], businessSummary: '航天业务以姿态敏感器和卫星相关部组件为主，收入拆分尚未见明确披露。',
    businesses: [
      { id: 'ty-1', primarySector: '卫星制造', secondarySector: '卫星部组件', role: '重要业务', revenueShare: '约 70%', companyRevenueShare: '约 18%–28%', status: '持续经营', confidence: '低', dataState: '研究估计', chainValue: '卫星成本 3%–8%', chainImportance: 5, companyImportance: 4, source: '投资者问答、产品资料', sourceDate: '2026-06-30' },
      { id: 'ty-2', primarySector: '导航、测控与地面系统', secondarySector: '测控设备', role: '相关业务', revenueShare: '约 30%', companyRevenueShare: '约 4%–7%', status: '持续经营', confidence: '低', dataState: '待确认', chainValue: '系统价值量 2%–5%', chainImportance: 4, companyImportance: 3, source: '公开新闻与客户线索', sourceDate: '2026-07-10' },
    ],
    evidences: [{ id: 'e2', title: '投资者关系活动记录：星敏感器产品', source: '投资者关系记录', publishedAt: '2026-05-16', dataState: '明确披露', excerpt: '公司说明星敏感器等产品的应用方向。' }], revisions: [],
  },
  '002025': {
    commercialRevenueShare: '约 15%–25%', commercialRevenueState: '公开资料推算', commercialRevenueConfidence: '中', updatedAt: '2026-07-10', nonSpaceCoreBusinesses: ['高可靠连接器', '轨道交通与工业连接器'], businessSummary: '以高可靠连接器、继电器及线缆组件切入航天电子产业链，客户覆盖多类高端装备场景。',
    businesses: [{ id: 'hd-1', primarySector: '航天电子元器件', secondarySector: '连接器与线缆', role: '核心业务', revenueShare: '约 85%', companyRevenueShare: '约 15%–25%', status: '持续经营', confidence: '中', dataState: '公开资料推算', chainValue: '系统价值量 1%–4%', chainImportance: 5, companyImportance: 5, source: '年报、招股书与产品资料', sourceDate: '2025-12-31' }, { id: 'hd-2', primarySector: '航天电子元器件', secondarySector: '射频器件', role: '相关业务', revenueShare: '约 15%', companyRevenueShare: '待确认', status: '持续经营', confidence: '低', dataState: '待确认', chainValue: '待确认', chainImportance: 3, companyImportance: 2, source: '公开资料', sourceDate: '2026-07-10' }], evidences: [], revisions: [],
  },
  '600879': {
    commercialRevenueShare: '约 45%–60%', commercialRevenueState: '研究估计', commercialRevenueConfidence: '中', updatedAt: '2026-07-10', nonSpaceCoreBusinesses: ['军用电子', '无人系统'], businessSummary: '航天电子系统、测控通信及电子元器件是商业航天相关收入的主要来源。',
    businesses: [{ id: 'he-1', primarySector: '卫星通信', secondarySector: '卫星通信设备', role: '核心业务', revenueShare: '约 45%', companyRevenueShare: '约 22%–30%', status: '持续经营', confidence: '中', dataState: '研究估计', chainValue: '系统价值量 8%–15%', chainImportance: 5, companyImportance: 5, source: '年报及业务资料', sourceDate: '2025-12-31' }, { id: 'he-2', primarySector: '导航、测控与地面系统', secondarySector: '测控设备', role: '重要业务', revenueShare: '约 35%', companyRevenueShare: '约 16%–21%', status: '持续经营', confidence: '中', dataState: '公开资料推算', chainValue: '系统价值量 5%–10%', chainImportance: 5, companyImportance: 4, source: '公司公告与产品资料', sourceDate: '2026-06-30' }, { id: 'he-3', primarySector: '航天电子元器件', secondarySector: '传感器和控制器件', role: '相关业务', revenueShare: '约 20%', companyRevenueShare: '约 7%–12%', status: '持续经营', confidence: '低', dataState: '待确认', chainValue: '待确认', chainImportance: 4, companyImportance: 3, source: '研究整理', sourceDate: '2026-07-10' }], evidences: [], revisions: [],
  },
  '300053': {
    commercialRevenueShare: '约 70%–85%', commercialRevenueState: '公开资料推算', commercialRevenueConfidence: '中', updatedAt: '2026-07-10', nonSpaceCoreBusinesses: ['人工智能芯片', '宇航电子'], businessSummary: '卫星运营与宇航电子是主要的商业航天暴露方向，数据服务业务仍在扩展。',
    businesses: [{ id: 'hy-1', primarySector: '航天运营与配套服务', secondarySector: '卫星运营', role: '核心业务', revenueShare: '约 55%', companyRevenueShare: '约 42%', status: '持续经营', confidence: '中', dataState: '公开资料推算', chainValue: '运营价值量 15%–30%', chainImportance: 4, companyImportance: 5, source: '年报与公司官网', sourceDate: '2025-12-31' }, { id: 'hy-2', primarySector: '航天应用与数据服务', secondarySector: '遥感应用', role: '重要业务', revenueShare: '约 45%', companyRevenueShare: '约 34%', status: '持续经营', confidence: '中', dataState: '研究估计', chainValue: '服务价值量 20%–35%', chainImportance: 4, companyImportance: 4, source: '公开资料与项目清单', sourceDate: '2026-07-10' }], evidences: [], revisions: [],
  },
  '002446': {
    commercialRevenueShare: '待确认', commercialRevenueState: '待确认', commercialRevenueConfidence: '低', updatedAt: '2026-07-10', nonSpaceCoreBusinesses: ['专网通信', '汽车电子'], businessSummary: '卫星通信天线及终端存在产品关联，当前缺乏可验证的收入拆分。',
    businesses: [{ id: 'sl-1', primarySector: '卫星通信', secondarySector: '卫星通信终端', role: '相关业务', revenueShare: '无法确认', companyRevenueShare: '待确认', status: '产品布局', confidence: '低', dataState: '待确认', chainValue: '系统价值量 3%–8%', chainImportance: 3, companyImportance: 2, source: '公司产品资料', sourceDate: '2026-07-10' }], evidences: [], revisions: [],
  },
}

export const overviewData: OverviewData = {
  asOf: '2026-07-10 18:42',
  coverage: '42 家航天相关 A 股',
  companies: [
    { code: '688066', name: '航天宏图', level: '核心相关', industry: '计算机应用', concept: '商业航天', price: '24.86', change: 6.28, marketCap: '65.4 亿', signal: '放量上行', signalTone: 'positive', tags: ['卫星应用', '遥感'], spark: [18, 22, 19, 26, 31, 28, 36, 42], spaceProfile: demoProfiles['688066'] },
    { code: '300342', name: '天银机电', level: '强相关', industry: '航天装备', concept: '卫星互联网', price: '18.37', change: 4.55, marketCap: '78.8 亿', signal: '相对强势', signalTone: 'positive', tags: ['星敏感器', '军工'], spark: [24, 21, 27, 25, 32, 35, 33, 39], spaceProfile: demoProfiles['300342'] },
    { code: '002025', name: '航天电器', level: '核心相关', industry: '航天装备', concept: '商业航天', price: '54.12', change: -1.42, marketCap: '247.1 亿', signal: '高位整理', signalTone: 'neutral', tags: ['连接器', '军工电子'], spark: [38, 42, 40, 45, 43, 41, 44, 42], spaceProfile: demoProfiles['002025'] },
    { code: '600879', name: '航天电子', level: '核心相关', industry: '航天装备', concept: '卫星互联网', price: '11.64', change: 2.11, marketCap: '316.5 亿', signal: '资金回流', signalTone: 'positive', tags: ['卫星通信', '军工'], spark: [20, 25, 24, 28, 30, 29, 34, 36], spaceProfile: demoProfiles['600879'] },
    { code: '300053', name: '航宇微', level: '强相关', industry: '国防军工', concept: '卫星导航', price: '12.08', change: -3.08, marketCap: '84.3 亿', signal: '减持中', signalTone: 'negative', tags: ['卫星运营', '遥感'], spark: [45, 42, 40, 38, 41, 35, 32, 30], spaceProfile: demoProfiles['300053'] },
    { code: '002446', name: '盛路通信', level: '部分相关', industry: '通信设备', concept: '卫星通信', price: '8.91', change: 1.25, marketCap: '81.2 亿', signal: '窄幅震荡', signalTone: 'neutral', tags: ['天线', '通信'], spark: [31, 33, 32, 35, 34, 36, 35, 37], spaceProfile: demoProfiles['002446'] },
  ],
  events: [
    { id: 'evt-01', time: '17:36', company: '航天宏图', code: '688066', type: '订单', title: '签署卫星遥感数据服务项目合同', detail: '合同金额占上一年度营业收入约 8.6%，项目周期 24 个月。', level: '中', sourceUrl: 'http://www.cninfo.com.cn/new/disclosure/detail?stockCode=688066' },
    { id: 'evt-02', time: '16:52', company: '航宇微', code: '300053', type: '减持', title: '控股股东减持计划进展至 63%', detail: '计划期限尚余 11 个交易日，当前状态：减持中。', level: '高', status: '减持中', sourceUrl: 'http://www.cninfo.com.cn/new/disclosure/detail?stockCode=300053' },
    { id: 'evt-03', time: '16:18', company: '航天电器', code: '002025', type: '投资', title: '拟投资建设高可靠连接器产线', detail: '预计总投资 3.2 亿元，资金来源为自有资金。', level: '低', sourceUrl: 'http://www.cninfo.com.cn/new/disclosure/detail?stockCode=002025' },
    { id: 'evt-04', time: '15:44', company: '天银机电', code: '300342', type: '业绩', title: '半年度业绩预告：净利润同比增长', detail: '预计归母净利润 1.2 至 1.5 亿元，同比增长 32% 至 64%。', level: '中', sourceUrl: 'http://www.cninfo.com.cn/new/disclosure/detail?stockCode=300342' },
  ],
  boards: [
    { name: '遥感应用', change: 4.12, breadth: '6 / 1', leader: '航天宏图', boardType: '二级板块', fallingCount: 1, flatCount: 0, weightedChange: 3.88, exposure: '高暴露 4 家', contributor: '航天宏图', concentration: '集中' },
    { name: '卫星通信设备', change: 2.76, breadth: '8 / 3', leader: '航天电子', boardType: '二级板块', fallingCount: 3, flatCount: 1, weightedChange: 2.34, exposure: '高暴露 5 家', contributor: '航天电子', concentration: '均衡' },
    { name: '连接器与线缆', change: 0.62, breadth: '5 / 4', leader: '航天电器', boardType: '二级板块', fallingCount: 4, flatCount: 0, weightedChange: 0.28, exposure: '高暴露 3 家', contributor: '航天电器', concentration: '集中' },
    { name: '北斗导航', change: -0.41, breadth: '4 / 7', leader: '华力创通', boardType: '二级板块', fallingCount: 7, flatCount: 1, weightedChange: -0.73, exposure: '待确认 6 家', contributor: '华力创通', concentration: '待确认' },
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
