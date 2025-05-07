const iosStore = require("app-store-scraper");
const { jsonToCsv } = require("../utilities/jsonToCsv");

const { Worker } = require("bullmq");
const { cacheService, queues, redisConnection } = require("../bullMQConfig");

const MAX_REVIEWS_COUNT = 500; //Fixed value for now, can be updated for future development

const fetchReviews = async (appId, reviewsCount, countryCode) => {
    const options = {
        appId: appId,
        sort: iosStore.sort.RECENT,
        page: 1,
        country: countryCode,
    };

    try {
        let reviews = [];
        let totalFetched = 0;
        let numReviews = reviewsCount && reviewsCount < MAX_REVIEWS_COUNT ? reviewsCount : MAX_REVIEWS_COUNT;
        console.log(`Fetching ${numReviews} Reviews for AppId: ${appId}`);

        while (totalFetched < numReviews && options.page < 11) {
            console.log(`Fetching page ${options.page} of reviews\n`);
            const result = await iosStore.reviews(options);
            reviews = reviews.concat(result);
            totalFetched = reviews.length;
            console.log(`Total reviews fetched so far: ${totalFetched}`);
            options.page = options.page + 1; // We can only scrape up to page 10, so we stop incrementing before we reach that point
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
    const appId = req.query.appId;
    const countryCode = req.query.countryCode;

    // Check there is an app id
    if (!appId) {
        console.error("Missing App ID");
        return res.status(400).json({ error: "App ID is missing.\n" });
    }

    const cacheKey = `ios:reviews:${countryCode}:${appId}`;

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
const WORKER_COUNT = 1;

const reviewsWorkers = [];

// Create multiple workers processing the same queue
for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(
        "reviews-queue",
        async (job) => {
            const { appId, countryCode } = job.data;

            // Generate cache key
            const cacheKey = `play:reviews:${countryCode}:${appId}`;
            console.log(`Checking cache for ${cacheKey}...`);

            // Check if result exists in cache
            const cachedResult = await cacheService.get(cacheKey);
            if (cachedResult) {
                console.log("Cache hit!");
                return {
                    fromCache: true,
                    data: cachedResult,
                };
            }

            try {
                // Get the actual count of reviews
                const appDetails = await iosStore.app({ appId: appId, country: countryCode });
                const reviewsCount = appDetails.reviews;

                console.log(`App ${appId} contains ${reviewsCount} reviews`);

                // Fetch reviews based on the count or the maximum limit
                const reviews = await fetchReviews(appId, reviewsCount, countryCode);
                console.log(`Received ${reviews.length} reviews for app: ${appId}`);

                console.log("First 10 reviews:");
                for (let i = 0; i < Math.min(10, reviews.length); i++) {
                    console.log(JSON.stringify(reviews[i]));
                }

                // Convert reviews data to CSV format
                const country_reviews = [...reviews.map((review) => ({ ...review, country: countryCode }))];
                const csvData = jsonToCsv(country_reviews, "reviews");

                // Return the CSV data
                return {
                    fromCache: false,
                    data: csvData,
                };
            } catch (error) {
                console.error("Error getting reviews:", error);
                throw new Error("An error occurred while getting reviews.", { status: 500 });
            }
        },
        {
            connection: redisConnection,
            name: `reviews-worker-${i}`,
            lockDuration: 5 * 60 * 1000,
            limiter: {
                max: 20,
                duration: 60000,
            },
        }
    );

    worker.on("completed", async (job, result) => {
        console.log(`Review job ${job.id} completed`);

        // Cache the result
        if (result.fromCache) {
            console.log(`Job ${job.id} came from cache — skipping cache write.`);
            return;
        }

        cacheResult = {
            totalCount: result.totalCount,
            results: result.results,
        };
        const cacheKey = `ios:reviews:${job.data.countryCode}:${job.data.appId}`;
        console.log(`Adding ${cacheKey} to cache...`);
        await cacheService.set(cacheKey, cacheResult, 3600); // Cache for 1 hour
    });

    worker.on("failed", (job, err) => {
        console.error(`Worker ${worker.name} failed job ${job.id} with error:`, err);
    });

    reviewsWorkers.push(worker);
}

module.exports = {
    scrapeReviews,
};
