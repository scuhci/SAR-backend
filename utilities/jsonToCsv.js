// Turn an HTML field from google-play-scraper (summary, recentChanges) into the
// single-line plain text shown on the website and written to the CSV. The
// controllers call this once per field; it does not do any CSV escaping.
function htmlToText(html) {
  if (typeof html !== 'string') {
    return html;
  }

  return html
  .replace(/<br\s*\/?>/gi, ' ') // HTML line breaks become spaces
  .replace(/<[^>]+>/g, '') // Remove the remaining HTML tags
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&') // last, so "&amp;lt;" stays "&lt;"
  .replace(/\r?\n|\r/g, ' '); // Other line breaks become spaces
}

// Prepare one value for a double-quoted CSV cell: double the quotes and
// flatten line breaks. It does not touch HTML; the controllers have already
// turned the HTML fields into plain text, and every other field is plain text.
function cleanText(text) {
  if (typeof text !== 'string') {
    return text;
  }

  return text
  .replace(/"/g, '""') // Escape double quotes within the text
  .replace(/\r?\n|\r/g, ' '); // Replace line breaks with spaces
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

// Fixed column order for each CSV, by scraper field name (fixColumns renames
// them afterwards). This is the order documented in the User Guide, which is
// also what keyword searches have always produced.
const appColumnOrder = [
  'title',
  'appId',
  'url',
  'icon',
  'developer',
  'developerId',
  'currency',
  'price',
  'summary',
  'score',
  'country',
  'source',
  'maxInstalls',
  'ratings',
  'reviews',
  'originalPrice',
  'discountEndDate',
  'available',
  'offersIAP',
  'IAPRange',
  'androidVersion',
  'developerEmail',
  'developerWebsite',
  'developerAddress',
  'privacyPolicy',
  'genreId',
  'contentRating',
  'adSupported',
  'released',
  'version',
  'recentChanges',
];
const reviewsColumnOrder = [
  'id',
  'date',
  'score',
  'url',
  'text',
  'replyDate',
  'replyText',
  'version',
  'thumbsUp',
  'country',
];

// Put the columns in the fixed order; a field the order does not know about
// keeps its place after the known ones.
function orderColumns(columns, source)
{
  const order = source == 'reviews' ? reviewsColumnOrder : appColumnOrder;
  return [
    ...order.filter(column => columns.includes(column)),
    ...columns.filter(column => !order.includes(column)),
  ];
}

function jsonToCsv(jsonData, source, standardPermissionsList, includePermissions = false) {
  const csvRows = [];
  const currentTime = new Date();

  // console.log(jsonData);

  // Collect the column headers from every row, so a field missing from the
  // first row is not dropped from the others
  let columns = [];
  for (const row of jsonData) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
  }

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
    'androidVersionText',
    'histogram',
    'minInstalls',
    'priceText',
    'description',
    'categories',
    'preregister',
    'earlyAccessEnabled',
    'isAvailableInPlayPass',
    'similarityScore',
    'permissions', //This is the permissions data structure, which has a child object that contains individual permissions and their labels 
    //individual permissions and labels are added separately
  ];
  // for reviews, 'title' is removed, so we account for that here
  if(source == 'reviews')
  {
    columnsToExclude.push('title');
  }
  // Remove excluded columns
  columns = columns.filter(column => !columnsToExclude.includes(column));
  columns = orderColumns(columns, source);
  columns.push('dateScraped'); // adding this to list the timestamp the data was scraped at
  // Add standard permissions columns if includePermissions is true
  if (includePermissions) {
    columns = [...columns, ...standardPermissionsList];
  }

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
      } else if (source == 'app' && standardPermissionsList.includes(column)) {
        const permission = row.permissions.find(p => p.permission === column);
        rowValues.push(permission ? true : false);
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
  htmlToText,
  cleanText, 
  jsonToCsv,
};