// Thin wrappers around Chart.js (loaded as a classic script: window.Chart).
// Colours come from CSS custom properties so light/dark mode follow the page.
import { h } from './util.js';

const live = new Set();

export function destroyCharts() {
  for (const c of live) c.destroy();
  live.clear();
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function base() {
  const ink2 = css('--ink-2');
  const grid = css('--grid');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    font: { family: css('--font') },
    plugins: {
      legend: { labels: { color: ink2, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
      tooltip: {
        backgroundColor: css('--surface-raised'), titleColor: css('--ink'), bodyColor: css('--ink-2'),
        borderColor: css('--border'), borderWidth: 1, padding: 10, cornerRadius: 8,
      },
    },
    scales: {
      x: { ticks: { color: ink2 }, grid: { display: false }, border: { color: css('--border') } },
      y: { ticks: { color: ink2, precision: 0 }, grid: { color: grid }, border: { display: false }, beginAtZero: true },
    },
  };
}

function mount(container, height, config) {
  if (!window.Chart) {
    container.append(h('p', { class: 'muted' }, 'Charts could not load (offline?). The tables below still show every number.'));
    return null;
  }
  const canvas = h('canvas', { role: 'img', 'aria-label': config.ariaLabel || 'Chart' });
  const box = h('div', { class: 'chart-box', style: { height: height + 'px' } }, canvas);
  container.append(box);
  const chart = new window.Chart(canvas, config);
  live.add(chart);
  return chart;
}

/** Single-series vertical bars (e.g. cases per month). */
export function barChart(container, { labels, values, label, height = 220, ariaLabel }) {
  const opts = base();
  opts.plugins.legend.display = false;
  return mount(container, height, {
    type: 'bar',
    ariaLabel,
    data: {
      labels,
      datasets: [{
        label, data: values, backgroundColor: css('--chart-1'), hoverBackgroundColor: css('--chart-1-hover'),
        borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 36,
      }],
    },
    options: opts,
  });
}

/** Stacked bars. datasets: [{label, data, color}]. horizontal + percent for distributions. */
export function stackedChart(container, { labels, datasets, height = 240, horizontal = false, percent = false, ariaLabel }) {
  const opts = base();
  const valueAxis = horizontal ? 'x' : 'y';
  const catAxis = horizontal ? 'y' : 'x';
  opts.indexAxis = horizontal ? 'y' : 'x';
  opts.scales[catAxis] = { ...opts.scales.x, stacked: true, grid: { display: false } };
  opts.scales[valueAxis] = {
    ...opts.scales.y, stacked: true,
    grid: { color: css('--grid') },
    ...(percent ? { max: 100, ticks: { color: css('--ink-2'), callback: (v) => v + '%' } } : {}),
  };
  opts.plugins.legend.position = 'bottom';
  if (percent) {
    opts.plugins.tooltip.callbacks = {
      label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}% (${ctx.dataset.counts[ctx.dataIndex]} cases)`,
    };
  }
  const surface = css('--surface');
  return mount(container, height, {
    type: 'bar',
    ariaLabel,
    data: {
      labels,
      datasets: datasets.map((d) => ({
        label: d.label, data: d.data, counts: d.counts, backgroundColor: d.color,
        borderColor: surface, borderWidth: horizontal ? { right: 2 } : { top: 2 }, borderSkipped: false,
        maxBarThickness: 34,
      })),
    },
    options: opts,
  });
}
