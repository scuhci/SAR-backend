const { search, app } = require('google-play-scraper');

const searchController = async (req, res) => {
  const query = req.query.query;

  res.set('Access-Control-Allow-Origin', '*');
  
  if (!query) {
    return res.status(400).json({ error: 'Search query is missing.' });
  }

  try {
    // Search for the main query
    const mainResults = await search({ term: query });

    // Perform a secondary search for each primary result
    const relatedResults = [];
    for (const mainResult of mainResults) {
      const relatedQuery = `related to ${mainResult.title}`;
      const secondaryResults = await search({ term: relatedQuery });
      relatedResults.push(...secondaryResults);
    }

    // Combine the main and secondary results
    const allResults = [...mainResults, ...relatedResults];

    // Fetch additional details (including genre) for each result
    const detailedResults = await Promise.all(
      allResults.map(async (appInfo) => {
        try {
          const appDetails = await app({ appId: appInfo.appId });
          return {
            title: appInfo.title,
            appId: appInfo.appId,
            url: appInfo.url,
            icon: appInfo.icon,
            developer: appInfo.developer,
            // adding app genre as the category and installs count to the json result
            category: appDetails.genre || 'Unknown',
            installs: appDetails.installs,
          };
        } catch (error) {
          console.error('Error fetching app details:', error);
          return null;
        }
      })
    );

    // Filter out apps with missing details
    const validResults = detailedResults.filter((appInfo) => appInfo !== null);

    // Remove duplicates based on appId
    const uniqueResults = Array.from(new Set(validResults.map((appInfo) => appInfo.appId))).map((appId) => {
      return validResults.find((appInfo) => appInfo.appId === appId);
    });

    if (uniqueResults.length === 0) {
      return res
        .status(404)
        .json({ message: `Search for '${query}' did not return any results.` });
    }

    // Include totalCount and results in the response
    const totalCount = uniqueResults.length;
    res.json({ totalCount, results: uniqueResults });
  } catch (error) {
    console.error('Error occurred during search:', error);
    res
      .status(500)
      .json({ error: 'An error occurred while processing your request.' });
  }
};

module.exports = {
  search: searchController,
};