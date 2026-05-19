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

// Chartmetric sometimes returns obj as an object or null instead of an array
function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (Array.isArray(val.data)) return val.data;
  return [];
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
    return get(`/artist/${id}/stat/youtube`, dateRange(days));
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
      spotify:   toArray(spotify.ok   ? spotify.v?.obj   : null),
      instagram: toArray(instagram.ok ? instagram.v?.obj : null),
      tiktok:    toArray(tiktok.ok    ? tiktok.v?.obj    : null),
      youtube:   toArray(youtube.ok   ? youtube.v?.obj   : null),
    };
  },
};

window.API = API;
