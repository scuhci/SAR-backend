const { permissions: fetchPermissionsFromGooglePlay } = require('google-play-scraper');
const { REQUEST_OPTIONS, withRetry, mapWithConcurrency } = require('../utilities/storeRequests');

// Fetch permissions for each app, at most `concurrency` requests at a time,
// starting or retrying none after `deadline` (a Date.now() timestamp).
const fetchPermissions = async (results, { concurrency = 4, deadline = Infinity } = {}) => {
  try {
    const permissionsResults = await mapWithConcurrency(results, concurrency, async (appInfo) => {
      try {
        const appPermissions = await withRetry(
          () => fetchPermissionsFromGooglePlay({ appId: appInfo.appId, lang: 'en', country: 'us', requestOptions: REQUEST_OPTIONS }),
          { deadline },
        );

        // Map permission items to the desired structure
        const permissions = appPermissions.map(permission => ({
          permission: permission.permission,
          type: permission.type,
        }));

        // Append permission details to the appInfo
        return { ...appInfo, permissions: permissions };
      } catch (error) {
        console.error(`Error fetching permissions for app (${appInfo.appId}):`, error);
        return { ...appInfo, permissions: [] };
      }
    });

    return permissionsResults;
  } catch (error) {
    console.error('Error occurred during permissions fetch:', error);
    throw new Error('An error occurred while fetching permissions.');
  }
};

module.exports = {
  fetchPermissions,
};