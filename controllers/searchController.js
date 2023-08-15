const { search } = require('google-play-scraper');

const searchController = async (req, res) => {
  const query = req.query.query;

  res.set('Access-Control-Allow-Origin', '*');
  
  if (!query) {
    return res.status(400).json({ error: 'Search query is missing.' });
  }

  try {
    // Search for the main query
    const mainResults = await search({ term: query});

    // Get related apps by searching for the query with a prefix (e.g., "related to")
    const relatedResults = await search({ term: `related to ${query}`});

    // Merge the main and related results
    const allResults = [...mainResults, ...relatedResults];

    // Sort the merged results based on popularity
    allResults.sort((a, b) => b.downloads - a.downloads);

    if (!allResults || !Array.isArray(allResults) || allResults.length === 0 ) {
      return res.status(404).json({ message: `Search for '${query}' did not return any results.` });
    }

    res.json(allResults);
  } catch (error) {
    console.error('Error occurred during search:', error);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
};

module.exports = {
  search: searchController,
};