const gplay = require("google-play-scraper");
const { jsonToCsv } = require("../utilities/jsonToCsv");
const cors = require("cors");
const json_raw = require("../package.json");
const nodeTTL = require("node-ttl");
var node_ttl = new nodeTTL();

const MAX_REVIEWS_COUNT = 10000; //Fixed value for now, can be updated for future development

const downloadReviewsRelog = (req, res) => {
    cors()(req, res, () => {
        try {
            // Stored when the scrape finishes: rows written to the CSV, and the
            // review count shown on the app page (for reference only).
            const counts = node_ttl.get("c:" + req.query.countryCode + "_a:" + req.query.appId) || {};
            const logInfo = {
                version: json_raw.version,
                date_time: new Date(),
                store: req.query.store,
                country: req.query.countryCode,
                num_reviews: counts.scraped,
                store_reported_reviews: counts.reported,
                appId: req.query.appId,
                sort: req.query.sorting, // must update when we add different sorting
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

const fetchReviews = async (appId, countryCode) => {
    const options = {
        appId: appId,
        sort: gplay.sort.NEWEST,
        lang: "en",
        country: countryCode,
    };

    try {
        let reviews = [];
        const seenIds = new Set();
        let totalFetched = 0;
        // The app page's review count is not what the store will page out (it can be
        // far lower or higher), so page until the store runs out, up to the cap.
        const numReviews = MAX_REVIEWS_COUNT;
        console.log(`Fetching up to ${numReviews} Reviews for AppId: ${appId}`);

        while (totalFetched < numReviews) {
            const result = await gplay.reviews(options);
            // Drop reviews already collected so a repeated page never adds duplicate rows
            const newData = (result.data || []).filter((review) => {
                if (review.id == null) return true;
                if (seenIds.has(review.id)) return false;
                seenIds.add(review.id);
                return true;
            });

            // Process each review to include the criteria section
            const processedReviews = newData.map((review) => {
                const criterias = review.criterias || []; // Get criterias section
                const criteriaData = criterias
                    .map((criteria) => `criteria: ${criteria.criteria}: rating: ${criteria.rating}`)
                    .join("; "); // Convert criterias to string
                return {
                    ...review,
                    criterias: criteriaData,
                };
            });

            reviews = reviews.concat(processedReviews);
            totalFetched += newData.length;
            console.log(`Total reviews fetched so far: ${totalFetched}`);

            // The store has no more pages when it returns nothing new, no token,
            // or the token just used. Otherwise this loop re-sends a request forever.
            const nextToken = result.nextPaginationToken;
            if (newData.length === 0 || !nextToken || nextToken === options.nextPaginationToken) {
                break;
            }
            options.nextPaginationToken = nextToken;
        }

        if (reviews.length > numReviews) {
            reviews = reviews.slice(0, numReviews);
        }

        return reviews;
    } catch (error) {
        console.error("Error scraping reviews:", error);
        throw new Error("An error occurred while scraping reviews.");
    }
};

const scrapeReviews = async (req, res) => {
    // console.log(req);
    // console.log("\n");
    const appId = req.query.appId;
    const countryCode = req.query.countryCode;
    // console.log("AppID: %s\n", appId);
    // console.log("CountryCode: %s\n", countryCode);

    try {
        // The app page's count is only recorded in the relog; it does not limit the scrape
        const appDetails = await gplay.app({ appId: appId, country: countryCode });
        const reviewsCount = appDetails.reviews;
        console.log(`App page for ${appId} reports ${reviewsCount} reviews`);

        const reviews = await fetchReviews(appId, countryCode);
        console.log(`Received ${reviews.length} reviews for app: ${appId}`);

        // Record what was actually scraped for the relog
        const pushQuery = "c:" + countryCode + "_a:" + appId;
        node_ttl.push(pushQuery, { scraped: reviews.length, reported: reviewsCount }, null, 604800); // 1 week

        console.log("First 10 reviews:");
        for (let i = 0; i < Math.min(10, reviews.length); i++) {
            console.log(JSON.stringify(reviews[i]));
        }

        res.set("Access-Control-Allow-Origin", "*");
        const country_reviews = [...reviews.map((review) => ({ ...review, country: countryCode }))];

        // Convert reviews data to CSV format
        const csvData = jsonToCsv(country_reviews, "reviews");

        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

        // Set response headers for CSV download
        res.setHeader("Content-Disposition", `attachment; filename="${appId}_reviews.csv"`);
        res.setHeader("Content-Type", "text/csv");

        // Send the CSV data as a response
        res.status(200).send(csvData);
    } catch (error) {
        console.error("Error getting reviews:", error);
        res.status(500).json({ error: "An error occurred while getting reviews." });
    }
};

module.exports = {
    scrapeReviews,
    downloadReviewsRelog,
};
