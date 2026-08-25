// Roster — Sprout Social artist grid (mirrors R Shiny structure)
// Groups are Sprout "groups" (e.g. management rosters). Each group contains
// multiple social profiles; profiles are deduplicated into artist cards.

(function () {

  const NETWORKS = ['fb_instagram_account', 'facebook', 'tiktok', 'youtube', 'twitter', 'linkedin'];
  const NET_LABELS = {
    instagram: 'IG', fb_instagram_account: 'IG', facebook: 'FB',
    tiktok: 'TT', youtube: 'YT', twitter: 'X', linkedin: 'LI',
  };
  const NET_CLASS = {
    instagram: 'instagram', fb_instagram_account: 'instagram', facebook: 'facebook',
    tiktok: 'tiktok', youtube: 'youtube', twitter: 'twitter', linkedin: 'linkedin',
  };

  function cleanNetwork(nt) {
    const map = { fb_instagram_account: 'instagram', facebook: 'facebook', tiktok: 'tiktok', youtube: 'youtube', twitter: 'twitter', linkedin: 'linkedin' };
    return map[(nt || '').toLowerCase()] || (nt || '').toLowerCase();
  }

  function norm(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function fmtNum(n) {
    if (!n && n !== 0) return '—';
    n = +n;
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(n);
  }

  function initials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  }

  // Group raw Sprout profiles into artist objects by name similarity
  function groupByArtist(profiles, groups) {
    const groupMap = {};
    (groups || []).forEach(g => { groupMap[String(g.group_id)] = g.name; });

    const artists = [];
    const seen = {};

    profiles.forEach(p => {
      const raw = p.name || p.native_name || '';
      const key = norm(raw);
      if (!key) return;

      const profileGroupIds = (p.groups || []).map(String);
      const groupName = profileGroupIds.map(gid => groupMap[gid]).filter(Boolean)[0] || 'Uncategorized';

      const artistKey = groupName + ':' + key;
      if (seen[artistKey] === undefined) {
        seen[artistKey] = artists.length;
        artists.push({
          name: raw,
          group: groupName,
          profiles: [],
          analytics: null,
          posts: null,
        });
      }
      const a = artists[seen[artistKey]];
      a.profiles.push({ ...p, network_type: cleanNetwork(p.network_type) });
    });

    return artists;
  }

  // ── State
  let artists = [];
  let currentArtist = null;
  let filterGroup = '';

  // ── DOM
  const summaryEl   = document.getElementById('roster-summary');
  const gridEl      = document.getElementById('roster-artist-grid');
  const statusText  = document.getElementById('roster-load-text');
  const statusEl    = document.getElementById('roster-load-status');
  const groupFilter = document.getElementById('roster-group-filter');
  const refreshBtn  = document.getElementById('roster-refresh-btn');
  const modal       = document.getElementById('roster-artist-modal');
  const modalClose  = document.getElementById('roster-modal-close');

  function setStatus(text, ok) {
    if (!statusText) return;
    statusText.textContent = text;
    statusEl && statusEl.classList.toggle('saved', !!ok);
  }

  function renderSummary() {
    if (!summaryEl) return;
    const visible = filteredArtists();
    const groups = [...new Set(visible.map(a => a.group))];
    const totImp = visible.reduce((s, a) => s + (a.analytics?.total_impressions || 0), 0);
    const totEng = visible.reduce((s, a) => s + (a.analytics?.total_engagements || 0), 0);
    const totGrowth = visible.reduce((s, a) => s + (a.analytics?.follower_growth || 0), 0);
    summaryEl.className = 'roster-summary-grid';
    summaryEl.innerHTML = [
      { label: 'Total Impressions', value: fmtNum(totImp), sub: '7-day · all platforms' },
      { label: 'Total Engagements', value: fmtNum(totEng), sub: '7-day · all platforms' },
      { label: 'Follower Growth', value: (totGrowth >= 0 ? '+' : '') + fmtNum(totGrowth), sub: 'net new · 7 days' },
      { label: 'Artists Tracked', value: String(visible.length), sub: `${groups.length} roster group${groups.length !== 1 ? 's' : ''}` },
    ].map(m => `<div class="roster-metric-card"><div class="roster-metric-label">${m.label}</div><div class="roster-metric-value">${m.value}</div><div class="roster-metric-sub">${m.sub}</div></div>`).join('');
  }

  function populateGroupFilter() {
    if (!groupFilter) return;
    const groups = [...new Set(artists.map(a => a.group))].sort();
    groupFilter.innerHTML = '<option value="">All groups</option>' +
      groups.map(g => `<option value="${g}">${g}</option>`).join('');
    if (filterGroup) groupFilter.value = filterGroup;
  }

  function filteredArtists() {
    return filterGroup ? artists.filter(a => a.group === filterGroup) : artists;
  }

  function renderGrid() {
    if (!gridEl) return;
    const list = filteredArtists();
    if (!list.length) {
      gridEl.innerHTML = `<div class="roster-empty"><h3>No artists found</h3><p>Check your Sprout Social connection or group filter.</p></div>`;
      return;
    }
    gridEl.className = 'roster-artist-grid';
    gridEl.innerHTML = list.map((a, i) => {
      const nets = [...new Set(a.profiles.map(p => p.network_type))].filter(Boolean);
      const imp = a.analytics?.total_impressions;
      const eng = a.analytics?.total_engagements;
      const growth = a.analytics?.follower_growth;
      return `<div class="roster-artist-card" data-artist-idx="${i}" role="button"><div class="roster-card-header"><div class="roster-avatar">${initials(a.name)}</div><div><div class="roster-card-name">${a.name}</div><div class="roster-card-group">${a.group}</div></div></div><div class="roster-network-pills">${nets.slice(0, 5).map(n => `<span class="net-pill ${NET_CLASS[n] || ''}">${NET_LABELS[n] || n}</span>`).join('')}</div><div class="roster-stats-row"><div class="roster-stat"><div class="roster-stat-label">Impressions</div><div class="roster-stat-value">${fmtNum(imp)}</div></div><div class="roster-stat"><div class="roster-stat-label">Engagements</div><div class="roster-stat-value">${fmtNum(eng)}</div></div><div class="roster-stat"><div class="roster-stat-label">Flw Growth</div><div class="roster-stat-value ${growth > 0 ? 'up' : growth < 0 ? 'down' : ''}">${growth != null ? (growth > 0 ? '+' : '') + fmtNum(growth) : '—'}</div></div></div></div>`;
    }).join('');
    gridEl.querySelectorAll('.roster-artist-card').forEach(card => {
      card.addEventListener('click', () => openArtistModal(filteredArtists()[+card.dataset.artistIdx]));
    });
  }

  function openArtistModal(artist) {
    currentArtist = artist;
    const el = id => document.getElementById(id);
    if (el('roster-modal-artist-name')) el('roster-modal-artist-name').textContent = artist.name;
    if (el('roster-modal-group')) el('roster-modal-group').textContent = artist.group;
    if (el('roster-modal-avatar')) el('roster-modal-avatar').textContent = initials(artist.name);
    if (el('roster-modal-pills')) {
      const nets = [...new Set(artist.profiles.map(p => p.network_type))];
      el('roster-modal-pills').innerHTML = nets.map(n => `<span class="net-pill ${NET_CLASS[n] || ''}">${NET_LABELS[n] || n}</span>`).join('');
    }
    switchModalTab('overview');
    renderModalOverview(artist);
    modal && modal.classList.add('open');
  }

  function switchModalTab(tab) {
    document.querySelectorAll('.roster-modal-tab').forEach(b => b.classList.toggle('active', b.dataset.rtab === tab));
    document.querySelectorAll('.roster-modal-pane').forEach(p => p.classList.toggle('active', p.id === `roster-modal-${tab}`));
  }

  function renderModalOverview(artist) {
    const el = document.getElementById('roster-modal-overview');
    if (!el) return;
    const m = artist.analytics || {};
    const engRate = (m.total_impressions && m.total_engagements) ? ((m.total_engagements / m.total_impressions) * 100).toFixed(2) : null;
    el.innerHTML = `<div class="roster-detail-metrics">${[
      { label: 'Impressions', value: fmtNum(m.total_impressions), sub: '7-day total' },
      { label: 'Engagements', value: fmtNum(m.total_engagements), sub: '7-day total' },
      { label: 'Eng. Rate', value: engRate != null ? engRate + '%' : '—', sub: 'eng ÷ impressions' },
      { label: 'Follower Growth', value: m.follower_growth != null ? (m.follower_growth >= 0 ? '+' : '') + fmtNum(m.follower_growth) : '—', sub: 'net new 7 days' },
      { label: 'Reach', value: fmtNum(m.total_reach), sub: '7-day total' },
      { label: 'Video Views', value: fmtNum(m.total_video_views), sub: '7-day total' },
    ].map(d => `<div class="roster-detail-metric"><div class="label">${d.label}</div><div class="value">${d.value}</div><div class="sub">${d.sub}</div></div>`).join('')}</div>${!m.total_impressions && !m.total_engagements ? `<div style="font-size:.84rem;color:var(--text-faint);margin-top:12px;padding:16px;background:var(--surface-2);border-radius:8px;text-align:center">Analytics requires a live Sprout Social connection. Profiles found: ${artist.profiles.length}.</div>` : ''}`;
  }

  function renderModalPosts(artist) {
    const el = document.getElementById('roster-modal-posts');
    if (!el) return;
    const posts = artist.posts || [];
    if (!posts.length) { el.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-faint)">No post data available.</div>`; return; }
    el.innerHTML = posts.slice(0, 8).map(p => `<div class="roster-post-card"><div>${(p.text || p.content || '').slice(0, 180)}</div><div class="roster-post-meta">${p.network_type || ''} · ${p.created_time ? new Date(p.created_time).toLocaleDateString() : ''}</div><div class="roster-post-stats"><span class="roster-post-stat"><strong>${fmtNum(p.impressions)}</strong> impressions</span><span class="roster-post-stat"><strong>${fmtNum(p.engagements)}</strong> engagements</span></div></div>`).join('');
  }

  function renderModalListening(artist) {
    const el = document.getElementById('roster-modal-listening');
    if (!el) return;
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-faint);font-size:.88rem">Social listening requires Sprout's Listening add-on.<br><span style="font-family:'IBM Plex Mono',monospace;font-size:.75rem;margin-top:8px;display:block">Data will appear here when the Listening API is configured.</span></div>`;
  }

  function renderModalNetworks(artist) {
    const el = document.getElementById('roster-modal-networks');
    if (!el) return;
    if (!artist.profiles.length) { el.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-faint)">No profile data.</div>`; return; }
    el.innerHTML = `<div class="roster-networks-grid">${artist.profiles.map(p => `<div class="roster-network-row"><div class="roster-network-name"><span class="net-pill ${NET_CLASS[p.network_type] || ''}" style="margin-right:6px">${NET_LABELS[p.network_type] || p.network_type}</span>${p.native_name || p.name || ''}</div><div class="roster-network-stats"><span class="roster-network-stat">ID: <strong>${p.customer_profile_id || p.id || '—'}</strong></span></div></div>`).join('')}</div>`;
  }

  document.querySelectorAll('.roster-modal-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.rtab;
      switchModalTab(tab);
      if (!currentArtist) return;
      if (tab === 'posts')     renderModalPosts(currentArtist);
      if (tab === 'listening') renderModalListening(currentArtist);
      if (tab === 'networks')  renderModalNetworks(currentArtist);
    });
  });

  if (modalClose) modalClose.addEventListener('click', () => modal && modal.classList.remove('open'));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  async function load() {
    setStatus('Loading roster…');
    try {
      const { profiles = [], groups = [] } = await API.getSproutRoster();
      artists = groupByArtist(profiles, groups);
      populateGroupFilter();
      if (!artists.length) {
        setStatus('No profiles found', false);
        if (gridEl) gridEl.innerHTML = `<div class="roster-empty"><h3>No profiles found</h3><p>Check SPROUT_TOKEN and SPROUT_CUSTOMER_ID in .env</p></div>`;
        return;
      }
      setStatus(`${artists.length} artists loaded`, true);
      renderSummary();
      renderGrid();
      await loadAnalytics();
    } catch (err) {
      console.error('[roster] load error', err);
      setStatus('Error: ' + err.message, false);
      if (gridEl) gridEl.innerHTML = `<div class="roster-empty"><h3>Connection error</h3><p>${err.message}</p></div>`;
    }
  }

  async function loadAnalytics() {
    setStatus('Fetching analytics…');
    const visible = filteredArtists();
    const allProfileIds = visible.flatMap(a => a.profiles.map(p => p.customer_profile_id || p.id)).filter(Boolean);
    if (!allProfileIds.length) { setStatus('Ready (no profile IDs)', true); return; }
    try {
      const data = await API.getSproutAnalytics(allProfileIds, 7);
      const byProfile = {};
      (data?.data || []).forEach(row => { byProfile[row.customer_profile_id] = row; });
      visible.forEach(artist => {
        let imp = 0, eng = 0, reach = 0, vv = 0, growth = 0, followers = 0;
        artist.profiles.forEach(p => {
          const row = byProfile[p.customer_profile_id || p.id];
          if (!row) return;
          imp      += row.impressions      || 0;
          eng      += row.engagements      || 0;
          reach    += row.reach            || 0;
          vv       += row.video_views      || 0;
          growth   += row.followers_gained || 0;
          followers += row.followers       || 0;
        });
        artist.analytics = { total_impressions: imp, total_engagements: eng, total_reach: reach, total_video_views: vv, follower_growth: growth, total_followers: followers };
      });
      renderSummary();
      renderGrid();
      setStatus('Up to date', true);
    } catch (err) {
      console.warn('[roster] analytics error', err.message);
      setStatus('Analytics unavailable', false);
      renderGrid();
    }
  }

  if (groupFilter) groupFilter.addEventListener('change', () => { filterGroup = groupFilter.value; renderSummary(); renderGrid(); });
  if (refreshBtn)  refreshBtn.addEventListener('click',  () => { artists = []; load(); });

  window.Roster = { load };

})();
