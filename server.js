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

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Benchmarking dashboard → http://localhost:${PORT}`);
});
