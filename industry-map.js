const state = { data: null, selected: null, expanded: new Set(), toastTimer: null };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const escapeAttr = escapeHtml;
const hasQuoteValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const formatPct = (value) => hasQuoteValue(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '—';
const quoteClass = (value) => !hasQuoteValue(value) ? 'flat' : (Number(value) > 0 ? 'up' : (Number(value) < 0 ? 'down' : 'flat'));

function walkNodes(nodes, visitor) {
  for (const node of nodes || []) {
    visitor(node);
    walkNodes(node.children, visitor);
  }
}

function getNode(id) {
  let found = null;
  walkNodes(state.data?.roots, (node) => { if (node.id === Number(id)) found = node; });
  return found;
}

function getStock(id) {
  let found = null;
  walkNodes(state.data?.roots, (node) => {
    const stock = (node.constituents || []).find((item) => item.id === Number(id));
    if (stock) found = { stock, node };
  });
  return found;
}

function allNodes() {
  const items = [];
  walkNodes(state.data?.roots, (node) => items.push(node));
  return items;
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '请求失败，请稍后重试');
  return payload;
}

async function loadMap({ preserve = true } = {}) {
  const selected = preserve ? state.selected : null;
  state.data = await request('/api/investment/industry-map');
  if (!state.expanded.size) {
    walkNodes(state.data.roots, (node) => { if (node.depth < 2) state.expanded.add(node.id); });
  }
  if (selected?.type === 'node' && !getNode(selected.id)) state.selected = null;
  if (selected?.type === 'stock' && !getStock(selected.id)) state.selected = null;
  render();
}

function renderSummary() {
  const summary = state.data.summary || {};
  $('#summary').innerHTML = [
    [summary.nodeCount || 0, '产业链节点'],
    [summary.coreStockCount || 0, '人工标的归属'],
    [summary.quoteCount || 0, '有可用行情'],
  ].map(([value, label]) => `<span class="summary-item"><b>${value}</b><span>${label}</span></span>`).join('');
  $('#map-note').textContent = state.data.note || '';
}

function renderNode(node) {
  const open = state.expanded.has(node.id);
  const hasContents = (node.children || []).length || (node.constituents || []).length;
  const selected = state.selected?.type === 'node' && state.selected.id === node.id;
  const avg = node.averageChangePct;
  const stockSuffix = node.stockCount ? ` · ${node.stockCount} 个标的` : '';
  const childHtml = (node.children || []).map(renderNode).join('');
  const stockHtml = (node.constituents || []).map((stock) => renderStock(stock, node)).join('');
  return `<article class="node ${open ? 'is-open' : ''}" style="--level:${node.depth}">
    <div class="node-row ${selected ? 'is-selected' : ''}">
      <button class="node-toggle" type="button" data-toggle="${node.id}" aria-expanded="${open}" aria-hidden="${hasContents ? 'false' : 'true'}">${open ? '−' : '+'}</button>
      <button class="node-main" type="button" data-node="${node.id}" title="${escapeAttr(node.description || node.name)}">
        <span class="node-name">${escapeHtml(node.name)}</span>
        <span class="node-sub">${escapeHtml(node.description || '暂无说明')}${stockSuffix}</span>
      </button>
      <span class="quote ${quoteClass(avg)}">${formatPct(avg)}<small>${node.quoteCount}/${node.stockCount || 0} 有行情</small></span>
    </div>
    <div class="children">${childHtml}${stockHtml ? `<ul class="stock-list">${stockHtml}</ul>` : ''}</div>
  </article>`;
}

function renderStock(stock, node) {
  const selected = state.selected?.type === 'stock' && state.selected.id === stock.id;
  const quote = stock.quote?.changePct;
  return `<li><button class="stock-row ${selected ? 'is-selected' : ''}" type="button" data-stock="${stock.id}" title="${escapeAttr(stock.description || `${stock.stock_name} · ${node.name}`)}" style="--level:${node.depth}">
    <span><span class="stock-name">${escapeHtml(stock.stock_name)}</span>${stock.stock_code ? `<span class="stock-code"> ${escapeHtml(stock.stock_code)}</span>` : ''}<span class="stock-role">${escapeHtml(stock.role)}</span></span>
    <span class="stock-quote ${quoteClass(quote)}">${formatPct(quote)}</span>
  </button></li>`;
}

function nodeDetail(node) {
  const directStocks = node.constituents || [];
  return `<p class="detail-label">产业链节点 · 第 ${node.depth + 1} 层</p>
    <h2>${escapeHtml(node.name)}</h2>
    <p class="detail-summary">${escapeHtml(node.description || '暂未补充该环节说明。')}</p>
    <div class="detail-quote"><strong class="${quoteClass(node.averageChangePct)}">${formatPct(node.averageChangePct)}</strong><span>地图内核心标的均幅<br>${node.quoteCount}/${node.stockCount || 0} 个有行情</span></div>
    ${node.research_note ? `<section class="detail-section"><h3>研究逻辑</h3><p>${escapeHtml(node.research_note)}</p></section>` : ''}
    ${node.risk_note ? `<section class="detail-section"><h3>风险提示</h3><p>${escapeHtml(node.risk_note)}</p></section>` : ''}
    <section class="detail-section"><h3>本节点直接归属标的</h3>${directStocks.length ? `<ul class="detail-stocks">${directStocks.map((stock) => `<li><b>${escapeHtml(stock.stock_name)}</b>${stock.stock_code ? ` <span class="stock-code">${escapeHtml(stock.stock_code)}</span>` : ''}<span class="stock-role">${escapeHtml(stock.role)}</span></li>`).join('')}</ul>` : '<p>可在此节点下补充核心或关注标的。</p>'}</section>
    <div class="detail-actions"><button class="quiet-button" type="button" data-action="add-child" data-id="${node.id}">新增下级</button><button class="quiet-button" type="button" data-action="add-stock" data-id="${node.id}">新增标的</button><button class="quiet-button" type="button" data-action="edit-node" data-id="${node.id}">编辑节点</button><button class="danger-button" type="button" data-action="delete-node" data-id="${node.id}">删除节点</button></div>`;
}

function stockDetail(item) {
  const { stock, node } = item;
  const quote = stock.quote;
  return `<p class="detail-label">核心标的 · ${escapeHtml(node.name)}</p>
    <h2>${escapeHtml(stock.stock_name)} ${stock.stock_code ? `<span class="stock-code">${escapeHtml(stock.stock_code)}</span>` : ''}</h2>
    <p class="detail-summary"><span class="stock-role">${escapeHtml(stock.role)}</span></p>
    <div class="detail-quote"><strong class="${quoteClass(quote?.changePct)}">${formatPct(quote?.changePct)}</strong><span>${quote?.price ? `最新价 ${Number(quote.price).toFixed(2)}<br>` : ''}${quote?.observedAt ? `快照 ${escapeHtml(String(quote.observedAt).replace('T', ' ').slice(0, 16))}` : '暂无可用行情快照'}</span></div>
    <section class="detail-section"><h3>关联说明</h3><p>${escapeHtml(stock.description || '暂未补充说明。')}</p></section>
    <div class="detail-actions"><button class="quiet-button" type="button" data-action="edit-stock" data-id="${stock.id}">编辑标的</button><button class="danger-button" type="button" data-action="delete-stock" data-id="${stock.id}">删除标的</button></div>`;
}

function renderDetail() {
  const detail = $('#detail');
  if (!state.selected) {
    detail.innerHTML = '<p class="empty-detail">从左侧选择一个产业链节点或核心标的，查看研究逻辑、风险和行情快照。</p>';
    return;
  }
  if (state.selected.type === 'node') {
    const node = getNode(state.selected.id);
    detail.innerHTML = node ? nodeDetail(node) : '';
  } else {
    const stock = getStock(state.selected.id);
    detail.innerHTML = stock ? stockDetail(stock) : '';
  }
}

function render() { renderSummary(); $('#tree').innerHTML = (state.data.roots || []).map(renderNode).join('') || '<p class="empty-detail">还没有产业链节点，可点击“新增节点”开始维护。</p>'; renderDetail(); }

function fillNodeOptions(select, currentId = null, selectedParent = 0) {
  const options = ['<option value="0">作为一级产业链</option>'];
  allNodes().filter((node) => node.id !== Number(currentId)).forEach((node) => {
    options.push(`<option value="${node.id}">${'　'.repeat(node.depth)}${escapeHtml(node.name)}</option>`);
  });
  select.innerHTML = options.join('');
  select.value = String(selectedParent || 0);
}

function openNodeDialog(node = null, parentId = 0) {
  const dialog = $('#node-dialog');
  const form = $('#node-form');
  form.reset();
  form.elements.id.value = node?.id || '';
  form.elements.name.value = node?.name || '';
  form.elements.description.value = node?.description || '';
  form.elements.research_note.value = node?.research_note || '';
  form.elements.risk_note.value = node?.risk_note || '';
  form.elements.sort_order.value = node?.sort_order || 0;
  fillNodeOptions($('#node-parent'), node?.id, node?.parent_id ?? parentId);
  $('#node-dialog-title').textContent = node ? '编辑产业链节点' : '新增产业链节点';
  dialog.showModal();
}

function openStockDialog(stock = null, nodeId = 0) {
  const dialog = $('#stock-dialog');
  const form = $('#stock-form');
  form.reset();
  form.elements.id.value = stock?.id || '';
  form.elements.stock_name.value = stock?.stock_name || '';
  form.elements.stock_code.value = stock?.stock_code || '';
  form.elements.role.value = stock?.role || '核心标的';
  form.elements.description.value = stock?.description || '';
  form.elements.sort_order.value = stock?.sort_order || 0;
  $('#stock-node').innerHTML = allNodes().map((node) => `<option value="${node.id}">${'　'.repeat(node.depth)}${escapeHtml(node.name)}</option>`).join('');
  $('#stock-node').value = String(stock?.node_id || nodeId || allNodes()[0]?.id || '');
  $('#stock-dialog-title').textContent = stock ? '编辑核心标的' : '新增核心标的';
  dialog.showModal();
}

async function refreshQuotes() {
  const codes = [];
  walkNodes(state.data.roots, (node) => (node.constituents || []).forEach((stock) => { if (/^\d{6}$/.test(stock.stock_code || '')) codes.push(stock.stock_code); }));
  const uniqueCodes = [...new Set(codes)];
  if (!uniqueCodes.length) { showToast('地图中尚无可刷新行情的 6 位股票代码', true); return; }
  const button = document.querySelector('[data-action="refresh-quotes"]');
  button.disabled = true; button.textContent = '正在刷新…';
  try { await request('/api/investment/quotes/refresh', { method: 'POST', body: JSON.stringify({ codes: uniqueCodes }) }); await loadMap(); showToast(`已请求刷新 ${uniqueCodes.length} 只标的行情`); } finally { button.disabled = false; button.textContent = '刷新地图行情'; }
}

document.addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) { const id = Number(toggle.dataset.toggle); state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); render(); return; }
  const nodeButton = event.target.closest('[data-node]');
  if (nodeButton) { state.selected = { type: 'node', id: Number(nodeButton.dataset.node) }; renderDetail(); document.querySelector(`[data-node="${nodeButton.dataset.node}"]`)?.closest('.node-row')?.classList.add('is-selected'); render(); return; }
  const stockButton = event.target.closest('[data-stock]');
  if (stockButton) { state.selected = { type: 'stock', id: Number(stockButton.dataset.stock) }; render(); return; }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const name = action.dataset.action;
  if (name === 'close-dialog') { action.closest('dialog').close(); return; }
  if (name === 'add-node') { openNodeDialog(); return; }
  if (name === 'add-child') { openNodeDialog(null, Number(action.dataset.id)); return; }
  if (name === 'edit-node') { openNodeDialog(getNode(action.dataset.id)); return; }
  if (name === 'add-stock') { openStockDialog(null, Number(action.dataset.id)); return; }
  if (name === 'edit-stock') { openStockDialog(getStock(action.dataset.id)?.stock); return; }
  if (name === 'expand-all') { allNodes().forEach((node) => state.expanded.add(node.id)); render(); return; }
  if (name === 'refresh-quotes') { try { await refreshQuotes(); } catch (error) { showToast(error.message, true); } return; }
  if (name === 'delete-node') {
    const node = getNode(action.dataset.id);
    if (node && confirm(`删除“${node.name}”及其所有下级、标的？此操作不可恢复。`)) { try { await request(`/api/investment/industry-nodes/${node.id}`, { method: 'DELETE' }); state.selected = null; await loadMap({ preserve: false }); showToast('产业链节点已删除'); } catch (error) { showToast(error.message, true); } }
    return;
  }
  if (name === 'delete-stock') {
    const item = getStock(action.dataset.id);
    if (item && confirm(`删除标的“${item.stock.stock_name}”？`)) { try { await request(`/api/investment/industry-constituents/${item.stock.id}`, { method: 'DELETE' }); state.selected = null; await loadMap({ preserve: false }); showToast('核心标的已删除'); } catch (error) { showToast(error.message, true); } }
  }
});

$('#node-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.parent_id = Number(values.parent_id); values.sort_order = Number(values.sort_order);
  try { const result = await request(values.id ? `/api/investment/industry-nodes/${values.id}` : '/api/investment/industry-nodes', { method: values.id ? 'PUT' : 'POST', body: JSON.stringify(values) }); state.selected = { type: 'node', id: result.id }; $('#node-dialog').close(); await loadMap(); showToast('产业链节点已保存'); } catch (error) { showToast(error.message, true); }
});

$('#stock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.node_id = Number(values.node_id); values.sort_order = Number(values.sort_order);
  try { const result = await request(values.id ? `/api/investment/industry-constituents/${values.id}` : '/api/investment/industry-constituents', { method: values.id ? 'PUT' : 'POST', body: JSON.stringify(values) }); state.selected = { type: 'stock', id: result.id }; $('#stock-dialog').close(); await loadMap(); showToast('核心标的已保存'); } catch (error) { showToast(error.message, true); }
});

loadMap().catch((error) => { $('#tree').innerHTML = `<p class="empty-detail">加载产业链地图失败：${escapeHtml(error.message)}</p>`; showToast(error.message, true); });
