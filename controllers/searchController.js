const natural = require('natural');
const { search, app } = require("google-play-scraper");
const { cleanText, jsonToCsv } = require('../utilities/jsonToCsv');

// Calculate similarity
function calculateJaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  const similarity = intersection.size / union.size;
  return similarity;
}

// Calculate similarity score for search results
function calculateSimilarityScore(query, result) {
  const tokenizer = new natural.WordTokenizer();
  const queryTokens = new Set(tokenizer.tokenize(query.toLowerCase()));
  const resultTokens = new Set(tokenizer.tokenize(result.toLowerCase()));
  const similarity = calculateJaccardSimilarity(queryTokens, resultTokens);
  return similarity;
}

let csvData;
let globalQuery;

const searchController = async (query) => {
  if (!query) {
    throw new Error("Search query is missing.");
  }

  globalQuery = query;

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
          return { ...appInfo, ...appDetails };
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
      throw new Error(`Search for '${query}' did not return any results.`);
    }

    csvData = uniqueResults;

    // Limit the unique results to the first 5 for the response
    const limitedUniqueResults = uniqueResults.slice(0, 5);

    if (limitedUniqueResults.length === 0) {
      throw new Error(`Search for '${query}' did not return any results.`);
    }

    // Apply cleanText to the summary property of each result
    const cleanedLimitedResults = limitedUniqueResults.map((result) => {
      if (result.summary) {
        result.summary = cleanText(result.summary);
      }

      // Calculate similarity score and add it to the result object
      result.similarityScore = calculateSimilarityScore(globalQuery, result.title + ' ' + result.description);

      return result;
    });

    return { totalCount: uniqueResults.length, results: cleanedLimitedResults };
  } catch (error) {
    console.error("Error occurred during search:", error);
    throw new Error("An error occurred while processing your request.");
  }
};

const downloadCSV = (req, res) => {
  // Use cors middleware for downloadCSV route
  cors()(req, res, () => {
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
  });
};

module.exports = {
  search: searchController,
  downloadCSV,
};