const { jsonToCsv } = require('../utilities/jsonToCsv');

const downloadCSV = (req, res, csvData, globalQuery, standardPermissionsList) => {
    if (!csvData) {
      return res.status(404).json({ error: "CSV data not available." });
    }
    try {
      // Use the existing jsonToCsv method to convert JSON to CSV
      const csv = jsonToCsv(csvData);
      // Get the current timestamp in the desired format
      const timestamp = new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      });

    // Extract date and time components and remove spaces
    const dateComponents = timestamp.split('/').map(component => component.trim());
    const timeComponents = dateComponents[2].split(',').map(component => component.trim());

    // Format the timestamp without spaces
    const formattedTimestamp = `${dateComponents[0]}${dateComponents[1]}${timeComponents[0]}`;

    // Suggest a filename to the browser
    const suggestedFilename = `${globalQuery}_${formattedTimestamp}.csv`;

    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // Set response headers for CSV download
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${suggestedFilename}"`
    );
    res.setHeader("Content-Type", "text/csv");

    // Send the CSV data as a response
    res.status(200).send(csv);
  } catch (error) {
    console.error("Error generating CSV:", error);
    res.status(500).send("An error occurred while generating the CSV.");
  }

};

// Add standard permissions as columns to each app in csvData
const addStandardPermissions = (csvData, standardPermissions) => {
  return csvData.map(app => {
    const permissions = app.permissions.map(permission => permission.permission);
    const appStandardPermissions = standardPermissions.map(standardPermission => {
      return permissions.includes(standardPermission);
    });
    return { ...app, ...appStandardPermissions };
  });
};

module.exports = {
  downloadCSV,
};