// Main app controller

const state = {
  roster: [],        // [{ id, name, image, stats, momentum }]
  weights: { ...Momentum.DEFAULT_WEIGHTS },
  activeTab: 'overview',
  loading: new Set(),
  timeRange: 30,
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function num(v) {
  if (v == null) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}

function last(series, field) {
  if (!series?.length) return null;
  const s = [...series].sort((a, b) => new Date(b.timestp) - new Date(a.timestp));
  return s[0][field] ?? null;
}

function setLoading(id, on) {
  on ? state.loading.add(id) : state.loading.delete(id);
  document.getElementById('global-loader').style.display =
    state.loading.size ? 'flex' : 'none';
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ── Search ─────────────────────────────────────────────────────────────────────

let searchTimeout;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length < 2) { closeDropdown(); return; }
  searchTimeout = setTimeout(() => searchArtists(q), 350);
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrapper')) closeDropdown();
});

async function searchArtists(q) {
  try {
    const data = await API.searchArtists(q);
    const artists = data?.obj?.artists || data?.obj || [];
    renderDropdown(artists.slice(0, 8));
  } catch (err) {
    showToast('Search failed: ' + err.message, 'error');
  }
}

function renderDropdown(artists) {
  const el = document.getElementById('search-dropdown');
  if (!artists.length) { el.innerHTML = '<div class="dd-empty">No results</div>'; el.style.display = 'block'; return; }
  el.innerHTML = artists.map(a => `
    <div class="dd-item" data-id="${a.id}" data-name="${a.name}" data-img="${a.image_url || ''}">
      <img src="${a.image_url || ''}" onerror="this.src=''" class="dd-img" alt="">
      <div class="dd-info">
        <span class="dd-name">${a.name}</span>
        ${a.cm_score ? `<span class="dd-meta">CM Score: ${a.cm_score.toFixed(1)}</span>` : ''}
      </div>
    </div>
  `).join('');
  el.style.display = 'block';
  el.querySelectorAll('.dd-item').forEach(item => {
    item.addEventListener('click', () => {
      addArtist({ id: +item.dataset.id, name: item.dataset.name, image: item.dataset.img });
      document.getElementById('search-input').value = '';
      closeDropdown();
    });
  });
}

function closeDropdown() {
  document.getElementById('search-dropdown').style.display = 'none';
}

// ── Artist management ──────────────────────────────────────────────────────────

async function addArtist(artist) {
  if (state.roster.find(a => a.id === artist.id)) {
    showToast(`${artist.name} is already in your roster`, 'warn'); return;
  }
  if (state.roster.length >= 6) {
    showToast('Max 6 artists for comparison', 'warn'); return;
  }

  const entry = { ...artist, stats: null, momentum: null };
  state.roster.push(entry);
  renderRoster();

  setLoading(artist.id, true);
  try {
    entry.stats = await API.getAllStats(artist.id, state.timeRange);
    entry.momentum = Momentum.computeMomentum(entry.stats, state.weights);
    renderAll();
    showToast(`${artist.name} added`, 'success');
  } catch (err) {
    showToast(`Failed to load stats for ${artist.name}: ${err.message}`, 'error');
    state.roster = state.roster.filter(a => a.id !== artist.id);
    renderRoster();
  } finally {
    setLoading(artist.id, false);
  }
}

function removeArtist(id) {
  state.roster = state.roster.filter(a => a.id !== id);
  renderAll();
}

// ── Render ─────────────────────────────────────────────────────────────────────

function renderAll() {
  renderRoster();
  renderOverview();
  renderStreamingTab();
  renderSocialTab();
  renderMomentumTab();
}

function renderRoster() {
  const el = document.getElementById('roster');
  if (!state.roster.length) {
    el.innerHTML = '<p class="empty-hint">Search for artists above to start benchmarking</p>';
    return;
  }
  el.innerHTML = state.roster.map((a, i) => `
    <div class="chip" style="border-color: ${Charts.PALETTE[i % 6]}44">
      <span class="chip-dot" style="background:${Charts.PALETTE[i % 6]}"></span>
      <img src="${a.image}" onerror="this.style.display='none'" class="chip-img" alt="">
      <span>${a.name}</span>
      <button class="chip-remove" onclick="removeArtist(${a.id})" title="Remove">×</button>
    </div>
  `).join('');
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function renderOverview() {
  const grid = document.getElementById('overview-cards');
  if (!state.roster.length) {
    grid.innerHTML = '<p class="empty-hint">Add artists to see their momentum scores</p>';
    return;
  }

  grid.innerHTML = state.roster.map((a, i) => {
    const m = a.momentum;
    const { label, color } = Momentum.momentumLabel(m?.score ?? null);
    const sp = last(a.stats?.spotify, 'monthly_listeners');
    const spF = last(a.stats?.spotify, 'followers');
    const ig = last(a.stats?.instagram, 'followers');
    const tt = last(a.stats?.tiktok, 'followers');
    const yt = last(a.stats?.youtube, 'subscribers');
    const bd = m?.breakdown || {};

    return `
      <div class="card artist-card" style="--accent:${Charts.PALETTE[i % 6]}">
        <div class="card-header">
          <img src="${a.image}" onerror="this.style.display='none'" class="artist-thumb" alt="">
          <div>
            <h3>${a.name}</h3>
            <span class="badge" style="background:${color}22;color:${color}">${label}</span>
          </div>
          <div class="momentum-score" style="color:${color}">${m?.score ?? '—'}</div>
        </div>
        <div class="metric-grid">
          <div class="metric"><span class="metric-label">Spotify Listeners</span><span class="metric-val">${num(sp)}</span><span class="metric-delta ${deltaClass(bd.sp_listeners?.pct)}">${Momentum.formatGrowth(bd.sp_listeners?.pct)}</span></div>
          <div class="metric"><span class="metric-label">Spotify Followers</span><span class="metric-val">${num(spF)}</span><span class="metric-delta ${deltaClass(bd.sp_followers?.pct)}">${Momentum.formatGrowth(bd.sp_followers?.pct)}</span></div>
          <div class="metric"><span class="metric-label">Instagram</span><span class="metric-val">${num(ig)}</span><span class="metric-delta ${deltaClass(bd.instagram?.pct)}">${Momentum.formatGrowth(bd.instagram?.pct)}</span></div>
          <div class="metric"><span class="metric-label">TikTok</span><span class="metric-val">${num(tt)}</span><span class="metric-delta ${deltaClass(bd.tiktok?.pct)}">${Momentum.formatGrowth(bd.tiktok?.pct)}</span></div>
          <div class="metric"><span class="metric-label">YouTube Subs</span><span class="metric-val">${num(yt)}</span><span class="metric-delta ${deltaClass(bd.youtube?.pct)}">${Momentum.formatGrowth(bd.youtube?.pct)}</span></div>
        </div>
        ${!a.stats ? '<div class="loading-overlay">Loading…</div>' : ''}
      </div>
    `;
  }).join('');

  // Momentum bar chart
  if (state.roster.some(a => a.momentum?.score != null)) {
    Charts.renderMomentumBar('momentum-bar-chart', state.roster.map(a => ({
      name: a.name,
      score: a.momentum?.score ?? null,
    })));
  }
}

function deltaClass(pct) {
  if (pct == null) return '';
  return pct >= 0 ? 'up' : 'down';
}

// ── Streaming Tab ─────────────────────────────────────────────────────────────

function renderStreamingTab() {
  const withStats = state.roster.filter(a => a.stats?.spotify?.length);
  Charts.renderLineChart('chart-sp-listeners', null,
    withStats.map(a => ({ name: a.name, series: a.stats.spotify })),
    'monthly_listeners');
  Charts.renderLineChart('chart-sp-followers', null,
    withStats.map(a => ({ name: a.name, series: a.stats.spotify })),
    'followers');
}

// ── Social Tab ────────────────────────────────────────────────────────────────

function renderSocialTab() {
  const ig = state.roster.filter(a => a.stats?.instagram?.length);
  const tt = state.roster.filter(a => a.stats?.tiktok?.length);
  const yt = state.roster.filter(a => a.stats?.youtube?.length);

  Charts.renderLineChart('chart-ig', null,
    ig.map(a => ({ name: a.name, series: a.stats.instagram })), 'followers');
  Charts.renderLineChart('chart-tt', null,
    tt.map(a => ({ name: a.name, series: a.stats.tiktok })), 'followers', 1);
  Charts.renderLineChart('chart-yt', null,
    yt.map(a => ({ name: a.name, series: a.stats.youtube })), 'subscribers', 2);
}

// ── Momentum Tab ──────────────────────────────────────────────────────────────

function renderMomentumTab() {
  renderWeightsEditor();
  renderMomentumBreakdown();
}

function renderWeightsEditor() {
  const fields = [
    { key: 'sp_listeners', label: 'Spotify Monthly Listeners' },
    { key: 'sp_followers', label: 'Spotify Followers' },
    { key: 'tiktok',       label: 'TikTok Followers' },
    { key: 'instagram',    label: 'Instagram Followers' },
    { key: 'youtube',      label: 'YouTube Subscribers' },
  ];
  const total = Object.values(state.weights).reduce((s, w) => s + w, 0);

  document.getElementById('weights-editor').innerHTML = fields.map(f => `
    <div class="weight-row">
      <label>${f.label}</label>
      <input type="range" min="0" max="60" value="${state.weights[f.key]}"
        oninput="updateWeight('${f.key}', +this.value)"
        onchange="recalcMomentum()">
      <span class="weight-val" id="wval-${f.key}">${state.weights[f.key]}%</span>
    </div>
  `).join('') + `<div class="weight-total ${total !== 100 ? 'warn' : ''}">
    Total: ${total}% ${total !== 100 ? '(adjust to reach 100%)' : '✓'}
  </div>`;
}

function updateWeight(key, val) {
  state.weights[key] = val;
  const el = document.getElementById(`wval-${key}`);
  if (el) el.textContent = val + '%';
  const total = Object.values(state.weights).reduce((s, w) => s + w, 0);
  const totEl = document.querySelector('.weight-total');
  if (totEl) {
    totEl.textContent = `Total: ${total}% ${total !== 100 ? '(adjust to reach 100%)' : '✓'}`;
    totEl.className = `weight-total ${total !== 100 ? 'warn' : ''}`;
  }
}

function recalcMomentum() {
  state.roster.forEach(a => {
    if (a.stats) a.momentum = Momentum.computeMomentum(a.stats, state.weights);
  });
  renderOverview();
  renderMomentumBreakdown();
}

function renderMomentumBreakdown() {
  const el = document.getElementById('momentum-breakdown');
  if (!state.roster.length) { el.innerHTML = '<p class="empty-hint">No artists loaded</p>'; return; }

  const rows = state.roster.map((a, i) => {
    const m = a.momentum;
    const { label, color } = Momentum.momentumLabel(m?.score ?? null);
    const bd = m?.breakdown || {};
    const keys = ['sp_listeners', 'sp_followers', 'tiktok', 'instagram', 'youtube'];
    const cols = keys.map(k => `<td>${bd[k] ? Momentum.formatGrowth(bd[k].pct) + ' → ' + Math.round(bd[k].score) : '—'}</td>`).join('');
    return `<tr>
      <td><span class="chip-dot" style="background:${Charts.PALETTE[i%6]}"></span> ${a.name}</td>
      <td><strong style="color:${color}">${m?.score ?? '—'}</strong> <span class="badge" style="background:${color}22;color:${color}">${label}</span></td>
      ${cols}
    </tr>`;
  }).join('');

  el.innerHTML = `<table class="breakdown-table">
    <thead><tr>
      <th>Artist</th><th>Score</th>
      <th>SP Listeners</th><th>SP Followers</th><th>TikTok</th><th>Instagram</th><th>YouTube</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    state.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  });
});

// ── Time range ────────────────────────────────────────────────────────────────

document.getElementById('time-range').addEventListener('change', async e => {
  state.timeRange = +e.target.value;
  if (!state.roster.length) return;
  showToast('Refreshing data…', 'info');
  await Promise.all(state.roster.map(async a => {
    setLoading(a.id, true);
    try {
      a.stats = await API.getAllStats(a.id, state.timeRange);
      a.momentum = Momentum.computeMomentum(a.stats, state.weights);
    } finally {
      setLoading(a.id, false);
    }
  }));
  renderAll();
});
