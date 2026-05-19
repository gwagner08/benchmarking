// Custom Firebird Momentum Score
// Weighted composite of platform growth velocities, normalized to 0–100

const DEFAULT_WEIGHTS = {
  sp_listeners: 30,   // Spotify monthly listeners growth
  sp_followers: 10,   // Spotify followers growth
  tiktok:       25,   // TikTok followers growth
  instagram:    20,   // Instagram followers growth
  youtube:      15,   // YouTube subscribers growth
};

// Sigmoid-like normalization via tanh: maps any % change to 0–100
// growth=0% → 50, +40% → ~85, -40% → ~15, ±100% → ~97/~3
function normalize(pctChange, sensitivity = 0.25) {
  return 50 + 50 * Math.tanh(pctChange / sensitivity);
}

function growthRate(series, field) {
  if (!series || series.length < 2) return null;
  const sorted = [...series].sort((a, b) => new Date(a.timestp) - new Date(b.timestp));
  const first = sorted[0][field];
  const last = sorted[sorted.length - 1][field];
  if (!first || first === 0) return null;
  return (last - first) / first;
}

function computeMomentum(stats, weights = DEFAULT_WEIGHTS) {
  const total = Object.values(weights).reduce((s, w) => s + w, 0);

  const signals = {
    sp_listeners: growthRate(stats.spotify, 'monthly_listeners'),
    sp_followers: growthRate(stats.spotify, 'followers'),
    tiktok:       growthRate(stats.tiktok, 'followers'),
    instagram:    growthRate(stats.instagram, 'followers'),
    youtube:      growthRate(stats.youtube, 'subscribers'),
  };

  let score = 0;
  let usedWeight = 0;
  const breakdown = {};

  for (const [key, pct] of Object.entries(signals)) {
    const w = weights[key] || 0;
    if (pct === null || w === 0) continue;
    const componentScore = normalize(pct);
    score += componentScore * w;
    usedWeight += w;
    breakdown[key] = { pct, score: componentScore, weight: w };
  }

  if (usedWeight === 0) return { score: null, breakdown: {} };

  // Re-normalize to compensate for missing platforms
  const finalScore = Math.round(score / usedWeight);
  return { score: finalScore, breakdown };
}

function momentumLabel(score) {
  if (score === null) return { label: 'No data', color: '#64748b' };
  if (score >= 75) return { label: 'Surging',    color: '#22c55e' };
  if (score >= 60) return { label: 'Growing',    color: '#84cc16' };
  if (score >= 45) return { label: 'Stable',     color: '#eab308' };
  if (score >= 30) return { label: 'Slowing',    color: '#f97316' };
  return              { label: 'Declining',   color: '#ef4444' };
}

function formatGrowth(pct) {
  if (pct === null || pct === undefined) return '—';
  const sign = pct >= 0 ? '+' : '';
  return sign + (pct * 100).toFixed(1) + '%';
}

window.Momentum = { computeMomentum, momentumLabel, formatGrowth, DEFAULT_WEIGHTS, normalize };
