const { permissions: fetchPermissionsFromGooglePlay } = require('app-store-scraper');

const fetchPermissions = async (results) => {
  try {
    const permissionsResults = await Promise.all(results.map(async (appInfo) => {
      try {
        const appPermissions = await fetchPermissionsFromGooglePlay({ appId: appInfo.appId, lang: 'en', country: 'us' });

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
    }));

    return permissionsResults;
  } catch (error) {
    console.error('Error occurred during permissions fetch:', error);
    throw new Error('An error occurred while fetching permissions.');
  }
};

module.exports = {
  fetchPermissions,
};