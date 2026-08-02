
/* ================= 渲染与交互 ================= */
const REL = {
  leader:  { label:'板块龙头',   dash:null,  w:2.6 },
  concept: { label:'概念龙头',   dash:'9 6', w:2.0 },
  mapping: { label:'买入逻辑归属', dash:'2 6', w:1.8 },
};
const relDashCls = t => t==='concept'?'dash':(t==='mapping')?'dot':'';
const relThin = t => t!=='leader';

const W=1200, H=1000, CX=600, CY=500, R=430, R_IN=330;
let groups = [], companies = [], relations = [];
const gMap = {}, cMap = {};
const relsOf = {};            // companyId -> [rel]
const relsOfGroup = {};       // groupId -> [rel]
function applyData(data){
  groups = data.groups || []; companies = data.companies || []; relations = data.relations || [];
  Object.keys(gMap).forEach(k=>delete gMap[k]);
  Object.keys(cMap).forEach(k=>delete cMap[k]);
  groups.forEach(g => gMap[g.id]=g);
  companies.forEach(c => cMap[c.id]=c);
  recomputeData();
  computeLayout();
}
const state = { hover:null, selected:null, search:'', crossOnly:false, suppressClick:false,
  removedCompanies:new Set(), removedRels:new Set(), relFilter:new Set() };
function relKey(r){ return r.companyId+'|'+r.groupId; }
function activeRelations(){
  return relations.filter(r=>!state.removedRels.has(relKey(r)) && !state.removedCompanies.has(r.companyId));
}
function activeCompanies(){ return companies.filter(c=>!state.removedCompanies.has(c.id)); }
function recomputeData(){
  Object.keys(relsOf).forEach(k=>delete relsOf[k]);
  Object.keys(relsOfGroup).forEach(k=>delete relsOfGroup[k]);
  activeRelations().forEach(r=>{
    (relsOf[r.companyId]=relsOf[r.companyId]||[]).push(r);
    (relsOfGroup[r.groupId]=relsOfGroup[r.groupId]||[]).push(r);
  });
}

/* ---------- 视图状态：缩放 / 平移 ---------- */
const svgEl=document.getElementById('svg');
const view={ k:1, tx:0, ty:0 };
const VIEW_MIN=0.3, VIEW_MAX=5;
function svgPoint(e){
  const pt=svgEl.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY;
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}
function applyViewport(){
  const vp=document.getElementById('viewport');
  if(vp) vp.setAttribute('transform','translate('+view.tx.toFixed(2)+' '+view.ty.toFixed(2)+') scale('+view.k+')');
  const pct=document.getElementById('zoomPct');
  if(pct) pct.textContent=Math.round(view.k*100)+'%';
}
function zoomAt(sx,sy,f){
  const nk=Math.min(VIEW_MAX,Math.max(VIEW_MIN,view.k*f));
  const r=nk/view.k;
  view.tx=sx-(sx-view.tx)*r; view.ty=sy-(sy-view.ty)*r; view.k=nk;
  applyViewport();
}
function resetView(){ view.k=1; view.tx=0; view.ty=0; applyViewport(); }

/* ---------- 布局：分组固定圆周，公司力导向聚簇 ---------- */
const gPos = {};
const cPos = {};
function computeLayout(){
groups.forEach((g,i) => {
  const a = -Math.PI/2 + (i + 0.5) * (2*Math.PI/groups.length);
  gPos[g.id] = { x: CX + R*Math.cos(a), y: CY + R*Math.sin(a), a };
});
const rng = (()=>{ let t=20260802; return ()=>((t=((t*1664525+1013904223)>>>0))/4294967296); })();
companies.forEach(c => {
  const rels = relsOf[c.id] || [];
  const k = rels.length;
  let sx=0, sy=0;
  rels.forEach(r => { sx += Math.cos(gPos[r.groupId].a); sy += Math.sin(gPos[r.groupId].a); });
  const a = Math.atan2(sy, sx) + (rng()-.5)*0.35;
  const r = 150 + (k===1?28:(k===2?8:-18)) + rng()*26;
  cPos[c.id] = { x: CX + r*Math.cos(a), y: CY + r*Math.sin(a), vx:0, vy:0 };
});
(function relax(){
  const cs = companies.map(c => c.id);
  for(let it=0; it<520; it++){
    // 弹簧：公司 → 所属分组
    for(const cid of cs){
      const p = cPos[cid], rels = relsOf[cid]||[];
      for(const r of rels){
        const g = gPos[r.groupId];
        const dx=g.x-p.x, dy=g.y-p.y, d=Math.hypot(dx,dy)||1;
        const f=(d-248)*0.016;
        p.vx += dx/d*f; p.vy += dy/d*f;
      }
    }
    // 斥力：公司之间
    for(let i=0;i<cs.length;i++){
      const a=cPos[cs[i]];
      for(let j=i+1;j<cs.length;j++){
        const b=cPos[cs[j]];
        const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1;
        if(d<92){
          const f=(92-d)/92*1.35;
          const ux=dx/d, uy=dy/d;
          a.vx-=ux*f; a.vy-=uy*f;
          b.vx+=ux*f; b.vy+=uy*f;
        }
      }
    }
    // 斥力：公司 → 非所属分组节点
    for(const cid of cs){
      const p=cPos[cid], mine=new Set((relsOf[cid]||[]).map(r=>r.groupId));
      for(const g of groups){
        if(mine.has(g.id)) continue;
        const q=gPos[g.id], dx=q.x-p.x, dy=q.y-p.y, d=Math.hypot(dx,dy)||1;
        if(d<175){ const f=(175-d)/175*1.15; p.vx-=dx/d*f; p.vy-=dy/d*f; }
      }
    }
    // 向心约束
    for(const cid of cs){
      const p=cPos[cid];
      const dx=p.x-CX, dy=p.y-CY, d=Math.hypot(dx,dy)||1;
      if(d>R_IN){ const f=(d-R_IN)*0.02; p.vx-=dx/d*f; p.vy-=dy/d*f; }
      p.x+=p.vx; p.y+=p.vy; p.vx*=0.82; p.vy*=0.82;
    }
  }
})();
}

/* ---------- 关系线路径（二次贝塞尔） ---------- */
function linePath(cid, gid){
  const p=cPos[cid], g=gPos[gid];
  const mx=(p.x+g.x)/2, my=(p.y+g.y)/2;
  let dx=g.x-p.x, dy=g.y-p.y;
  const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
  const bend=46+Math.min(70,d*0.10);
  const cx2=mx-dy*bend, cy2=my+dx*bend;
  return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} Q ${cx2.toFixed(1)} ${cy2.toFixed(1)} ${g.x.toFixed(1)} ${g.y.toFixed(1)}`;
}

/* ---------- SVG 渲染 ---------- */
function renderSVG(){
  const svg=document.getElementById('svg');
  let html='<g id="viewport"><defs>';
  groups.forEach(g=>{
    html+=`<linearGradient id="gg-${g.id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${g.color}44"/><stop offset="1" stop-color="${g.color}14"/></linearGradient>`;
  });
  html+='</defs>';
  // 参考圆环
  html+=`<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#2b3d5e" stroke-width="1" opacity=".5"/>`;
  html+=`<circle cx="${CX}" cy="${CY}" r="${R_IN}" fill="none" stroke="#2b3d5e" stroke-width="1" stroke-dasharray="3 7" opacity=".4"/>`;
  // 连线
  activeRelations().forEach(r=>{
    const g=gMap[r.groupId];
    const dim = REL[r.type].dim;
    html+=`<path class="gline" data-cid="${r.companyId}" data-gid="${r.groupId}" data-type="${r.type}"
      d="${linePath(r.companyId,r.groupId)}" fill="none" stroke="${g.color}"
      stroke-width="${REL[r.type].w}" stroke-dasharray="${REL[r.type].dash||''}"
      stroke-linecap="round" opacity="${dim?0.28:0.55}"/>`;
  });
  // 分组节点
  groups.forEach(g=>{
    const p=gPos[g.id], n=(relsOfGroup[g.id]||[]).length;
    const w=156,h=52, x=p.x-w/2, y=p.y-h/2;
    html+=`<g class="gnode g-group" data-gid="${g.id}" transform="translate(${p.x} ${p.y})">
      <rect class="gn-body" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="16" fill="url(#gg-${g.id})"
        stroke="${g.color}" stroke-width="2" style="filter:drop-shadow(0 0 16px ${g.color}33)"/>
      <text class="gname" x="0" y="-6" text-anchor="middle" fill="${g.color}">${g.name}</text>
      <text class="gcode" x="0" y="12" text-anchor="middle">${n} 家 · <tspan class="g-avg flat">均幅 —</tspan></text>
    </g>`;
  });
  // 公司节点
  activeCompanies().forEach(c=>{
    const p=cPos[c.id], rels=relsOf[c.id]||[], k=rels.length;
    const colors=[...new Set(rels.map(r=>gMap[r.groupId].color))];
    html+=`<g class="gnode g-company${c.risk?' is-risk':''}" data-cid="${c.id}" transform="translate(${p.x} ${p.y})">
      ${k>=2?`<circle class="cross-ring" r="10" fill="none" stroke="${colors[0]}" stroke-width="1.2" stroke-dasharray="2 3" opacity=".85"/>`:''}
      <circle class="gn-body" r="${k>=2?6.5:6}" fill="${c.risk?'#3d4a5c':'#0d1524'}" stroke="${c.risk?'#64748b':'#cbd5e1'}" stroke-width="1.6"/>
      <text x="0" y="${k>=2?24:20}" text-anchor="middle" class="gname" style="${c.risk?'fill:#7a8aa0':''}">${c.name}</text>
      <text x="0" y="${k>=2?36:31}" text-anchor="middle" class="gquote flat">— —</text>
      <circle class="hit" r="20" fill="transparent"/>
    </g>`;
  });
  svg.innerHTML=html+'</g>';
  applyViewport();
  applyView();
}

/* ---------- 高亮 / 淡化 ---------- */
function relatedSet(){
  const set=new Set(); const cs=new Set(), gs=new Set();
  if(state.search){
    const q=state.search.toLowerCase();
    activeCompanies().forEach(c=>{
      if(c.name.toLowerCase().includes(q)||c.code.toLowerCase().includes(q)) cs.add(c.id);
    });
  } else if(state.hover){
    if(state.hover[0]==='c'){ cs.add(state.hover.slice(1)); }
    else gs.add(state.hover.slice(1));
  } else if(state.selected){
    if(state.selected[0]==='c'){ cs.add(state.selected.slice(1)); }
    else gs.add(state.selected.slice(1));
  }
  activeRelations().forEach(r=>{
    if(cs.has(r.companyId)||gs.has(r.groupId)){ set.add('c'+r.companyId); set.add('g'+r.groupId); }
  });
  cs.forEach(c=>set.add('c'+c)); gs.forEach(g=>set.add('g'+g));
  return set;
}
function applyView(){
  const svg=document.getElementById('svg');
  const active=relatedSet();
  svg.querySelectorAll('.gline').forEach(l=>{
    let on = true;
    if(state.search){ on = active.has('c'+l.dataset.cid); }
    else if(state.hover || state.selected){
      const key = state.hover || state.selected;
      on = key[0]==='c' ? l.dataset.cid === key.slice(1) : active.has('g'+l.dataset.gid);
    }
    if(on && state.relFilter.size) on = state.relFilter.has(l.dataset.type);
    l.classList.toggle('dim', !on);
  });
  svg.querySelectorAll('.gnode').forEach(n=>{
    const key = n.dataset.cid ? 'c'+n.dataset.cid : 'g'+n.dataset.gid;
    let on = true;
    if(state.search || state.hover || state.selected) on = active.has(key);
    if(on && state.crossOnly && n.dataset.cid){
      on = new Set((relsOf[n.dataset.cid]||[]).map(r=>r.groupId)).size>=2 || active.has(key);
    }
    if(on && state.relFilter.size){
      const rels = n.dataset.cid ? (relsOf[n.dataset.cid]||[]) : (relsOfGroup[n.dataset.gid]||[]);
      on = rels.some(r=>state.relFilter.has(r.type));
    }
    n.classList.toggle('dim', !on);
  });
}
function clearFocus(){ state.hover=null; state.selected=null; applyView(); }

/* ---------- 详情面板 ---------- */
function relIcon(type, color, clsExtra=''){
  const dash=relDashCls(type), thin=relThin(type);
  return `<i class="${dash}${thin?' thin':''} ${clsExtra}" style="border-color:${color}"></i>`;
}
function renderDetail(){
  const box=document.getElementById('detail');
  const isNarrow = window.matchMedia('(max-width:1020px)').matches;
  box.classList.toggle('open', isNarrow && !!state.selected);
  const sel=state.selected;
  if(!sel){ box.innerHTML=`
    <h3 style="color:var(--muted)">👈 点击节点查看详情</h3>
    <p class="d-desc" style="margin-top:10px">悬停可高亮关系线；点击公司或板块节点，这里会展示：</p>
    <h4>公司节点</h4>
    <p class="d-desc">所属板块清单（彩色徽章）、每条关系的类型与来源、行情快照、风险备注。</p>
    <h4>板块节点</h4>
    <p class="d-desc">评级/状态/周期、板块描述、关系类型分布、成员公司列表。</p>
    <div class="d-note">💡 删除个股或单条关系仅本次会话生效（不写回数据库），「✕ 重置」可恢复；图例点击可多选筛选关系类型。</div>`; return; }
  if(sel[0]==='c'){
    const c=cMap[sel.slice(1)], rels=relsOf[c.id]||[];
    const tags=rels.map(r=>{
      const g=gMap[r.groupId];
      return `<span class="gtag" style="color:${g.color};border-color:${g.color}66">${relIcon(r.type,g.color)}${g.name} · ${REL[r.type].label}</span>`;
    }).join('');
    const q=QUOTE[c.id];
    const qCls=q&&q.price!==null?(q.pct===null||q.pct===0?'flat':(q.pct>0?'up':'down')):'';
    const qRow=q&&q.price!==null
      ? `<div class="d-quote"><span class="q-price ${qCls}">${q.price.toFixed(2)}</span>
        <span class="q-pct ${qCls}">${q.pct===null?'':(q.pct>=0?'+':'')+q.pct.toFixed(2)+'%'}</span>
        ${q.ts?`<span class="q-time">${fmtQuoteTime(q.ts)}</span>`:''}</div>`
      : '<p class="d-desc" style="margin-top:8px">行情暂不可用（—）</p>';
    box.innerHTML=`
      <h3>${c.name}<span class="d-code">${c.code||'—'}</span>${c.listType?`<span class="d-dot" style="background:${c.listType==='持仓'?'#34d399':'#60a5fa'};box-shadow:0 0 10px ${c.listType==='持仓'?'#34d399':'#60a5fa'}" title="${c.listType}"></span>`:''}<button class="del-company" data-del-company="${c.id}">删除个股</button></h3>
      ${qRow}
      <h4>所属板块（${rels.length} 条关系）</h4>
      <div class="d-tags">${tags}</div>
      <h4>关系明细 · 可删除单条</h4>
      <ul class="rel-list">${rels.map(r=>{
        const g=gMap[r.groupId];
        return `<li>${relIcon(r.type,g.color,'rel-line')}<div><b style="color:${g.color}">${g.name}</b> · ${REL[r.type].label} — ${r.note}<small>来源：${r.source}</small></div><button class="mini-del" data-del-rel="${r.companyId}|${r.groupId}" title="删除该关系">✕</button></li>`;
      }).join('')}</ul>
      ${rels.length===0?`<div class="d-note">ℹ 暂未关联任何板块：买入逻辑未提及板块名，也不在板块龙头/概念龙头清单中。</div>`:''}
      ${c.note?`<div class="d-note">⚠ ${c.note}</div>`:''}`;
    return;
  }
  const g=gMap[sel.slice(1)], rels=relsOfGroup[g.id]||[];
  const dist={};
  rels.forEach(r=>dist[r.type]=(dist[r.type]||0)+1);
  const gq=groupAvgQuote(g.id);
  const gqCls=gq?(gq.avg>0?'up':(gq.avg<0?'down':'flat')):'flat';
  const gqRow=gq
    ? `<div class="d-quote"><span class="q-price ${gqCls}">${fmtPct(gq.avg)}</span>
      <span class="q-pct ${gqCls}">均幅 · ${gq.n}/${gq.total} 家有行情</span>
      ${quoteTs?`<span class="q-time">${fmtQuoteTime(quoteTs)}</span>`:''}</div>`
    : '<p class="d-desc" style="margin-top:8px">暂无可用行情计算板块均幅</p>';
  box.innerHTML=`
    <h3><span class="d-dot" style="background:${g.color};box-shadow:0 0 12px ${g.color}"></span>${g.name}</h3>
    <div class="d-tags" style="margin-top:6px">
      <span class="gtag" style="color:var(--gold);border-color:rgba(251,191,36,.45)">评级 ${g.rating}/5</span>
      <span class="gtag" style="color:${g.status==='重点跟踪'?'var(--gold)':'var(--text)'};border-color:${g.color}55">${g.status||'—'}</span>
      <span class="gtag" style="color:var(--muted);border-color:var(--line)">周期 ${g.cycle||'—'}</span>
    </div>
    <p class="d-desc">${g.desc}</p>
    ${g.note?`<p class="d-source" style="margin-top:8px">更新说明：<b>${g.note}</b></p>`:''}
    ${gqRow}
    <h4>关系类型分布</h4>
    <div class="d-tags">${Object.entries(dist).map(([t,n])=>`<span class="gtag" style="color:${g.color};border-color:${g.color}55">${relIcon(t,g.color)}${REL[t].label} ${n}</span>`).join('')}</div>
    <h4>成员公司（${rels.length} 家）· 可删除单条关系</h4>
    <ul class="rel-list">${rels.map(r=>{
      const c=cMap[r.companyId];
      return `<li>${relIcon(r.type,g.color,'rel-line')}<div><b>${c.name}</b><small>${c.code} · ${r.note}（${r.source}）</small></div><button class="mini-del" data-del-rel="${r.companyId}|${r.groupId}" title="删除该关系">✕</button></li>`;
    }).join('')}</ul>`;
}

/* ---------- 统计 / 图例 ---------- */
function renderStats(){
  const cs=activeCompanies(), rels=activeRelations();
  const cross=cs.filter(c=>new Set((relsOf[c.id]||[]).map(r=>r.groupId)).size>=2).length;
  document.getElementById('stats').innerHTML=`
    <span class="stat"><b>${groups.length}</b>板块</span>
    <span class="stat"><b>${cs.length}</b>公司</span>
    <span class="stat"><b>${rels.length}</b>条关系</span>
    <span class="stat"><b class="cross">${cross}</b>跨板块公司</span>`;
}
function renderLegend(){
  const allOn=state.relFilter.size===0;
  let html=`<span class="lg${allOn?' active':''}" data-type="all"><b>全部</b></span>`;
  html+=Object.entries(REL).map(([t,v])=>{
    const cls=relDashCls(t), thin=relThin(t);
    const on=state.relFilter.has(t);
    return `<span class="lg${on?' active':''}" data-type="${t}"><i class="${cls}${thin?' thin':''}${v.dim?' dim':''}"></i><b>${v.label}</b></span>`;
  }).join('');
  document.getElementById('legendRel').innerHTML=html;
}

/* ---------- 行情（系统行情快照 kai_invest_stock_quote，只读展示） ---------- */
const QUOTE = {};       // companyId -> { price, pct, ts }
let quoteTs = null, quoteFrom = '系统快照';
function parseTs(s){
  if(!s) return null;
  const dg=String(s).replace(/\D/g,'');
  if(dg.length>=14){
    const y=+dg.slice(0,4), mo=+dg.slice(4,6)-1, d=+dg.slice(6,8), h=+dg.slice(8,10), mi=+dg.slice(10,12), se=+dg.slice(12,14);
    if(mo>=0&&mo<12&&d>=1&&d<=31) return Math.floor(new Date(y,mo,d,h,mi,se).getTime()/1000);
  }
  return null;
}
function fmtQuoteTime(ts){
  if(!ts) return '';
  const d=new Date(ts*1000);
  const p=n=>String(n).padStart(2,'0');
  return p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
}
function applyQuotes(quotes){
  Object.keys(QUOTE).forEach(k=>delete QUOTE[k]);
  let latest=0;
  companies.forEach(c=>{
    const q=quotes?quotes[c.id]:null;
    if(q && q.price!==null && q.price!==undefined){
      const ts=parseTs(q.ts);
      QUOTE[c.id]={ price:+q.price, pct:(q.pct===null||q.pct===undefined)?null:+q.pct, ts };
      if(ts&&ts>latest) latest=ts;
    } else QUOTE[c.id]=null;
  });
  quoteTs=latest||null;
}
async function refreshQuotes(){
  const st=document.getElementById('quoteStatus');
  if(st) st.innerHTML='<b>行情</b>刷新中…';
  const btn=document.getElementById('btnRefresh'); if(btn) btn.disabled=true;
  try{
    const res=await fetch('/api/investment/quotes/refresh',{method:'POST'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    await loadGraph();
  }catch(e){
    if(st) st.innerHTML='<b>行情</b><span style="color:#f87171">刷新失败（接口不可用）</span>';
  }finally{
    if(btn) btn.disabled=false;
  }
}
function groupAvgQuote(gid){
  const rels=relsOfGroup[gid]||[];
  const seen=new Set(); let sum=0, n=0;
  rels.forEach(r=>{
    if(seen.has(r.companyId)) return;
    seen.add(r.companyId);
    const q=QUOTE[r.companyId]; if(q&&q.pct!==null){ sum+=q.pct; n++; }
  });
  return n? { avg:sum/n, n:n, total:seen.size } : null;
}
function fmtPct(v){ return (v>=0?'+':'')+v.toFixed(2)+'%'; }
function renderGroupQuotes(){
  document.querySelectorAll('#svg .gnode[data-gid] .g-avg').forEach(el=>{
    const gid=el.closest('.gnode').dataset.gid;
    const gq=groupAvgQuote(gid);
    if(gq){ el.textContent='均幅 '+fmtPct(gq.avg); el.setAttribute('class','g-avg '+(gq.avg>0?'up':(gq.avg<0?'down':'flat'))); }
    else { el.textContent='均幅 —'; el.setAttribute('class','g-avg flat'); }
  });
}
function refreshQuoteStatus(){
  const st=document.getElementById('quoteStatus');
  if(!st) return;
  const cs=activeCompanies();
  const n=cs.filter(c=>QUOTE[c.id]&&QUOTE[c.id].price!==null).length;
  st.innerHTML='<b>行情</b>'+n+'/'+cs.length+(quoteTs?' · '+fmtQuoteTime(quoteTs):'')+(quoteFrom?' · '+quoteFrom:'');
}
function renderQuotes(){
  document.querySelectorAll('#svg .gnode[data-cid]').forEach(n=>{
    const el=n.querySelector('.gquote'); if(!el) return;
    const q=QUOTE[n.dataset.cid];
    if(q&&q.price!==null){
      el.textContent=q.price.toFixed(2)+' '+(q.pct===null?'':(q.pct>=0?'+':'')+q.pct.toFixed(2)+'%');
      el.classList.remove('up','down','flat');
      if(q.pct===null||q.pct===0) el.classList.add('flat');
      else el.classList.add(q.pct>0?'up':'down');
    }else{
      el.textContent='— —';
      el.classList.remove('up','down'); el.classList.add('flat');
    }
  });
}

/* ---------- 事件 ---------- */
function bindEvents(){
  const svg=document.getElementById('svg');
  svg.addEventListener('mouseover',e=>{
    const n=e.target.closest('.gnode'); if(!n) return;
    state.hover = n.dataset.cid ? 'c'+n.dataset.cid : 'g'+n.dataset.gid;
    applyView();
  });
  svg.addEventListener('mouseout',e=>{
    const n=e.target.closest('.gnode'); if(!n) return;
    const rt=e.relatedTarget;
    if(rt && rt.closest && rt.closest('.gnode')===n) return;
    if(state.hover) { state.hover=null; applyView(); }
  });
  svg.addEventListener('click',e=>{
    if(state.suppressClick){ state.suppressClick=false; return; }
    const n=e.target.closest('.gnode');
    if(n){ state.selected = n.dataset.cid ? 'c'+n.dataset.cid : 'g'+n.dataset.gid; }
    else { state.selected=null; }
    state.hover=null; renderDetail(); applyView();
    if(state.selected && window.matchMedia('(max-width:1020px)').matches){
      const d=document.getElementById('detail');
      if(!d.querySelector('#btnDetailClose'))
        d.insertAdjacentHTML('afterbegin','<button class="d-close" id="btnDetailClose" aria-label="关闭">✕</button>');
    }
  });
  svg.addEventListener('pointerdown',e=>{
    const n=e.target.closest('.gnode[data-cid]'); if(!n) return;
    const cid=n.dataset.cid, p=cPos[cid];
    const q=svgPoint(e);
    p.x=(q.x-view.tx)/view.k; p.y=(q.y-view.ty)/view.k;
    let dragging=true, moved=false;
    const move=ev=>{
      if(!dragging) return;
      const q2=svgPoint(ev);
      const nx=(q2.x-view.tx)/view.k, ny=(q2.y-view.ty)/view.k;
      if(Math.hypot(nx-p.x,ny-p.y)>2) moved=true;
      p.x=nx; p.y=ny; p.vx=0; p.vy=0;
      svg.querySelectorAll(`.gline[data-cid="${cid}"]`).forEach(l=>{ l.setAttribute('d', linePath(cid, l.dataset.gid)); });
      const node=svg.querySelector(`.gnode[data-cid="${cid}"]`);
      if(node) node.setAttribute('transform',`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    };
    const up=()=>{
      dragging=false;
      window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up);
      if(moved){ state.suppressClick=true; setTimeout(()=>{ state.suppressClick=false; },0); }
    };
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
  });
  // 滚轮缩放（以鼠标位置为中心；触控板捏合同样生效）
  svg.addEventListener('wheel',e=>{
    e.preventDefault();
    const q=svgPoint(e);
    zoomAt(q.x,q.y, e.deltaY<0?1.13:1/1.13);
  },{passive:false});
  // 空白区域拖拽平移
  svg.addEventListener('pointerdown',e=>{
    if(e.target.closest('.gnode')) return;
    if(e.button!==0&&e.button!==1) return;
    e.preventDefault();
    const q0=svgPoint(e);
    let moved=false;
    const move=ev=>{
      const q=svgPoint(ev);
      const dx=q.x-q0.x, dy=q.y-q0.y;
      if(Math.abs(dx)+Math.abs(dy)>1.2) moved=true;
      if(moved){ view.tx+=dx; view.ty+=dy; applyViewport(); }
      q0.x=q.x; q0.y=q.y;
    };
    const up=()=>{
      window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up);
      svg.classList.remove('panning');
      if(moved){ state.suppressClick=true; setTimeout(()=>{ state.suppressClick=false; },0); }
    };
    svg.classList.add('panning');
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
  });
  // 缩放控件
  document.getElementById('btnZoomIn').addEventListener('click',()=>zoomAt(CX,CY,1.3));
  document.getElementById('btnZoomOut').addEventListener('click',()=>zoomAt(CX,CY,1/1.3));
  document.getElementById('btnZoomFit').addEventListener('click',resetView);
  document.getElementById('btnRefresh').addEventListener('click',()=>refreshQuotes());
  // 图例点击筛选关系类型（可多选）
  document.getElementById('legendRel').addEventListener('click',e=>{
    const item=e.target.closest('.lg'); if(!item) return;
    const t=item.dataset.type;
    if(t==='all') state.relFilter.clear();
    else if(state.relFilter.has(t)) state.relFilter.delete(t);
    else state.relFilter.add(t);
    state.hover=null; state.selected=null;
    renderLegend(); renderDetail(); applyView();
  });
  // 删除确认弹窗
  const confirmDialog=document.getElementById('confirmDialog');
  let confirmAction=null;
  function askConfirm(title,msg,action){
    document.getElementById('confirmTitle').textContent=title;
    document.getElementById('confirmMsg').innerHTML=msg;
    confirmAction=action;
    confirmDialog.showModal();
  }
  function closeConfirm(){ confirmDialog.close(); confirmAction=null; }
  document.getElementById('confirmOk').addEventListener('click',()=>{ const a=confirmAction; closeConfirm(); if(a) a(); });
  document.getElementById('confirmCancel').addEventListener('click',closeConfirm);
  document.getElementById('confirmCancel2').addEventListener('click',closeConfirm);
  confirmDialog.addEventListener('click',e=>{ if(e.target===confirmDialog) closeConfirm(); });
  document.getElementById('searchInput').addEventListener('input',e=>{
    state.search=e.target.value.trim();
    applyView();
  });
  document.getElementById('btnCross').addEventListener('click',e=>{
    state.crossOnly=!state.crossOnly;
    e.currentTarget.classList.toggle('active',state.crossOnly);
    applyView();
  });
  document.getElementById('btnReset').addEventListener('click',()=>{
    state.search=''; state.crossOnly=false; state.hover=null; state.selected=null;
    state.removedCompanies.clear(); state.removedRels.clear(); state.relFilter.clear();
    document.getElementById('searchInput').value='';
    document.getElementById('btnCross').classList.remove('active');
    recomputeData();
    renderStats(); renderLegend(); renderSVG(); renderQuotes(); renderGroupQuotes(); refreshQuoteStatus(); renderDetail(); applyView();
  });
  // 帮助弹窗
  const help=document.getElementById('helpDialog');
  document.getElementById('btnHelp').addEventListener('click',()=>help.showModal());
  document.getElementById('btnHelpClose').addEventListener('click',()=>help.close());
  help.addEventListener('click',e=>{ if(e.target===help) help.close(); });
  // 详情面板：关闭 / 删除个股 / 删除关系
  function afterEdit(){
    recomputeData();
    renderStats(); renderLegend(); renderSVG(); renderQuotes(); renderGroupQuotes(); refreshQuoteStatus(); renderDetail(); applyView();
  }
  document.getElementById('detail').addEventListener('click',e=>{
    if(e.target.closest('#btnDetailClose')){ document.getElementById('detail').classList.remove('open'); return; }
    const dc=e.target.closest('[data-del-company]');
    if(dc){
      const c=cMap[dc.dataset.delCompany];
      askConfirm('删除个股','确定从图谱中删除 <b>'+c.name+'（'+c.code+'）</b>？<br>该公司的全部关系线会一并移除；本次会话内可点「✕ 重置」恢复。',()=>{
        state.removedCompanies.add(c.id);
        if(state.selected==='c'+c.id) state.selected=null;
        afterEdit();
      });
      return;
    }
    const dr=e.target.closest('[data-del-rel]');
    if(dr){
      const pair=dr.dataset.delRel.split('|');
      const c=cMap[pair[0]], g=gMap[pair[1]];
      askConfirm('删除关系','确定删除 <b>'+c.name+' ↔ '+g.name+'</b> 的这条关系？<br>公司本身保留；本次会话内可点「✕ 重置」恢复。',()=>{
        state.removedRels.add(pair[0]+'|'+pair[1]);
        afterEdit();
      });
    }
  });
}

/* ---------- 初始化：从投资库 API 加载 ---------- */
function renderGraphError(e){
  const box=document.getElementById('graphError')||document.createElement('div');
  box.id='graphError';
  box.style.cssText='position:absolute;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--muted);font-size:13px;background:rgba(7,11,19,.88);text-align:center;padding:20px';
  box.innerHTML='<div style="font-size:24px">⚠️</div><p>图谱数据加载失败：'+(e&&e.message?e.message:'未知错误')+'</p><button class="tbtn" id="btnRetry">重试</button>';
  const gbox=document.querySelector('.graph-box'); if(gbox) gbox.appendChild(box);
  const retry=document.getElementById('btnRetry'); if(retry) retry.addEventListener('click',()=>{ const b=document.getElementById('graphError'); if(b) b.remove(); loadGraph(); });
}
async function loadGraph(){
  const st=document.getElementById('quoteStatus');
  if(st) st.innerHTML='<b>行情</b>加载中…';
  const btn=document.getElementById('btnRefresh'); if(btn) btn.disabled=true;
  try{
    const res=await fetch('/api/investment/sector-graph');
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    applyData(data);
    applyQuotes(data.quotes||{});
    state.hover=null; state.selected=null; state.search=''; state.crossOnly=false;
    state.removedCompanies.clear(); state.removedRels.clear(); state.relFilter.clear();
    document.getElementById('searchInput').value='';
    document.getElementById('btnCross').classList.remove('active');
    const errBox=document.getElementById('graphError'); if(errBox) errBox.remove();
    renderStats(); renderLegend(); renderSVG(); renderQuotes(); renderGroupQuotes(); renderDetail(); refreshQuoteStatus();
    if(st) st.innerHTML='<b>行情</b>'+(Object.keys(data.quotes||{}).length)+'/'+companies.length+(quoteTs?' · '+fmtQuoteTime(quoteTs):'')+' · 系统快照';
  }catch(e){
    renderGraphError(e);
  }finally{
    if(btn) btn.disabled=false;
  }
}
bindEvents();
loadGraph();
