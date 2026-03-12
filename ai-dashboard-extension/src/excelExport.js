import * as XLSX from "xlsx";

export function exportDashboard(report) {
  const wb = XLSX.utils.book_new();

  const kpis = [
    ["Label", "Value", "Unit"],
    ...(report.kpis || []).map(k => [k.label, k.value, k.unit || ""])
  ];

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(kpis),
    "KPIs"
  );

  (report.charts || []).forEach((c, i) => {
    const header = ["Label", ...(c.datasets || []).map(d => d.label)];
    const rows = (c.labels || []).map((lab, r) => {
      const vals = (c.datasets || []).map(d => d.data[r]);
      return [lab, ...vals];
    });

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([header, ...rows]),
      `Chart_${i + 1}`
    );
  });

  XLSX.writeFile(wb, "dashboard.xlsx");
}