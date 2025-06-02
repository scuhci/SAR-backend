const natural = require("natural");
const { search, app } = require("google-play-scraper");
const { cleanText, jsonToCsv } = require("../utilities/jsonToCsv");
const permissionsController = require("./permissionsController");
const standardPermissionsList = require("./permissionsConfig");
const json_raw = require("../package.json");
const nodeTTL = require("node-ttl");
var node_ttl = new nodeTTL();

const path = require("path");
const file_name = path.basename(__filename);
const cors = require("cors");
const { globalAgent } = require("node:https");
const router = require("../routes/searchRoutes");

let csvData;
let globalQuery;
let emailMappings = {};

// Calculate similarity
function calculateJaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
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

// Calculate similarity score and add it to the result object
function calculateResultSimilarityScore(result) {
  result.similarityScore = calculateSimilarityScore(globalQuery, result.title);
  return result;
}

const searchController = async (req, res) => {
  const query = req.query.query;
  const permissions = req.query.includePermissions === "true"
  const country = req.query.countryCode;
  const time = req.query.time;
  // console.log("[%s] Query Passed: %s\n", file_name, query);
  // console.log("[%s] Country Code Passed: %s\n", file_name, country);

  res.set("Access-Control-Allow-Origin", "*");

  if (!query) {
    console.error("Missing search query");
    return res.status(400).json({ error: "Search query is missing.\n" });
  }
  try {
    const mainResults = await search({ term: query, country: country });
    const relatedResults = [];
    // if an appID is passed as the query
    try {
      const fetched_appID = await app({ appId: query, country: country }); // checking if our query is a valid app ID
      console.log("App ID passed\n");
      mainResults.splice(0, mainResults.length, fetched_appID);
    } catch (error) {
      // Secondary search for each primary result if required
      console.log("App ID not passed\n");
      for (const mainResult of mainResults) {
        console.log(
          "[%s] Main Title Fetched: %s\n",
          file_name,
          mainResult.title
        );
        const relatedQuery = `related to ${mainResult.title}`;
        relatedResults.push(
          await search({ term: relatedQuery, country: country })
        );

        // Introduce a delay between requests (e.g., 1 second)
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    // Combine the main and secondary results
    const allResults = [
      ...mainResults.map((result) => ({
        ...result,
        country: country,
        source: "primary search",
      })),
      ...relatedResults.flatMap((results) =>
        results.map((result) => ({
          ...result,
          country: country,
          source: "related app",
        }))
      ),
    ];

    console.log(
      "[%s] [%d] allResults:\n-------------------------\n",
      file_name,
      allResults.length
    );
    for (const result of allResults) {
      console.log("[%s] %s\n", file_name, result.title);
    }
    console.log("All results fetched\n");
    // Fetch additional details (including genre) for each result
    const detailedResults = await Promise.all(
      allResults.map(async (appInfo) => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const appDetails = await app({
            appId: appInfo.appId,
            country: country,
          });
          return { ...appInfo, ...appDetails };
        } catch (error) {
          console.error("Error fetching app details:", error);
          return null;
        }
      })
    );

    // Filter out apps with missing details
    const validResults = detailedResults.filter((appInfo) => appInfo !== null);

    console.log(
      "[%s] [%d] validResults:\n-------------------------\n",
      file_name,
      validResults.length
    );
    for (const result of validResults) {
      console.log("[%s] %s\n", file_name, result.title);
    }

    // Remove duplicates based on appId
    const uniqueResults = Array.from(
      new Set(validResults.map((appInfo) => appInfo.appId))
    ).map((appId) => {
      return validResults.find((appInfo) => appInfo.appId === appId);
    });

    if (uniqueResults.length === 0) {
      throw new Error(`Search for '${query}' did not return any results.`);
    }

    // Calculate similarity score for all unique results
    globalQuery = query;
    const resultsWithSimilarityScore = uniqueResults.map(
      calculateResultSimilarityScore
    );

    console.log(
      "[%s] [%d] results shown on SMAR Website:\n-------------------------\n",
      file_name,
      resultsWithSimilarityScore.length
    );
    for (const result of resultsWithSimilarityScore) {
      console.log(
        "[%s] Title: %s, Similarity Score: %d\n",
        file_name,
        result.title,
        result.similarityScore
      );
    }

    if (resultsWithSimilarityScore.length === 0) {
      throw new Error(`Search for '${query}' did not return any results.`);
    }

    // Apply cleanText to the summary and recentChanges properties of each result
    const cleanedLimitedResults = resultsWithSimilarityScore.map(
      (result) => {
        // Clean the summary column
        if (result.summary) {
          result.summary = cleanText(result.summary);
        }

        // Clean the recentChanges column
        if (result.recentChanges) {
          result.recentChanges = cleanText(result.recentChanges);
        }

        return result;
      }
    );

    // Check if includePermissions is true
    if (permissions) {
      // If includePermissions is true, call the fetchPermissions function
      console.log("Calling fetchPermissions method");
      const permissionsResults = await permissionsController.fetchPermissions(
        uniqueResults
      );

      // Process permissions data for the sliced 5 results
      const processedPermissionsResults = permissionsResults.map(
        (appInfo) => {
          const permissionsWithSettings = standardPermissionsList.map(
            (permission) => ({
              permission: permission,
              // type: permission.type,
              isPermissionRequired: appInfo.permissions.some(
                (appPermission) => appPermission.permission === permission
              )
                ? true
                : false,
            })
          );

          // Return appInfo with permissions
          return { ...appInfo, permissions: permissionsWithSettings };
        }
      );

      resultsToSend = processedPermissionsResults;
      csvData = permissionsResults;
    } else {
      resultsToSend = cleanedLimitedResults;
      csvData = uniqueResults;
    }

    console.log(
      "[%s] [%d] entries to be forwarded to CSV:\n-------------------------\n",
      file_name,
      csvData.length
    );
    for (const result of csvData) {
      console.log("[%s] %s\n", file_name, result.title);
    }
    const pushQuery = "c:" + country + "_t:" + query + "_p:" + permissions + "_t:" + time; // new relog key since results are based on country + permissions + search query now
    // we want users to get the CSV results corresponding to their entire search, so an update was necessary
    console.log("Raphtest", pushQuery)
    node_ttl.push(pushQuery, csvData, null, 604800); // 1 week
    console.log("CSV stored on backend");
    return res.json({
      totalCount: uniqueResults.length,
      results: resultsToSend,
    });
  } catch (error) {
    console.error("Error occurred during search:", error);
    return res
      .status(500)
      .json({ error: "An error occurred while processing your request." });
  }
};

const downloadRelog = (req, res) => {
  // creating a log file
  // SMAR Version Number, Time/Date, Search Term, # Apps Scraped, Options Selected,
  // Info text, Reviews Log?
  cors()(req, res, () => {
    try {
      const logInfo = {
        version: json_raw.version,
        date_time: new Date(),
        store: "Google Play Store",
        country: req.query.countryCode,
        search_query: req.query.query,
        num_results: req.query.totalCount,
        permissions: req.query.includePermissions,
        info: "This search was performed using the SMAR tool: www.smar-tool.org. This reproducibility log can be used in the supplemental materials of a publication to allow other researchers to reproduce the searches made to gather these results.",
      };
      // Implement store and country when applicable
      // Also, add additional options when applicable
      const logInfo_arr = Object.entries(logInfo);
      for (var i = 0; i < logInfo_arr.length; i++) {
        logInfo_arr[i] = logInfo_arr[i].join(": ");
      }
      const fileText = logInfo_arr.join("\n");
      console.log(fileText);
      const filename = "Reproducibility_Log_" + logInfo["query"];
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Content-Type", "text/plain");
      res.send(fileText);
    } catch (error) {
      console.error("Error generating relog file:", error);
      res.status(500).send("An error occurred while generating the relog.");
    }
  });
};

const downloadCSV = (req, res) => {
  // Use cors middleware for downloadCSV route
  cors()(req, res, () => {
    if (!csvData) {
      return res.status(404).json({ error: "CSV data not available." });
    }

    try {
      // Use the existing jsonToCsv method to convert JSON to CSV
      const query = req.query.query;
      const permissions = req.query.includePermissions === "true";
      const country = req.query.countryCode;
      const pushQuery = "c:" + country + "_t:" + query + "_p:" + permissions; // to retrieve the csv information from node_ttl
      console.log("pushQuery used for CSV: %s\n", pushQuery);
      var csvInfo = node_ttl.get(pushQuery); // now that we're separating searches by country, we want to make sure users get the CSV response from the country they searched for
      const csv = jsonToCsv(
        csvInfo,
        "app",
        standardPermissionsList,
        permissions
      );
      // Get the current timestamp in the desired format
      const timestamp = new Date().toLocaleString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      });

      // Extract date and time components and remove spaces
      const dateComponents = timestamp
        .split("/")
        .map((component) => component.trim());
      const timeComponents = dateComponents[2]
        .split(",")
        .map((component) => component.trim());

      // Format the timestamp without spaces
      const formattedTimestamp = `${dateComponents[0]}${dateComponents[1]}${timeComponents[0]}`;

      // Suggest a filename to the browser
      const suggestedFilename = `${query}_${formattedTimestamp}.csv`;
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      
      res.setHeader("Content-Type", ["text/csv", "charset=utf-8"]);

      // Set response headers for CSV download
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURI(suggestedFilename)}"`
      );

      // Send the CSV data as a response
      res.status(200).send(csv);
    } catch (error) {
      console.error("Error generating CSV:", error);
      res.status(500).send("An error occurred while generating the CSV.");
    }
  });
};

const addEmailNotification = (req, res) => {
  cors()(req, res, () => {
    try {
      const queryId = req.query?.queryId;
      const email = req.query?.email;

      if (!queryId || !email)
        return res.status(400).json({status: "error", message: "uh oh, queryId or email wasn't processed right"});
      
      emailMappings[queryId] = email;

      // then we leave and process the email sometime?
    }
    catch (e) {
      console.log("Failed to add email", e);
      res.status(500).json({status: "error", message: e});
    }
  })
}

module.exports = {
  search: searchController,
  downloadCSV,
  downloadRelog,
  addEmailNotification,
};
