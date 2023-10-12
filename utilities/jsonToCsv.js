function cleanText(text) {
    // Remove HTML tags and decode HTML entities
    let cleanedText = text
      .replace(/<\/?[^>]+(>|$)/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'");
  
    return cleanedText;
  }
  
  function jsonToCsv(jsonData) {
    const csvRows = [];
  
    // Create header row
    csvRows.push('title,appId,url,developer,summary,score,category,installs,source');
  
    // Add data rows
    for (const row of jsonData) {
      const values = [
        `"${cleanText(row.title)}"`,
        `"${cleanText(row.appId)}"`,
        `"${cleanText(row.url)}"`,
        `"${cleanText(row.developer)}"`,
        `"${cleanText(row.summary).replace(/"/g, '""')}"`, // Handle quotes in summary
        `${row.score || ''}`,
        `"${cleanText(row.category)}"`,
        `"${cleanText(row.installs)}"`,
        `"${cleanText(row.source)}"`
      ];
  
      csvRows.push(values.join(','));
    }
  
    return csvRows.join('\n');
  }
  
  module.exports = jsonToCsv;
  