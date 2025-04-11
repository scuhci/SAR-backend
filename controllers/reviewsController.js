const gplay = require("google-play-scraper");
const { jsonToCsv } = require("../utilities/jsonToCsv");

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
        let numReviews = reviewsCount < MAX_REVIEWS_COUNT ? reviewsCount : MAX_REVIEWS_COUNT;
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

const scrapeReviews = async (req, res) => {
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
