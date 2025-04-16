const gplay = require("google-play-scraper");
const { cleanText, jsonToCsv } = require("../utilities/jsonToCsv");
const permissionsController = require("./permissionsController");
const standardPermissionsList = require("./permissionsConfig");
const json_raw = require("../package.json");
const nodeTTL = require("node-ttl");
var node_ttl = new nodeTTL();

const cors = require("cors");
const path = require("path");
const file_name = path.basename(__filename);

const { Worker } = require("bullmq");
const { cacheService, queues, redisConnection } = require("../bullMQConfig");

const MAX_APPS_COUNT = 1000000;
const fetchList = async (collection, category, num, country) => {
    options = {
        category: category,
        collection: collection,
        lang: "en",
        country: country,
        num: num,
        fullDetail: true,
    };

    try {
        let numAppsToFetch = num && num < MAX_APPS_COUNT ? num : MAX_APPS_COUNT;
        console.log(options);
        const toplist = await gplay.list(options);

        for (const result of toplist) {
            console.log(`[%s] App Title: %s\n`, file_name, result.title);
        }

        if (toplist.length > numAppsToFetch) {
            toplist = toplist.slice(0, numAppsToFetch);
        }

        return toplist;
    } catch (error) {
        console.error("Error scraping top list.", error);
        throw new Error("An error occurred while scraping for top list.");
    }
};

const scrapeList = async (req, res) => {
    console.log("Received Top List Scrape Request");
    const collection = req.query.collection;
    const category = req.query.category;
    const country = req.query.country;
    const num = req.query.num ? req.query.num : MAX_APPS_COUNT;
    const permissions = req.query.includePermissions;

    // Check there is an app id
    if (!category) {
        console.error("Missing category");
        return res.status(400).json({ error: "Category is missing.\n" });
    }

    const cacheKey = `play:toplist:${collection}:${category}:${country}:${num}:${permissions}`;

    // Add job to the queue
    const job = await queues.topList.add(cacheKey, {
        collection: collection,
        category: category,
        country: country,
        num: num,
        permissions: permissions,
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

const topListWorkers = [];

// Create multiple workers processing the same queue
for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(
        "toplist-queue",
        async (job) => {
            const { collection, category, country, num, permissions } = job.data;

            // Generate cache key
            const cacheKey = `play:toplist:${collection}:${category}:${country}:${num}:${permissions}`;
            console.log(`Checking cache for ${cacheKey}...`);

            // Check if result exists in cache
            const cachedResult = await cacheService.get(cacheKey);
            if (cachedResult) {
                console.log("Cache hit!");
                return cachedResult;
            }

            const query = collection.concat(category, country);

            try {
                // Fetch top list based on the count or the maximum limit
                const toplist = await fetchList(collection, category, num, country);
                console.log(`Scraped Top ${toplist.length} Apps for ${collection} and ${category}`);

                const cleanedTopListResults = toplist.map((result) => {
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

                if (permissions) {
                    // If includePermissions is true, call the fetchPermissions function
                    console.log("Calling fetchPermissions method");
                    const permissionsResults = await permissionsController.fetchPermissions(toplist);

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
                    resultsToSend = cleanedTopListResults;
                    csvData = toplist;
                }

                node_ttl.push(query, csvData, null, 604800);
                console.log(query);
                console.log("CSV stored on backend");

                return {
                    totalCount: resultsToSend.length,
                    results: resultsToSend,
                };
            } catch (error) {
                console.error("Error getting top list:", error);
                throw error;
            }
        },
        {
            connection: redisConnection,
            name: `toplist-worker-${i}`,
            limiter: {
                max: 20,
                duration: 60000,
            },
        }
    );

    worker.on("completed", async (job, result) => {
        console.log(`Review job ${job.id} completed`);

        // Cache the result
        const cacheKey = `play:toplist:${job.data.collection}:${job.data.category}:${job.data.country}:${job.data.num}:${job.data.permissions}`;
        console.log(`Adding ${cacheKey} to cache...`);
        await cacheService.set(cacheKey, result, 3600); // Cache for 1 hour
    });

    worker.on("failed", (job, err) => {
        console.error(`Worker ${worker.name} failed job ${job.id} with error:`, err);
    });

    topListWorkers.push(worker);
}

const downloadTopChartsRelog = (req, res) => {
    // creating a log file
    // SMAR Version Number, Time/Date, Search Term, # Apps Scraped, Options Selected,
    // Info text, Reviews Log?
    cors()(req, res, () => {
        try {
            const logInfo = {
                version: json_raw.version,
                date_time: new Date(),
                store: "Google Play Store",
                country: req.query.country,
                collection: req.query.collection,
                category: req.query.category,
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

const downloadTopChartsCSV = (req, res) => {
    // Use cors middleware for downloadCSV route
    cors()(req, res, () => {
        if (!csvData) {
            return res.status(404).json({ error: "CSV data not available." });
        }

        try {
            // Use the existing jsonToCsv method to convert JSON to CSV
            const query = req.query.query;
            const permissions = req.query.includePermissions === "true";
            console.log("Query used for CSV: %s\n", query);
            var csvInfo = node_ttl.get(query);
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

            // Set response headers for CSV download
            res.setHeader("Content-Disposition", `attachment; filename="${suggestedFilename}"`);
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
    scrapeList,
    downloadTopChartsCSV,
    downloadTopChartsRelog,
};
