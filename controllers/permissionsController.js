const standardPermissions = require('./permissionsConfig');
const { permissions: fetchPermissionsFromGooglePlay, search } = require('google-play-scraper');
const path = require('path');
const file_name = path.basename(__filename);

const searchController = require('./searchController');

const fetchPermissions = async (req, res) => {
  const query = req.query.query;
  const includePermissions = req.query.includePermissions === 'true';
  
  console.log('[%s] Query Passed: %s', file_name, query);

  res.set('Access-Control-Allow-Origin', '*');

    if (!query) {
        return res.status(400).json({ error: 'Search query is missing.' });
    }
    
    try {
        // Search for the main query
        console.log('[%s] Permissions query: %s', file_name, query)
        const results = await permissions({ appId: query, lang: 'en', country: 'us' }).then(console.log);;

        if (!results || !Array.isArray(results) || results.length === 0 ) {
            return res.status(404).json({ message: `Search for '${query}' did not return any results.` });
        }

        res.json(results);
    } catch (error) {
        console.error('Error occurred during search:', error);
        res
          .status(500)
          .json({ error: 'An error occurred while processing your request.' });
    }
};

module.exports = {
  fetchPermissions,
};