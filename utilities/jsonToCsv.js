function cleanText(text) {
  if (typeof text !== 'string') {
    return text;
  }

  // Remove HTML tags and decode HTML entities
  let cleanedText = text
    .replace(/<\/?[^>]+(>|$)<\/b><br><\/br><br>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");

  return cleanedText;
}

function jsonToCsv(jsonData, standardPermissionsList) {
  const csvRows = [];

  console.log(jsonData);

  // Define columns to exclude
  const columnsToExclude = [
    'comments',
    'descriptionHTML',
    'updated',
    'contentRatingDescription',
    'videoImage',
    'video',
    'screenshots',
    'headerImage',
    'familyGenreID',
    'familyGenre',
    'developerInternalID',
    'androidVersionText',
    'histogram',
    'reviews',
    'minInstalls',
    'priceText',
    'description',
    'categories',
    'preregister',
    'earlyAccessEnabled',
    'isAvailableInPlayPass',
    'permissions',
  ];

  // Extract column headers dynamically from the first object in jsonData
  let columns = Object.keys(jsonData[0] || {});

  // Remove excluded columns
  columns = columns.filter(column => !columnsToExclude.includes(column));

  // Add standard permissions columns
  columns = [...columns, ...standardPermissionsList];

  // Create header row
  csvRows.push(columns.map(column => `"${cleanText(column)}"`).join(','));

   // Add data rows
  for (const row of jsonData) {
    const rowValues = [];
    for (const column of columns) {
      if (column in row) {
        rowValues.push(`"${cleanText(row[column])}"`);
      } else if (standardPermissionsList.includes(column)) {
        const permission = row.permissions.find(p => p.permission === column);
        rowValues.push(permission ? true : false);
      } else {
        rowValues.push('');
      }
    }
    csvRows.push(rowValues.join(','));
  }

  return csvRows.join('\n');
}

module.exports = {
  cleanText, 
  jsonToCsv,
};