function cleanText(text) {
  if (typeof text !== 'string') {
    return text; // Return an empty string if text is not a string
  }

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

// Inside jsonToCsv function
function jsonToCsv(jsonData) {
  const csvRows = [];

  // Extract column headers dynamically from the first object in jsonData
  let columns = Object.keys(jsonData[0] || {});

  // Exclude specific columns
  const columnsToExclude = ['source', 'installs'];
  columns = columns.filter(column => !columnsToExclude.includes(column));

  // Create header row
  csvRows.push(columns.map(column => `"${cleanText(column)}"`).join(','));

  // Add data rows
  for (const row of jsonData) {
    // Exclude values for specific columns
    const values = columns.map(column => `"${cleanText(row[column])}"`);
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

module.exports = jsonToCsv;