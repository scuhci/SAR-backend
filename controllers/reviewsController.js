const gplay = require("google-play-scraper");
const { Worker } = require("bullmq");
const { cacheService, queues, redisConnection } = require("../bullMQConfig");
const { jsonToCsv } = require("../utilities/jsonToCsv");

const scrapeReviews = async (req, res) => {
    const appId = req.query.appId;
    const countryCode = req.query.countryCode;

    // Check there is an app id
    if (!appId) {
        console.error("Missing App ID");
        return res.status(400).json({ error: "App ID is missing.\n" });
    }

    const cacheKey = `play:reviews:${countryCode}:${appId}`;

    // Add job to the queue
    const job = await queues.reviews.add(cacheKey, {
        appId: appId,
        countryCode: countryCode,
    });

    // Return job ID to client
    res.json({
        status: "processing",
        jobId: job.id,
        message: "Your search is being processed. Use the job ID to check status.",
    });
};

// The number of concurrent workers
const WORKER_COUNT = 4;

const reviewsWorkers = [];

// Create multiple workers processing the same queue
for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(
        "reviews-queue",
        async (job) => {
            const { appId, countryCode } = job.data;
            try {
                // Get the actual count of reviews
                const appDetails = await gplay.app({ appId: appId, country: countryCode });
                const reviewsCount = appDetails.reviews;

                console.log(`App ${appId} contains ${reviewsCount} reviews`);

                // Fetch reviews based on the count or the maximum limit
                const reviews = await fetchReviews(appId, reviewsCount, countryCode);
                console.log(`Received ${reviews.length} reviews for app: ${appId}`);

                const country_reviews = [...reviews.map((review) => ({ ...review, country: countryCode }))];
                const csvData = jsonToCsv(country_reviews, "reviews");

                // Send the CSV data as a response
                return csvData;
            } catch (error) {
                console.error("Error getting reviews:", error);
                throw new Error("An error occurred while getting reviews.", { status: 500 });
            }
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
        console.log(`Review job ${job.id} completed`);

        // Cache the result
        const cacheKey = `play:reviews:${job.data.countryCode}:${job.data.appId}`;
        console.log(`Adding ${cacheKey} to cache...`);
        await cacheService.set(cacheKey, result, 3600); // Cache for 1 hour
    });

    worker.on("failed", (job, err) => {
        console.error(`Worker ${worker.name} failed job ${job.id} with error:`, err);
    });

    reviewsWorkers.push(worker);
}

const MAX_REVIEWS_COUNT = 100000; //Fixed value for now, can be updated for future development
const fetchReviews = async (appId, reviewsCount, countryCode) => {
    const options = {
        appId: appId,
        sort: gplay.sort.NEWEST,
        lang: "en",
        country: countryCode,
    };

    try {
        let reviews = [];
        let nextToken;
        let totalFetched = 0;
        let numReviews = reviewsCount && reviewsCount < MAX_REVIEWS_COUNT ? reviewsCount : MAX_REVIEWS_COUNT;
        console.log(`Fetching ${numReviews} Reviews for AppId: ${appId}`);

        while (totalFetched < numReviews) {
            if (nextToken) {
                options.nextPaginationToken = nextToken;
            }

            const result = await gplay.reviews(options);
            const newData = result.data || [];

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
            nextToken = result.nextPaginationToken;
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

const oldScrapeReviews = async (req, res) => {
    // console.log(req);
    // console.log("\n");
    const appId = req.query.appId;
    const countryCode = req.query.countryCode;
    // console.log("AppID: %s\n", appId);
    // console.log("CountryCode: %s\n", countryCode);

    try {
        // Get the actual count of reviews
        const appDetails = await gplay.app({ appId: appId, country: countryCode });
        const reviewsCount = appDetails.reviews;

        console.log(`App ${appId} contains ${reviewsCount} reviews`);

        // Fetch reviews based on the count or the maximum limit
        const reviews = await fetchReviews(appId, reviewsCount, countryCode);
        console.log(`Received ${reviews.length} reviews for app: ${appId}`);

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
};
