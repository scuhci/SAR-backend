const natural = require("natural");
const { search, app } = require("google-play-scraper");
const { cleanText, jsonToCsv } = require("../utilities/jsonToCsv");
const permissionsController = require("./permissionsController");
const standardPermissionsList = require("./permissionsConfig");
const json_raw = require("../package.json");

const path = require("path");
const file_name = path.basename(__filename);
const cors = require("cors");
const { Worker } = require("bullmq");
const { cacheService, queues, redisConnection } = require("../bullMQConfig");

let csvData;

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
function calculateResultSimilarityScore(result, query) {
    result.similarityScore = calculateSimilarityScore(query, result.title);
    return result;
}

const newSearchController = async (req, res) => {
    const query = req.query.query;
    const permissions = req.query.includePermissions === "true";
    const country = req.query.countryCode;

    // Check there is a query
    if (!query) {
        console.error("Missing search query");
        return res.status(400).json({ error: "Search query is missing.\n" });
    }

    const cacheKey = `play:search:${country}:${query}:${permissions}`;

    // Add job to the queue
    const job = await queues.search.add(cacheKey, {
        query: query,
        permissions: permissions,
        country: country,
    });

    // Return job ID to client
    res.json({
        status: "processing",
        jobId: job.id,
        message: "Your search is being processed. Use the job ID to check status.",
    });
};

// The number of concurrent workers
const WORKER_COUNT = 1;

const searchWorkers = [];

// Create multiple workers processing the same queue
for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(
        "search-queue",
        async (job) => {
            const { query, permissions, country } = job.data;

            // Generate cache key
            const cacheKey = `play:search:${country}:${query}:${permissions}`;
            console.log(`Checking cache for ${cacheKey}...`);

            // Check if result exists in cache
            const cachedResult = await cacheService.get(cacheKey);
            if (cachedResult) {
                console.log("Cache hit!");
                return {
                    fromCache: true,
                    totalCount: cachedResult.totalCount,
                    results: cachedResult.results,
                };
            }

            const mainResults = await search({ term: query, country: country, throttle: 10 });
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
                    console.log("[%s] Main Title Fetched: %s\n", `search-worker-${i}`, mainResult.title);
                    const relatedQuery = `related to ${mainResult.title}`;
                    relatedResults.push(await search({ term: relatedQuery, country: country, throttle: 10 }));

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

            // Fetch additional details (including genre) for each result
            const detailedResults = await Promise.all(
                allResults.map(async (appInfo) => {
                    try {
                        await new Promise((resolve) => setTimeout(resolve, 3000));
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

            // Remove duplicates based on appId
            const uniqueResults = Array.from(new Set(validResults.map((appInfo) => appInfo.appId))).map((appId) => {
                return validResults.find((appInfo) => appInfo.appId === appId);
            });

            if (uniqueResults.length === 0) {
                throw new Error(`Search for '${query}' did not return any results.`, { status: 500 });
            }

            // Calculate similarity score for all unique results
            const resultsWithSimilarityScore = uniqueResults.map((result) =>
                calculateResultSimilarityScore(result, query)
            );

            if (resultsWithSimilarityScore.length === 0) {
                throw new Error(`Search for '${query}' did not return any results.`, { status: 500 });
            }

            // Apply cleanText to the summary and recentChanges properties of each result
            const cleanedLimitedResults = resultsWithSimilarityScore.map((result) => {
                // Clean the summary column
                if (result.summary) {
                    result.summary = cleanText(result.summary);
                }

                // Clean the recentChanges column
                if (result.recentChanges) {
                    result.recentChanges = cleanText(result.recentChanges);
                }

                return result;
            });

            // Check if includePermissions is true
            if (permissions) {
                // If includePermissions is true, call the fetchPermissions function
                console.log("Calling fetchPermissions method");
                const permissionsResults = await permissionsController.fetchPermissions(uniqueResults);

                // Process permissions data for the sliced 5 results
                const processedPermissionsResults = permissionsResults.map((appInfo) => {
                    const permissionsWithSettings = standardPermissionsList.map((permission) => ({
                        permission: permission,
                        // type: permission.type,
                        isPermissionRequired: appInfo.permissions.some(
                            (appPermission) => appPermission.permission === permission
                        )
                            ? true
                            : false,
                    }));

                    // Return appInfo with permissions
                    return { ...appInfo, permissions: permissionsWithSettings };
                });

                resultsToSend = processedPermissionsResults;
                csvData = permissionsResults;
            } else {
                resultsToSend = cleanedLimitedResults;
                csvData = uniqueResults;
            }

            const pushQuery = "c:" + country + "_t:" + query; // new relog key since results are based on country + search query now
            // we want users to get the CSV results corresponding to their entire search, so an update was necessary
            node_ttl.push(pushQuery, csvData, null, 604800); // 1 week
            console.log("CSV stored on backend");

            // Return the result
            return {
                fromCache: false,
                totalCount: uniqueResults.length,
                results: resultsToSend,
            };
        },
        {
            connection: redisConnection,
            name: `search-worker-${i}`,
            limiter: {
                max: 20,
                duration: 60000,
            },
        }
    );

    worker.on("completed", async (job, result) => {
        console.log(`Search job ${job.id} completed`);

        // Cache the result
        if (result.fromCache) {
            console.log(`Job ${job.id} came from cache — skipping cache write.`);
            return;
        }

        cacheResult = {
            totalCount: result.totalCount,
            results: result.results,
        };
        const cacheKey = `play:search:${job.data.country}:${job.data.query}:${job.data.permissions}`;
        console.log(`Adding ${cacheKey} to cache...`);
        await cacheService.set(cacheKey, cacheResult, 3600); // Cache for 1 hour
    });

    worker.on("failed", (job, err) => {
        console.error(`Worker ${worker.name} failed job ${job.id} with error:`, err);
    });

    searchWorkers.push(worker);
}

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
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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
            const csv = jsonToCsv(csvInfo, "app", standardPermissionsList, permissions);
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
            const dateComponents = timestamp.split("/").map((component) => component.trim());
            const timeComponents = dateComponents[2].split(",").map((component) => component.trim());

            // Format the timestamp without spaces
            const formattedTimestamp = `${dateComponents[0]}${dateComponents[1]}${timeComponents[0]}`;

            // Suggest a filename to the browser
            const suggestedFilename = `${query}_${formattedTimestamp}.csv`;
            res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

            res.setHeader("Content-Type", ["text/csv", "charset=utf-8"]);

            // Set response headers for CSV download
            res.setHeader("Content-Disposition", `attachment; filename="${encodeURI(suggestedFilename)}"`);

            // Send the CSV data as a response
            res.status(200).send(csv);
        } catch (error) {
            console.error("Error generating CSV:", error);
            res.status(500).send("An error occurred while generating the CSV.");
        }
    });
};

module.exports = {
    newSearchController,
    downloadCSV,
    downloadRelog,
};
