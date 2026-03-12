import Chart from "chart.js/auto";

let charts = [];

export function renderKPIs(kpis) {
  const el = document.getElementById("kpis");
  el.innerHTML = "";

  (kpis || []).forEach(k => {
    const div = document.createElement("div");
    div.textContent = `${k.label}: ${k.value}${k.unit || ""}`;
    el.appendChild(div);
  });
}

export function renderCharts(specs) {
  charts.forEach(c => c.destroy());
  charts = [];

  const canvas = document.getElementById("chart");

  if (!specs?.length) return;

  const s = specs[0];

  charts.push(new Chart(canvas, {
    type: s.type === "histogram" ? "bar" : s.type,
    data: {
      labels: s.labels,
      datasets: s.datasets
    }
  }));
}