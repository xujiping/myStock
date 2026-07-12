import { useEffect, useMemo, useState } from "react";
import "./rocket-infographic.css";

const CATEGORIES = [
  { key: "rocket", label: "火箭" },
  { key: "satellite", label: "卫星" },
  { key: "satcom", label: "卫星通信" },
  { key: "solar", label: "太空光伏" },
];

// 默认配色，按出现顺序循环分配；优先沿用资料中的 color 字段
const COST_COLORS = ["orange", "blue", "lime", "violet", "gray"];

// 数据库无成本数据时的典型参考值，保证产业链图始终完整可读
const DEFAULT_COSTS = [
  { name: "推进系统", share: 60, color: "orange" },
  { name: "结构系统", share: 20, color: "blue" },
  { name: "电子电气", share: 10, color: "lime" },
  { name: "控制系统", share: 5, color: "violet" },
  { name: "其他测试", share: 5, color: "gray" },
];

// 火箭固定骨架：9 个核心零部件的结构信息始终展示，
// 公司关联是从资料抽取后按零部件名称叠加的业务数据。
const ROCKET_COMPONENTS = [
  { code: "01", name: "整流罩", sub: "保护载荷，穿越稠密大气层", cost: "2-3%", art: "fairing" },
  { code: "02", name: "载荷舱", sub: "卫星 / 货物的工作空间", cost: "1-2%", art: "payload" },
  { code: "03", name: "二级发动机", sub: "在高空完成精确入轨", cost: "18-20%", art: "upper-engine" },
  { code: "04", name: "推进剂储箱", sub: "燃料与氧化剂贮存", cost: "10-12%", art: "tank" },
  { code: "05", name: "级间段", sub: "连接上下级的承力结构", cost: "2-3%", art: "interstage" },
  { code: "06", name: "一级发动机", sub: "起飞阶段的主要推力", cost: "30-35%", art: "booster-engine" },
  { code: "07", name: "结构件", sub: "舱体、支架与连接件", cost: "15-18%", art: "structure" },
  { code: "08", name: "电子电气系统", sub: "配电、线缆与测量模块", cost: "3-5%", art: "circuit" },
  { code: "09", name: "航电与控制", sub: "计算、导航与姿态控制", cost: "2-4%", art: "avionics" },
];

const stageNotes = [
  ["01", "整流罩", "减小空气阻力，保护卫星"],
  ["02", "载荷舱", "搭载卫星或实验载荷"],
  ["03", "二级", "在高空点火，完成入轨"],
  ["04", "级间段", "连接上下级，传递载荷"],
  ["05", "一级", "提供起飞阶段主要动力"],
  ["06", "发动机", "火箭最核心的动力单元"],
];

function ComponentArt({ type }) {
  return <div className={`component-art ${type || "structure"}`} aria-hidden="true"><i /><b /><em /></div>;
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

function Donut({ costs }) {
  const main = costs.slice(0, 3);
  return (
    <div className="cost-donut" aria-label="整箭成本占比图">
      <div><strong>整箭成本</strong><span>占比（约）</span></div>
      {main.length > 0 && (
        <div className="donut-slices">
          {main.map((cost) => <span key={cost.id} className={cost.color}>{cost.name} {cost.share}%</span>)}
        </div>
      )}
    </div>
  );
}

function CompanyProfile({ company, index, activeCompany, setActiveCompany, pinnedCompany, setPinnedCompany }) {
  const name = company.name;
  const ticker = company.ticker || "—";
  const role = company.role || "暂无业务定位";
  const mix = Array.isArray(company.business_mix) ? company.business_mix : [];
  const isPinned = pinnedCompany === company.id;
  const isOpen = activeCompany === company.id || isPinned;

  return (
    <div className={`company-item${isOpen ? " profile-open" : ""}`} onMouseEnter={() => !pinnedCompany && setActiveCompany(company.id)} onMouseLeave={() => setActiveCompany(null)}>
      <button type="button" className="company-button" aria-expanded={isOpen} onClick={() => setPinnedCompany(isPinned ? null : company.id)}>
        <i>{index === 0 ? "A" : "B"}</i><span>{name}</span>
      </button>
      {isOpen && (
        <section className="company-popover" role="dialog" aria-label={`${name}业务信息`}>
          <header><span>COMPANY PROFILE</span><b>{ticker}</b></header>
          <h4>{name}</h4>
          <p>{role}</p>
          <div className="business-mix">
            {mix.map(([label, share]) => <div key={label}><span>{label}</span><b><i style={{ width: `${share}%` }} /></b><em>{share}%</em></div>)}
          </div>
          {mix.length === 0 && <small>暂无业务占比数据。</small>}
        </section>
      )}
    </div>
  );
}

export default function RocketInfographic({ embedded = false, category = "rocket", onCategoryChange, graph, loading, onUpload }) {
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

  const companiesById = useMemo(() => {
    const map = new Map();
    (graph?.companies || []).forEach((company) => map.set(company.id, company));
    return map;
  }, [graph]);

  const costs = useMemo(() => {
    const raw = graph?.cost_breakdown || [];
    const mapped = raw.map((cost, index) => ({
      ...cost,
      color: cost.color || COST_COLORS[index % COST_COLORS.length],
    }));
    // 数据库无成本数据时，回落到典型参考值，保证产业链图始终完整
    return mapped.length ? mapped : DEFAULT_COSTS;
  }, [graph]);

  const components = useMemo(() => {
    const dbByName = new Map();
    (graph?.components || []).forEach((component) => dbByName.set(component.name, component));
    // 1. 固定骨架为基准，叠加数据库匹配到的描述/成本/公司关联
    const skeletonNames = new Set(ROCKET_COMPONENTS.map((item) => item.name));
    const merged = ROCKET_COMPONENTS.map((skeleton) => {
      const matched = dbByName.get(skeleton.name);
      const companyIds = matched?.company_ids || [];
      return {
        id: matched?.id || skeleton.name,
        code: skeleton.code,
        name: skeleton.name,
        description: matched?.description || skeleton.sub,
        cost_share: matched?.cost_share || skeleton.cost,
        art: matched?.art || skeleton.art,
        companies: companyIds.map((id) => companiesById.get(id)).filter(Boolean),
        extra: false,
      };
    });
    // 2. 资料中抽取到、但不在固定骨架里的额外部件（如 TR 星载芯片），追加到列表末尾
    (graph?.components || []).forEach((component, index) => {
      if (skeletonNames.has(component.name)) return;
      merged.push({
        id: component.id,
        code: component.code || String(ROCKET_COMPONENTS.length + index + 1).padStart(2, "0"),
        name: component.name,
        description: component.description || "",
        cost_share: component.cost_share || "—",
        art: component.art || "",
        companies: (component.company_ids || []).map((id) => companiesById.get(id)).filter(Boolean),
        extra: true,
      });
    });
    return merged;
  }, [graph, companiesById]);

  const stages = useMemo(() => {
    const dbStages = graph?.stages || [];
    if (dbStages.length) return dbStages.map((stage) => [stage.code, stage.name, stage.description || ""]);
    return stageNotes;
  }, [graph]);

  return (
    <main className={`rocket-page${embedded ? " rocket-embedded" : ""}`}>
      <div className="space-grid" />
      <header className="rocket-header">
        <div className="rocket-title-row">
          <div><div className="mission-tag"><span />航天产业链图解</div><h1>一图看懂火箭</h1><p>拆解核心部件、成本占比与产业协作关系</p><div className="header-rule" /><small>基于上传资料由 AI 抽取并合并</small></div>
          <nav className="aerospace-tabs" aria-label="航天图谱分类">
            {CATEGORIES.map((tab) => (
              <button key={tab.key} className={category === tab.key ? "active" : ""} disabled={!onCategoryChange && tab.key !== category} onClick={() => onCategoryChange?.(tab.key)}>{tab.label}</button>
            ))}
          </nav>
        </div>
      </header>

      <section className="rocket-layout">
        <aside className="rocket-sidebar">
          <section className="info-panel cost-panel">
            <div className="panel-kicker">COST BREAKDOWN</div>
            <h2>整箭成本结构</h2>
            <p className="panel-lead">不同型号与复用程度会改变成本构成，以下为典型参考。</p>
            <div className="cost-list">
              {costs.map((item) => <div className="cost-row" key={item.id || item.name}><span className={`swatch ${item.color}`} /><b>{item.name}</b><strong>{item.share == null ? "—" : `${item.share}%`}</strong></div>)}
            </div>
            <div className="split-line" />
            <p className="cost-note">推进系统通常占比最高；结构、电子和控制系统共同决定可靠性与任务能力。</p>
          </section>

          <section className="donut-panel">
            <Donut costs={costs} />
            <div className="donut-legend">
              {costs.slice(0, 3).map((cost) => <span key={cost.id || cost.name} className={cost.color}>{cost.name} {cost.share == null ? "—" : `${cost.share}%`}</span>)}
            </div>
          </section>

          <section className="info-panel stages-panel">
            <div className="panel-kicker">FLIGHT STACK</div>
            <h2>火箭主要分段</h2>
            <ol>
              {stages.map((entry) => {
                const [code, title, text] = Array.isArray(entry) ? entry : [entry.code, entry.name, entry.description];
                return <li key={code}><span>{code}</span><div><b>{title}</b><small>{text}</small></div></li>;
              })}
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
          <div className="component-heading"><span>核心零部件</span><b>成本占比</b><span>相关公司</span></div>
          <div className="component-list">
            {components.map((item) => (
              <article className={`component-card${item.extra ? " component-extra" : ""}`} key={item.id}>
                <div className="component-title"><span>{item.code}</span><div><h3>{item.name}</h3>{item.extra && <em className="extra-tag">补充</em>}<p>{item.description || ""}</p></div></div>
                <ComponentArt type={item.art} />
                <strong className="component-cost">{item.cost_share || "—"}</strong>
                <div className="company-list">
                  {(item.companies || []).map((company, index) => (
                    <CompanyProfile key={company.id} company={company} index={index} activeCompany={activeCompany} setActiveCompany={setActiveCompany} pinnedCompany={pinnedCompany} setPinnedCompany={setPinnedCompany} />
                  ))}
                  {(!item.companies || item.companies.length === 0) && <small className="company-empty">暂无关联公司</small>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>

      <footer className="rocket-footer"><span>注：成本占比为行业典型范围，随火箭型号、复用次数及制造工艺变化；公司数据来自上传资料的 AI 抽取与合并，可手动修正后免于覆盖。</span></footer>
    </main>
  );
}
