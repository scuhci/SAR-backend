function cleanText(text) {
  if (typeof text !== 'string') {
    return text;
  }

  // Remove HTML tags and decode HTML entities
  let cleanedText = text
  .replace(/<[^>]+>/g, '') // Remove HTML tags
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'");

  // Escape double quotes within the text
  cleanedText = cleanedText.replace(/"/g, '""');

  // Replace HTML line breaks with spaces
  cleanedText = cleanedText.replace(/<br\s*\/?>/g, ' ');

  // Replace other line breaks with spaces
  cleanedText = cleanedText.replace(/\r?\n|\r/g, ' ');

  return cleanedText;
}

function fixColumns(oldColumns, source)
{
  let columns = oldColumns;
  // Change column names
  if(source == 'app') // main CSV (a list of apps)
  { 
    console.log("Editing App CSV Column Headers");
    columns = columns.map(column => column
    .replace('title', 'appName')
    .replace('summary', 'description')
    .replace('score', 'avgRating')
    .replace('source', 'scrapedFrom')
    .replace('maxInstalls', 'approximateInstalls')
    .replace('ratings', 'totalRatings')
    .replace('reviews', 'totalReviews')
    .replace('available', 'downloadable')
    .replace('offersIAP', 'inAppPurchases')
    .replace('IAPRange', 'inAppPurchasesPriceRange')
    .replace('androidVersion', 'androidMinVersion')
    .replace('privacyPolicy', 'privacyPolicyURL')
    .replace('adSupported', 'inAppAdvertisements')
    .replace('released', 'originalReleaseDate')
    .replace('version', 'currentAppVersion')
    .replace('recentChanges', 'currentVersionChanges'));
  }
  else // reviews CSV
  {
    console.log("Editing Reviews CSV Column Headers");
    columns = columns.map(column => column
    .replace('id', 'reviewID')
    .replace('date', 'dateReviewed')
    .replace('score', 'rating')
    .replace('url', 'reviewURL')
    .replace('text', 'reviewText')
    .replace('replyDate', 'developerReplyDate')
    .replace('replyText', 'developerReplyText')
    .replace('version', 'versionWhenReviewed')
    .replace('thumbsUp', 'helpfulVotes')
    .replace('dateReviewedScraped', 'dateScraped'));
  }
  return columns;
}

function jsonToCsv(jsonData, source) {
  const csvRows = [];
  const currentTime = new Date();

  // console.log(jsonData);

  // Extract column headers dynamically from the first object in jsonData
  let columns = Object.keys(jsonData[0] || {});

  // Adjust columns
  // Define columns to exclude
  const columnsToExclude = [
    'free',
    'scoreText',
    'installs',
    'genre',
    'androidMaxVersion',
    'previewVideo',
    'criterias',
    'screenshots',
    'ipadScreenshots',
    'appletvScreenshots',
    'userName',
    'userImage',
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
    'requiredOsVersionText',
    'histogram',
    'minInstalls',
    'priceText',
    'description',
    'categories',
    'preregister',
    'earlyAccessEnabled',
    'isAvailableInPlayPass',
    'similarityScore',
  ];
  // for reviews, 'title' is removed, so we account for that here
  if(source == 'reviews')
  {
    columnsToExclude.push('title');
  }
  // Remove excluded columns
  columns = columns.filter(column => !columnsToExclude.includes(column));
  columns.push('dateScraped'); // adding this to list the timestamp the data was scraped at

  // Create header row (leaving for the end!)
  // csvRows.push(columns.map(column => `"${cleanText(column)}"`).join(','));

  //Add data rows
  for (const row of jsonData) {
    const rowValues = [];
    for (const column of columns) {
      if (column in row) {
        rowValues.push(`"${cleanText(row[column])}"`);
        if(rowValues[rowValues.length-1] == `"primary search"`)
        {
          rowValues.pop();
          rowValues.push(`"keyword search"`);
        }
        else if(rowValues[rowValues.length-1] == `"related app"`)
        {
          rowValues.pop();
          rowValues.push(`"similar app links"`);
        }
      }
      else if (column == 'dateScraped')
      {
        rowValues.push(currentTime);
      }
      else {
        rowValues.push('');
      }
    }
    csvRows.push(rowValues.join(','));
  }
  // editing column names 
  columns = fixColumns(columns, source);
  // adding them to the top of the CSV
  csvRows.unshift(columns.map(column => `"${cleanText(column)}"`).join(','));
  return csvRows.join('\n');
}

module.exports = {
  cleanText, 
  jsonToCsv,
};