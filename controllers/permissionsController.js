const standardPermissions = require('./permissionsConfig');
const { permissions: fetchPermissionsFromGooglePlay, search } = require('google-play-scraper');
const searchController = require('./searchController');

const fetchPermissions = async (req, res) => {
  const query = req.query.query;
  const includePermissions = req.query.includePermissions === 'true';

  res.set('Access-Control-Allow-Origin', '*');

  if (!query) {
    return res.status(400).json({ error: 'Search query is missing.' });
  }

  try {
    // Search based on the query using searchController
    const { totalCount, results: searchResults } = await searchController.search(query);

    if (includePermissions) {
      // Fetch permissions for each search result
      const permissionsResults = await Promise.all(searchResults.map(async (appInfo) => {
        try {
          const appPermissions = await fetchPermissionsFromGooglePlay({ appId: appInfo.appId, lang: 'en', country: 'us' });

          // Map permission items to the desired structure
          const labeledPermissions = appPermissions.map(permission => ({
            permission: permission.permission,
            type: permission.type,
            needsPermission: standardPermissions.includes(permission.permission),
          }));

          // Append permission details to the appInfo
          return { ...appInfo, permissions: labeledPermissions };
        } catch (error) {
          console.error(`Error fetching permissions for app (${appInfo.appId}):`, error);
          return { ...appInfo, permissions: [] };
        }
      }));

      // Send response with total count of search results and permissions results
      res.json({ totalCount, results: permissionsResults });
    } else {
      // If includePermissions is false, return only search results
      res.json({ totalCount, results: searchResults });
    }
  } catch (error) {
    console.error('Error occurred during permissions fetch:', error);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
};

module.exports = {
  fetchPermissions,
};