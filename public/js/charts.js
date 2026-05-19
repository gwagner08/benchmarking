// Chart.js helpers — all charts rendered here

const PALETTE = [
  '#6366f1', '#f97316', '#22c55e', '#ec4899', '#14b8a6', '#eab308'
];

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      labels: { color: '#94a3b8', font: { size: 12 }, boxWidth: 12, padding: 16 }
    },
    tooltip: {
      backgroundColor: '#1e2130',
      borderColor: '#2a2a3a',
      borderWidth: 1,
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      padding: 10,
    },
  },
  scales: {
    x: {
      ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0 },
      grid: { color: '#1e2535' },
    },
    y: {
      ticks: { color: '#64748b', callback: v => formatTick(v) },
      grid: { color: '#1e2535' },
    },
  },
};

function formatTick(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildDataset(label, series, field, colorIdx) {
  return {
    label,
    data: series.map(d => d[field]),
    borderColor: PALETTE[colorIdx % PALETTE.length],
    backgroundColor: PALETTE[colorIdx % PALETTE.length] + '18',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    fill: series.length === 1 ? 'origin' : false,
    tension: 0.3,
  };
}

const _charts = {};

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function renderLineChart(canvasId, title, artistsData, field, colorOffset = 0) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Use the longest series for labels
  const longest = artistsData.reduce((a, b) =>
    (b.series?.length || 0) > (a.series?.length || 0) ? b : a, artistsData[0]);
  const labels = (longest?.series || []).map(d => formatDate(d.timestp));

  const datasets = artistsData
    .filter(a => a.series?.length)
    .map((a, i) => buildDataset(a.name, a.series, field, i + colorOffset));

  if (!datasets.length) {
    renderEmpty(canvas, 'No data available');
    return;
  }

  _charts[canvasId] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...JSON.parse(JSON.stringify(CHART_DEFAULTS)),
      plugins: {
        ...CHART_DEFAULTS.plugins,
        title: {
          display: !!title,
          text: title,
          color: '#94a3b8',
          font: { size: 13, weight: '500' },
          padding: { bottom: 12 },
        },
      },
    },
  });
}

function renderMomentumBar(canvasId, artistScores) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const sorted = [...artistScores].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  _charts[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map(a => a.name),
      datasets: [{
        label: 'Momentum Score',
        data: sorted.map(a => a.score ?? 0),
        backgroundColor: sorted.map(a => Momentum.momentumLabel(a.score).color + 'cc'),
        borderColor: sorted.map(a => Momentum.momentumLabel(a.score).color),
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      ...JSON.parse(JSON.stringify(CHART_DEFAULTS)),
      indexAxis: 'y',
      scales: {
        x: {
          min: 0, max: 100,
          ticks: { color: '#64748b' },
          grid: { color: '#1e2535' },
        },
        y: { ticks: { color: '#e2e8f0', font: { size: 13 } }, grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: CHART_DEFAULTS.plugins.tooltip,
      },
    },
  });
}

function renderEmpty(canvas, msg) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#64748b';
  ctx.font = '14px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
}

window.Charts = { renderLineChart, renderMomentumBar, PALETTE };
