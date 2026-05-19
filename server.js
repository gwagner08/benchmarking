require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CM_BASE = 'https://api.chartmetric.com/api';

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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy all /cm/* requests to Chartmetric API
app.get('/cm/*', async (req, res) => {
  try {
    const token = await getToken();
    const cmPath = req.path.replace(/^\/cm/, '');
    const response = await axios.get(`${CM_BASE}${cmPath}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: req.query,
    });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.message;
    console.error(`[proxy] ${req.path} → ${status}: ${message}`);
    res.status(status).json({ error: message });
  }
});

// Comp suggestions: genre + audience size matching
app.get('/comps/:artistId', async (req, res) => {
  try {
    const token = await getToken();
    const artistId = +req.params.artistId;
    const band = req.query.band || 'peer';

    // Step 1: reference artist metadata
    const metaRes = await axios.get(`${CM_BASE}/artist/${artistId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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

    // Step 2: genre-filtered artist candidates — try three endpoints in order
    let candidates = [];

    const headers = { Authorization: `Bearer ${token}` };
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 7);
    const dateStr = recentDate.toISOString().slice(0, 10);

    try {
      const r = await axios.get(`${CM_BASE}/charts/spotify/artists`, {
        headers, params: { genre: primaryGenre, date: dateStr, limit: 50 },
      });
      candidates = r.data?.obj || [];
    } catch { /* try next */ }

    if (!candidates.length) {
      try {
        const r = await axios.get(`${CM_BASE}/artist/list`, {
          headers, params: { genre: primaryGenre, limit: 50, offset: 0 },
        });
        candidates = r.data?.obj || [];
      } catch { /* try next */ }
    }

    if (!candidates.length) {
      const r = await axios.get(`${CM_BASE}/search`, {
        headers, params: { q: primaryGenre, type: 'artists', limit: 50 },
      });
      candidates = r.data?.obj?.artists || r.data?.obj || [];
    }

    const suggestions = candidates
      .filter(a => a.id !== artistId)
      .filter(a => {
        const l = a.sp_monthly_listeners || 0;
        return l >= minL && l <= maxL;
      })
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

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Benchmarking dashboard → http://localhost:${PORT}`);
});
