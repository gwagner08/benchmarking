require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CM_BASE = 'https://api.chartmetric.com/api';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Auth ──────────────────────────────────────────────────────────────────────

let accessToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  const refreshToken = process.env.CHARTMETRIC_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('CHARTMETRIC_REFRESH_TOKEN not set in .env');
  const res = await axios.post(`${CM_BASE}/token`, { refreshtoken: refreshToken });
  accessToken = res.data.token;
  tokenExpiry = Date.now() + (res.data.expires_in || 3600) * 1000;
  console.log('[auth] Token refreshed, expires in', res.data.expires_in, 's');
  return accessToken;
}

// ── Rate-limited Chartmetric queue ────────────────────────────────────────────

const CM_INTERVAL = 750;

class CmQueue {
  constructor(interval) {
    this.interval = interval;
    this.pending = [];
    this.running = false;
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.pending.push({ fn, resolve, reject });
      if (!this.running) this._run();
    });
  }

  async _run() {
    this.running = true;
    while (this.pending.length) {
      const { fn, resolve, reject } = this.pending.shift();
      try { resolve(await fn()); } catch (e) { reject(e); }
      if (this.pending.length) await sleep(this.interval);
    }
    this.running = false;
  }
}

const cmQueue = new CmQueue(CM_INTERVAL);

async function cmGet(token, path, params = {}) {
  return cmQueue.enqueue(() => _cmRequest(token, path, params));
}

async function _cmRequest(token, path, params = {}) {
  const request = () => axios.get(`${CM_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });

  try {
    return await request();
  } catch (err) {
    if (err.response?.status !== 429) throw err;
    const raw = err.response.headers['retry-after'];
    let waitMs = 2000;
    if (raw) {
      const n = +raw;
      if (!isNaN(n)) {
        waitMs = n > 1e9 ? Math.max(n * 1000 - Date.now(), 0) : n * 1000;
      }
    }
    waitMs = Math.max(waitMs, 2000);
    console.warn(`[cm] 429 on ${path} — retrying in ${(waitMs / 1000).toFixed(1)}s`);
    await sleep(waitMs);
    return request();
  }
}

// ── Express ───────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy all /cm/* requests to Chartmetric API
app.get('/cm/*', async (req, res) => {
  try {
    const token = await getToken();
    const cmPath = req.path.replace(/^\/cm/, '');
    const response = await cmGet(token, cmPath, req.query);

    if (cmPath.includes('/stat/')) {
      const obj = response.data?.obj;
      const sample = Array.isArray(obj) ? obj[0] : obj;
      console.log(`[debug] ${cmPath} → obj type: ${Array.isArray(obj) ? 'array' : typeof obj}, sample keys: ${sample ? Object.keys(sample).join(', ') : 'none'}`);
    }

    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.message;
    console.error(`[proxy] ${req.path} → ${status}: ${message}`);
    res.status(status).json({ error: message });
  }
});

// Raw diagnostic
app.get('/debug/*', async (req, res) => {
  try {
    const token = await getToken();
    const cmPath = req.path.replace(/^\/debug/, '');
    const response = await cmGet(token, cmPath, req.query);
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, raw: err.response?.data });
  }
});

// Comp suggestions
app.get('/comps/:artistId', async (req, res) => {
  try {
    const token = await getToken();
    const artistId = +req.params.artistId;
    const band = req.query.band || 'peer';

    const metaRes = await cmGet(token, `/artist/${artistId}`);
    const artist = metaRes.data?.obj;
    const tags = artist?.tags || artist?.genres || artist?.cm_tags || [];
    const listeners = artist?.sp_monthly_listeners || 0;

    if (!tags.length) {
      return res.json({ obj: [], meta: { reason: 'No genre data for this artist' } });
    }

    const primaryGenre = Array.isArray(tags) ? tags[0] : tags;

    const BANDS = {
      smaller: { min: 0.10, max: 0.70 },
      peer:    { min: 0.40, max: 2.50 },
      larger:  { min: 1.50, max: 8.00 },
    };
    const { min, max } = BANDS[band] || BANDS.peer;
    const minL = listeners * min;
    const maxL = listeners * max;

    let candidates = [];

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 7);
    const dateStr = recentDate.toISOString().slice(0, 10);

    try {
      const r = await cmGet(token, '/charts/spotify/artists', { genre: primaryGenre, date: dateStr, limit: 50 });
      candidates = r.data?.obj || [];
    } catch { /* try next */ }

    if (!candidates.length) {
      try {
        const r = await cmGet(token, '/artist/list', { genre: primaryGenre, limit: 50, offset: 0 });
        candidates = r.data?.obj || [];
      } catch { /* try next */ }
    }

    if (!candidates.length) {
      const r = await cmGet(token, '/search', { q: primaryGenre, type: 'artists', limit: 50 });
      candidates = r.data?.obj?.artists || r.data?.obj || [];
    }

    const suggestions = candidates
      .filter(a => a.id !== artistId)
      .filter(a => { const l = a.sp_monthly_listeners || 0; return l >= minL && l <= maxL; })
      .sort((a, b) => (b.sp_monthly_listeners || 0) - (a.sp_monthly_listeners || 0))
      .slice(0, 8);

    res.json({
      obj: suggestions,
      meta: { genre: primaryGenre, allGenres: tags, referenceListeners: listeners, band, minL, maxL },
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.message;
    console.error(`[comps] ${req.params.artistId} → ${status}: ${message}`);
    res.status(status).json({ error: message });
  }
});

// ── Sprout Social proxy ───────────────────────────────────────────────────────

const SPROUT_BASE = 'https://api.sproutsocial.com/v1';
const SPROUT_CUSTOMER_ID = process.env.SPROUT_CUSTOMER_ID || '2447399';

function sproutHeaders() {
  const token = process.env.SPROUT_TOKEN;
  if (!token) throw new Error('SPROUT_TOKEN not set in .env');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// GET /sprout/roster — profiles + groups from Sprout
app.get('/sprout/roster', async (req, res) => {
  try {
    const cid = SPROUT_CUSTOMER_ID;
    const headers = sproutHeaders();
    const [profilesRes, groupsRes] = await Promise.all([
      axios.get(`${SPROUT_BASE}/${cid}/metadata/customer`, { headers }),
      axios.get(`${SPROUT_BASE}/${cid}/metadata/customer/groups`, { headers }),
    ]);
    res.json({ profiles: profilesRes.data?.data || [], groups: groupsRes.data?.data || [] });
  } catch (err) {
    const status = err.response?.status || 500;
    console.error('[sprout/roster]', err.message);
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /sprout/analytics — profile analytics for a given period
app.post('/sprout/analytics', async (req, res) => {
  try {
    const cid = SPROUT_CUSTOMER_ID;
    const headers = sproutHeaders();
    const { profile_ids, since, until, metrics } = req.body;
    const body = {
      filters: {
        customer_profile_ids: profile_ids,
        reporting_period: { since, until },
      },
      metrics: metrics || ['impressions', 'engagements', 'followers_gained', 'reach', 'video_views', 'post_count'],
    };
    const r = await axios.post(`${SPROUT_BASE}/${cid}/analytics/profiles`, body, { headers });
    res.json(r.data);
  } catch (err) {
    const status = err.response?.status || 500;
    console.error('[sprout/analytics]', err.message);
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /sprout/posts — recent posts for given profiles
app.post('/sprout/posts', async (req, res) => {
  try {
    const cid = SPROUT_CUSTOMER_ID;
    const headers = sproutHeaders();
    const { profile_ids, since, until } = req.body;
    const body = {
      filters: {
        customer_profile_ids: profile_ids,
        created_time: { since, until },
      },
      sort_by: 'impressions',
      limit: 10,
    };
    const r = await axios.post(`${SPROUT_BASE}/${cid}/analytics/posts`, body, { headers });
    res.json(r.data);
  } catch (err) {
    const status = err.response?.status || 500;
    console.error('[sprout/posts]', err.message);
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

// Debug: returns raw Sprout analytics for first profile to diagnose response shape
app.get('/sprout/debug-analytics', async (req, res) => {
  try {
    const cid = SPROUT_CUSTOMER_ID;
    const headers = sproutHeaders();
    const profilesRes = await axios.get(`${SPROUT_BASE}/${cid}/metadata/customer`, { headers });
    const profiles = profilesRes.data?.data || [];
    const firstId = profiles[0]?.customer_profile_id || profiles[0]?.id;
    if (!firstId) return res.json({ error: 'No profiles found', profiles });
    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const body = {
      filters: { customer_profile_ids: [firstId], reporting_period: { since, until } },
      metrics: ['impressions', 'engagements', 'followers_gained', 'reach', 'video_views'],
    };
    const r = await axios.post(`${SPROUT_BASE}/${cid}/analytics/profiles`, body, { headers });
    res.json({ profile_id: firstId, since, until, raw: r.data });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message, raw: err.response?.data });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Firebird workspace → http://localhost:${PORT}`);
});
