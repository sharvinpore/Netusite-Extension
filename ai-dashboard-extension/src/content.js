function extractTables(maxTables = 5) {
    const tables = Array.from(document.querySelectorAll("table")).slice(0, maxTables);
  
    return tables.map(t => ({
      rows: Array.from(t.querySelectorAll("tr"))
        .map(r =>
          Array.from(r.querySelectorAll("th,td"))
            .map(c => (c.innerText || "").trim())
            .filter(cell => /\d/.test(cell)) // keep numeric cells only
        )
        .filter(row => row.length > 0)
    }));
  }
  
  function getPageData() {
    const text = document.body?.innerText || "";
  
    return {
      title: document.title,
      url: location.href,
      text: text.slice(0, 40000), // prevent huge token overflow
      tables: extractTables()
    };
  }
  
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === "GET_PAGE") {
      sendResponse(getPageData());
    }
  });