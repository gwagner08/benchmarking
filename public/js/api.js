// Thin client that talks to our Express proxy at /cm/*

const BASE = '/cm';

async function get(path, params = {}) {
  const url = new URL(BASE + path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function dateRange(days = 30) {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - days);
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

// Chartmetric stat responses come in two shapes:
//   1. Flat array:    [{ timestp, followers, listeners, ... }]
//   2. Nested object: { followers: [{timestp, followers}], listeners: [{timestp, listeners}], ... }
// Normalise both to a flat array with all fields merged by timestp.
function normalizeStats(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;

  // Nested object — merge all series by date key
  const byDate = {};
  for (const [field, series] of Object.entries(obj)) {
    if (!Array.isArray(series)) continue;
    for (const entry of series) {
      const ts = entry.timestp || entry.date;
      if (!ts) continue;
      if (!byDate[ts]) byDate[ts] = { timestp: ts };
      byDate[ts][field] = entry[field] ?? entry.value;
    }
  }
  return Object.values(byDate).sort((a, b) => new Date(a.timestp) - new Date(b.timestp));
}

const API = {
  searchArtists(query) {
    return get('/search', { q: query, type: 'artists', limit: 10 });
  },

  getArtist(id) {
    return get(`/artist/${id}`);
  },

  getSpotifyStats(id, days = 90) {
    return get(`/artist/${id}/stat/spotify`, dateRange(days));
  },

  getInstagramStats(id, days = 90) {
    return get(`/artist/${id}/stat/instagram`, dateRange(days));
  },

  getTikTokStats(id, days = 90) {
    return get(`/artist/${id}/stat/tiktok`, dateRange(days));
  },

  getYouTubeStats(id, days = 90) {
    // Chartmetric uses 'youtube_channel' as the dsrc, not 'youtube'
    return get(`/artist/${id}/stat/youtube_channel`, dateRange(days));
  },

  getComps(artistId, band = 'peer') {
    return fetch(`/comps/${artistId}?band=${band}`).then(r => r.json());
  },

  // Fetch all platform stats — fire in parallel, server queue serializes them
  async getAllStats(id, days = 90) {
    const settle = fn => fn().then(v => ({ ok: true, v })).catch(() => ({ ok: false }));
    const [spotify, instagram, tiktok, youtube] = await Promise.all([
      settle(() => API.getSpotifyStats(id, days)),
      settle(() => API.getInstagramStats(id, days)),
      settle(() => API.getTikTokStats(id, days)),
      settle(() => API.getYouTubeStats(id, days)),
    ]);
    return {
      spotify:   normalizeStats(spotify.ok   ? spotify.v?.obj   : null),
      instagram: normalizeStats(instagram.ok ? instagram.v?.obj : null),
      tiktok:    normalizeStats(tiktok.ok    ? tiktok.v?.obj    : null),
      youtube:   normalizeStats(youtube.ok   ? youtube.v?.obj   : null),
    };
  },
};

window.API = API;
