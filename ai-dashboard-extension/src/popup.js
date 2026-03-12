import { getEngine, llmJson } from "./llm.js";
import { chunkText } from "./chunker.js";
import { renderKPIs, renderCharts } from "./dashboard.js";
import { exportDashboard } from "./excelExport.js";

let page = null;
let report = null;
let evidence = [];

// -----------------------------
// Helpers
// -----------------------------
function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

// -----------------------------
// LOAD PAGE (NetSuite Safe)
// -----------------------------
document.getElementById("load").onclick = async () => {
  try {
    setStatus("Injecting content script...");

    const tab = await getActiveTab();

    // Inject content script manually (important for NetSuite)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    setStatus("Reading page data...");

    page = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_PAGE"
    });

    if (!page || !page.text) {
      setStatus("No readable data found on page.");
      return;
    }

    setStatus("Page loaded successfully.");
  } catch (err) {
    console.error(err);
    setStatus("Failed to load page.");
  }
};

// -----------------------------
// GENERATE DASHBOARD
// -----------------------------
document.getElementById("generate").onclick = async () => {
  if (!page) {
    setStatus("Load page first.");
    return;
  }

  try {
    setStatus("Loading AI model...");
    const engine = await getEngine(setStatus);

    setStatus("Chunking page...");
    const chunks = chunkText(page.text, 5000, 600);

    evidence = [];

    // Limit chunks to avoid overflow
    const limitedChunks = chunks.slice(0, 5);

    // ---------------- PASS 1: Extract Numeric Data ----------------
    for (let i = 0; i < limitedChunks.length; i++) {
      setStatus(`Analyzing chunk ${i + 1}/${limitedChunks.length}`);

      const response = await llmJson(
        engine,
        [
          {
            role: "system",
            content:
              "Return ONLY valid JSON. Extract numeric facts, KPI candidates and chart candidates. Format: { numeric_facts:[], kpi_candidates:[], chart_candidates:[] }"
          },
          {
            role: "user",
            content: limitedChunks[i]
          }
        ],
        600
      );

      if (response && typeof response === "object") {
        evidence.push({
          numeric_facts: response.numeric_facts || [],
          kpi_candidates: response.kpi_candidates || [],
          chart_candidates: response.chart_candidates || []
        });
      }
    }

    // ---------------- SAFE FINAL PAYLOAD ----------------
    const safePayload = {
      title: page.title,
      url: page.url,
      tables: (page.tables || []).slice(0, 2),
      evidence: evidence.slice(0, 5)
    };

    const compactPayload = JSON.stringify(safePayload).slice(0, 10000);

    // ---------------- PASS 2: Generate Dashboard ----------------
    setStatus("Generating dashboard...");

    report = await llmJson(
      engine,
      [
        {
          role: "system",
          content:
            "Return ONLY valid JSON in this exact format: { kpis:[{label:string,value:number|string,unit:string}], charts:[{type:string,labels:string[],datasets:[{label:string,data:number[]}]}] }"
        },
        {
          role: "user",
          content: compactPayload
        }
      ],
      800
    );

    console.log("FINAL REPORT:", report);

    if (!report || !report.kpis) {
      setStatus("AI returned empty or invalid report.");
      return;
    }

    renderKPIs(report.kpis || []);
    renderCharts(report.charts || []);

    document.getElementById("download").disabled = false;

    setStatus("Dashboard ready.");
  } catch (err) {
    console.error(err);
    setStatus("Error generating dashboard.");
  }
};

// -----------------------------
// DOWNLOAD EXCEL
// -----------------------------
document.getElementById("download").onclick = () => {
  if (!report) {
    alert("No report generated yet.");
    return;
  }

  exportDashboard(report);
};