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

  // Fetch all platform stats in parallel
  async getAllStats(id, days = 90) {
    const [spotify, instagram, tiktok, youtube] = await Promise.allSettled([
      API.getSpotifyStats(id, days),
      API.getInstagramStats(id, days),
      API.getTikTokStats(id, days),
      API.getYouTubeStats(id, days),
    ]);
    return {
      spotify: spotify.status === 'fulfilled' ? (spotify.value?.obj || []) : [],
      instagram: instagram.status === 'fulfilled' ? (instagram.value?.obj || []) : [],
      tiktok: tiktok.status === 'fulfilled' ? (tiktok.value?.obj || []) : [],
      youtube: youtube.status === 'fulfilled' ? (youtube.value?.obj || []) : [],
    };
  },
};

window.API = API;
