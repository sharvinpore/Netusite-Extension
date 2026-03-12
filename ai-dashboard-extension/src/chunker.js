export function chunkText(text, size = 6000, overlap = 800) {
    const chunks = [];
    let i = 0;
  
    while (i < text.length) {
      const end = Math.min(text.length, i + size);
      chunks.push(text.slice(i, end));
      if (end === text.length) break;
      i = Math.max(0, end - overlap);
    }
  
    return chunks;
  }