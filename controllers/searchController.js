const { search, app } = require("google-play-scraper");
const fs = require("fs");
const jsonToCsv = require("../utilities/jsonToCsv");

let csvData;

const searchController = async (req, res) => {
  const query = req.query.query;

  res.set("Access-Control-Allow-Origin", "*");

  if (!query) {
    return res.status(400).json({ error: "Search query is missing." });
  }

  try {
    // Search for the main query
    const mainResults = await search({ term: query });

    // Perform a secondary search for each primary result
    const relatedResults = [];
    for (const mainResult of mainResults) {
      const relatedQuery = `related to ${mainResult.title}`;
      relatedResults.push(await search({ term: relatedQuery }));
      // Introduce a delay between requests (e.g., 1 second)
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // Combine the main and secondary results
    const allResults = [
      ...mainResults.map((result) => ({ ...result, source: "primary search" })),
      ...relatedResults.flatMap((results) =>
        results.map((result) => ({ ...result, source: "related app" }))
      ),
    ];

    // Fetch additional details (including genre) for each result
    const detailedResults = await Promise.all(
      allResults.map(async (appInfo) => {
        try {
          // Introduce a delay between requests
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const appDetails = await app({ appId: appInfo.appId });
          return {
            title: appInfo.title,
            appId: appInfo.appId,
            url: appInfo.url,
            developer: appInfo.developer,
            // developerId: appInfo.developerId, // extra dev info
            summary: appInfo.summary,
            score: appInfo.score,
            scoreText: appInfo.scoreText, // extra score info
            // adding price info
            free: appInfo.free,
            // price: appInfo.priceText,
            // adding app genre as the category and installs count to the json result
            category: appDetails.genre || "Unknown",
            installs: appDetails.installs,
            icon: appInfo.icon, // adding icon
            source: appInfo.source,
          };
        } catch (error) {
          console.error("Error fetching app details:", error);
          return null;
        }
      })
    );

    // Filter out apps with missing details
    const validResults = detailedResults.filter((appInfo) => appInfo !== null);

    // Remove duplicates based on appId
    const uniqueResults = Array.from(
      new Set(validResults.map((appInfo) => appInfo.appId))
    ).map((appId) => {
      return validResults.find((appInfo) => appInfo.appId === appId);
    });

    if (uniqueResults.length === 0) {
      return res
        .status(404)
        .json({ message: `Search for '${query}' did not return any results.` });
    }

    csvData = uniqueResults;
    // Include totalCount and results in the response
    const totalCount = uniqueResults.length;
    res.json({ totalCount, results: uniqueResults });
  } catch (error) {
    console.error("Error occurred during search:", error);
    res
      .status(500)
      .json({ error: "An error occurred while processing your request." });
  }
};

const downloadCSV = (req, res) => {
  if (!csvData) {
    return res.status(404).json({ error: "CSV data not available." });
  }

  try {
    // Use the existing jsonToCsv method to convert JSON to CSV
    const csv = jsonToCsv(csvData);

    // Set response headers for CSV download
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=search_results.csv"
    );
    res.setHeader("Content-Type", "text/csv");

    // Send the CSV data as a response
    res.send(csv);
  } catch (error) {
    console.error("Error generating CSV:", error);
    res.status(500).send("An error occurred while generating the CSV.");
  }
};

module.exports = {
  search: searchController,
  downloadCSV,
};