import { useEffect, useState } from "react";
import "./rocket-infographic.css";

const costs = [
  { name: "推进系统", share: 60, color: "orange" },
  { name: "结构系统", share: 20, color: "blue" },
  { name: "电子电气", share: 10, color: "lime" },
  { name: "控制系统", share: 5, color: "violet" },
  { name: "其他测试", share: 5, color: "gray" },
];

const components = [
  { code: "01", title: "整流罩", sub: "保护载荷，穿越稠密大气层", cost: "2-3%", art: "fairing", companies: ["航天科技", "中材科技"] },
  { code: "02", title: "载荷舱", sub: "卫星 / 货物的工作空间", cost: "1-2%", art: "payload", companies: ["航天五院", "上海航天"] },
  { code: "03", title: "二级发动机", sub: "在高空完成精确入轨", cost: "18-20%", art: "upper-engine", companies: ["航天科技一院", "蓝箭航天"] },
  { code: "04", title: "推进剂储箱", sub: "燃料与氧化剂贮存", cost: "10-12%", art: "tank", companies: ["航天科技四院", "中航新材"] },
  { code: "05", title: "级间段", sub: "连接上下级的承力结构", cost: "2-3%", art: "interstage", companies: ["航天科技一院", "航天智造"] },
  { code: "06", title: "一级发动机", sub: "起飞阶段的主要推力", cost: "30-35%", art: "booster-engine", companies: ["航天科技六院", "蓝箭航天"] },
  { code: "07", title: "结构件", sub: "舱体、支架与连接件", cost: "15-18%", art: "structure", companies: ["中航重机", "三角防务"] },
  { code: "08", title: "电子电气系统", sub: "配电、线缆与测量模块", cost: "3-5%", art: "circuit", companies: ["航天科技九院", "中航光电"] },
  { code: "09", title: "航电与控制", sub: "计算、导航与姿态控制", cost: "2-4%", art: "avionics", companies: ["航天科工二院", "中国长城"] },
];

const companyProfiles = {
  "航天科技": { ticker: "600879.SH", role: "运载火箭总体与系统集成", mix: [["运载火箭", 52], ["卫星应用", 28], ["电子装备", 20]] },
  "中材科技": { ticker: "002080.SZ", role: "复合材料与高压容器", mix: [["复材结构", 61], ["储氢容器", 24], ["其他材料", 15]] },
  "航天五院": { ticker: "机构示例", role: "卫星与空间飞行器总体", mix: [["卫星研制", 68], ["空间载荷", 20], ["地面系统", 12]] },
  "上海航天": { ticker: "机构示例", role: "运载与卫星系统研制", mix: [["运载产品", 45], ["卫星制造", 35], ["测试服务", 20]] },
  "航天科技一院": { ticker: "机构示例", role: "运载火箭总体设计", mix: [["火箭总体", 56], ["结构系统", 29], ["试验服务", 15]] },
  "蓝箭航天": { ticker: "民营商业航天", role: "液体火箭与发动机", mix: [["液体发动机", 48], ["火箭总体", 39], ["发射服务", 13]] },
  "航天科技四院": { ticker: "机构示例", role: "固体动力与复合材料", mix: [["固体动力", 58], ["复合材料", 26], ["测试设备", 16]] },
  "中航新材": { ticker: "产业链示例", role: "航空航天先进材料", mix: [["金属材料", 47], ["复合材料", 37], ["工艺服务", 16]] },
  "航天智造": { ticker: "300446.SZ", role: "航天制造与智能装备", mix: [["制造装备", 51], ["零部件", 32], ["技术服务", 17]] },
  "航天科技六院": { ticker: "机构示例", role: "液体火箭发动机研制", mix: [["液体发动机", 73], ["涡轮系统", 17], ["试验保障", 10]] },
  "中航重机": { ticker: "600765.SH", role: "航空锻铸与结构件", mix: [["航空锻件", 57], ["能源装备", 24], ["其他锻件", 19]] },
  "三角防务": { ticker: "300775.SZ", role: "大型模锻件与机体结构", mix: [["航空锻件", 69], ["航天锻件", 19], ["其他", 12]] },
  "航天科技九院": { ticker: "机构示例", role: "航天电子与测控系统", mix: [["航天电子", 53], ["测控系统", 29], ["元器件", 18]] },
  "中航光电": { ticker: "002179.SZ", role: "高可靠连接器与互连系统", mix: [["防务互连", 54], ["工业互连", 30], ["新能源汽车", 16]] },
  "航天科工二院": { ticker: "机构示例", role: "制导控制与电子系统", mix: [["制导控制", 49], ["雷达电子", 34], ["信息系统", 17]] },
  "中国长城": { ticker: "000066.SZ", role: "计算平台与自主安全系统", mix: [["计算终端", 44], ["系统集成", 36], ["数据安全", 20]] },
};

const stageNotes = [
  ["01", "整流罩", "减小空气阻力，保护卫星"],
  ["02", "载荷舱", "搭载卫星或实验载荷"],
  ["03", "二级", "在高空点火，完成入轨"],
  ["04", "级间段", "连接上下级，传递载荷"],
  ["05", "一级", "提供起飞阶段主要动力"],
  ["06", "发动机", "火箭最核心的动力单元"],
];

function ComponentArt({ type }) {
  return <div className={`component-art ${type}`} aria-hidden="true"><i /><b /><em /></div>;
}

function RocketModel() {
  return (
    <div className="rocket-wrap" aria-label="火箭结构示意图">
      <div className="rocket-shadow" />
      <div className="rocket flame"><i /><i /><i /></div>
      <div className="rocket booster booster-left"><span /><b /></div>
      <div className="rocket booster booster-right"><span /><b /></div>
      <div className="rocket core">
        <div className="rocket-nose"><i /></div>
        <div className="rocket-band flag"><span /></div>
        <div className="rocket-upper"><strong>天<br />舟</strong></div>
        <div className="rocket-ring" />
        <div className="rocket-payload"><i /><i /><i /></div>
        <div className="rocket-divider" />
        <div className="rocket-middle"><span /><span /><span /></div>
        <div className="rocket-tank"><i /></div>
        <div className="rocket-lower"><i /><i /><i /><i /></div>
        <div className="rocket-engine"><b /><b /><b /></div>
      </div>
      <div className="rocket-fins"><i /><i /></div>
    </div>
  );
}

function Donut() {
  return (
    <div className="cost-donut" aria-label="整箭成本占比图">
      <div><strong>整箭成本</strong><span>占比（约）</span></div>
    </div>
  );
}

function CompanyProfile({ company, index, activeCompany, setActiveCompany, pinnedCompany, setPinnedCompany }) {
  const profile = companyProfiles[company];
  const isPinned = pinnedCompany === company;
  const isOpen = activeCompany === company || isPinned;

  return (
    <div className={`company-item${isOpen ? " profile-open" : ""}`} onMouseEnter={() => !pinnedCompany && setActiveCompany(company)} onMouseLeave={() => setActiveCompany(null)}>
      <button type="button" className="company-button" aria-expanded={isOpen} onClick={() => setPinnedCompany(isPinned ? null : company)}>
        <i>{index === 0 ? "A" : "B"}</i><span>{company}</span>
      </button>
      {isOpen && profile && (
        <section className="company-popover" role="dialog" aria-label={`${company}业务信息`}>
          <header><span>COMPANY PROFILE</span><b>{profile.ticker}</b></header>
          <h4>{company}</h4>
          <p>{profile.role}</p>
          <div className="business-mix">
            {profile.mix.map(([name, share]) => <div key={name}><span>{name}</span><b><i style={{ width: `${share}%` }} /></b><em>{share}%</em></div>)}
          </div>
          <small>业务占比为页面示意，待接入财报与公告数据。</small>
        </section>
      )}
    </div>
  );
}

export default function RocketInfographic({ embedded = false }) {
  const [activeCompany, setActiveCompany] = useState(null);
  const [pinnedCompany, setPinnedCompany] = useState(null);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setActiveCompany(null);
        setPinnedCompany(null);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <main className={`rocket-page${embedded ? " rocket-embedded" : ""}`}>
      <div className="space-grid" />
      <header className="rocket-header">
        <div className="rocket-title-row">
          <div><div className="mission-tag"><span />航天产业链图解</div><h1>一图看懂火箭</h1><p>拆解核心部件、成本占比与产业协作关系</p><div className="header-rule" /><small>以中大型运载火箭的典型构型为示意</small></div>
          <nav className="aerospace-tabs" aria-label="航天图谱分类"><button className="active">火箭</button><button disabled>卫星</button><button disabled>卫星通信</button><button disabled>太空光伏</button></nav>
        </div>
      </header>

      <section className="rocket-layout">
        <aside className="rocket-sidebar">
          <section className="info-panel cost-panel">
            <div className="panel-kicker">COST BREAKDOWN</div>
            <h2>整箭成本结构</h2>
            <p className="panel-lead">不同型号与复用程度会改变成本构成，以下为典型参考。</p>
            <div className="cost-list">
              {costs.map((item) => <div className="cost-row" key={item.name}><span className={`swatch ${item.color}`} /><b>{item.name}</b><strong>{item.share}%</strong></div>)}
            </div>
            <div className="split-line" />
            <p className="cost-note">推进系统通常占比最高；结构、电子和控制系统共同决定可靠性与任务能力。</p>
          </section>

          <section className="donut-panel">
            <Donut />
            <div className="donut-legend"><span className="orange">推进 60%</span><span className="blue">结构 20%</span><span className="lime">电子 10%</span></div>
          </section>

          <section className="info-panel stages-panel">
            <div className="panel-kicker">FLIGHT STACK</div>
            <h2>火箭主要分段</h2>
            <ol>
              {stageNotes.map(([code, title, text]) => <li key={code}><span>{code}</span><div><b>{title}</b><small>{text}</small></div></li>)}
            </ol>
          </section>
        </aside>

        <section className="rocket-center">
          <div className="center-caption">LAUNCH VEHICLE / STRUCTURE OVERVIEW</div>
          <RocketModel />
          <div className="rocket-callouts">
            <span className="callout callout-a">01&nbsp; 整流罩</span><span className="callout callout-b">02&nbsp; 载荷舱</span><span className="callout callout-c">03&nbsp; 二级</span><span className="callout callout-d">04&nbsp; 一级</span><span className="callout callout-e">05&nbsp; 发动机</span>
          </div>
        </section>

        <section className="component-column">
          <div className="component-heading"><span>核心零部件（示例）</span><b>成本占比（约）</b><span>相关公司（示例）</span></div>
          <div className="component-list">
            {components.map((item) => (
              <article className="component-card" key={item.code}>
                <div className="component-title"><span>{item.code}</span><div><h3>{item.title}</h3><p>{item.sub}</p></div></div>
                <ComponentArt type={item.art} />
                <strong className="component-cost">{item.cost}</strong>
                <div className="company-list">{item.companies.map((company, index) => <CompanyProfile key={company} company={company} index={index} activeCompany={activeCompany} setActiveCompany={setActiveCompany} pinnedCompany={pinnedCompany} setPinnedCompany={setPinnedCompany} />)}</div>
              </article>
            ))}
          </div>
        </section>
      </section>

      <footer className="rocket-footer"><span>注：成本占比为行业典型范围，随火箭型号、复用次数及制造工艺变化。</span><span>数据口径：公开资料整理 · 概念设计稿</span></footer>
    </main>
  );
}
