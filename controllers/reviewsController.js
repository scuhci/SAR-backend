const iosStore = require("app-store-scraper");
const { jsonToCsv } = require("../utilities/jsonToCsv");
const cors = require("cors");
const json_raw = require("../package.json");
const nodeTTL = require("node-ttl");
var node_ttl = new nodeTTL();

const MAX_REVIEWS_COUNT = 500; //Fixed value for now, can be updated for future development

// Sorts the App Store review feed actually supports. The frontend sends the
// dropdown label ("Recency", "Helpfulness", "Rating") as sortBy; Apple has no
// rating sort, so anything we cannot honor falls back to RECENT and the relog
// records the feed sort that was really used (mostRecent or mostHelpful).
const SORT_OPTIONS = {
  RECENT: iosStore.sort.RECENT,
  HELPFUL: iosStore.sort.HELPFUL,
};
const DEFAULT_SORT = "RECENT";

const resolveSort = (sortBy) => {
  const value = String(sortBy || "").trim().toUpperCase();
  if (value === "HELPFUL" || value === "HELPFULNESS" || value === "MOSTHELPFUL") {
    return "HELPFUL";
  }
  return DEFAULT_SORT;
};

const downloadReviewsRelog = (req, res) => {
  cors()(req, res, () => {
    try {
      // Written by scrapeReviews once the reviews have actually been fetched
      const scrapeInfo =
        node_ttl.get("c:" + req.query.countryCode + "_a:" + req.query.appId) ||
        {};
      const logInfo = {
        version: json_raw.version,
        date_time: new Date(),
        store: req.query.store,
        country: req.query.countryCode,
        num_reviews: scrapeInfo.num_reviews, // rows delivered, not Apple's rating count
        total_ratings: scrapeInfo.total_ratings,
        appId: req.query.appId,
        sort: scrapeInfo.sort, // the sort that was really used for the scrape
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

const fetchReviews = async (appId, reviewsCount, countryCode, sortName) => {
  const options = {
    appId: appId,
    sort: SORT_OPTIONS[sortName] || SORT_OPTIONS[DEFAULT_SORT],
    page: 1,
    country: countryCode,
  };

  try {
    let reviews = [];
    let totalFetched = 0;
    let numReviews =
      reviewsCount && reviewsCount < MAX_REVIEWS_COUNT
        ? reviewsCount
        : MAX_REVIEWS_COUNT;
    console.log(`Fetching ${numReviews} Reviews for AppId: ${appId}`);

    while (totalFetched < numReviews && options.page < 11) {
      console.log(`Fetching page ${options.page} of reviews\n`);
      const result = await iosStore.reviews(options);
      if (!result || result.length === 0) {
        console.log(`Page ${options.page} returned no reviews, stopping`);
        break; // The store has no more reviews; later pages would be empty too
      }
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
  // console.log(req);
  // console.log("\n");
  const appId = req.query.appId;
  const countryCode = req.query.countryCode;
  const sortName = resolveSort(req.query.sortBy);
  // console.log("AppID: %s\n", appId);
  // console.log("CountryCode: %s\n", countryCode);

  try {
    // Get the actual count of reviews
    const appDetails = await iosStore.app({
      appId: appId,
      country: countryCode,
    });
    const reviewsCount = appDetails.reviews;

    console.log(`App ${appId} contains ${reviewsCount} reviews`);

    // Fetch reviews based on the count or the maximum limit
    const reviews = await fetchReviews(
      appId,
      reviewsCount,
      countryCode,
      sortName
    );
    console.log(
      `Received ${reviews.length} reviews for app: ${appId} (sort: ${sortName})`
    );

    // Record what was actually scraped so the reproducibility log is accurate
    const pushQuery = "c:" + countryCode + "_a:" + appId;
    node_ttl.push(
      pushQuery,
      {
        num_reviews: reviews.length, // rows written to the CSV
        total_ratings: reviewsCount, // Apple's userRatingCount for the app
        sort: SORT_OPTIONS[sortName], // App Store feed sortby value actually used
      },
      null,
      604800
    ); // 1 week

    console.log("First 10 reviews:");
    for (let i = 0; i < Math.min(10, reviews.length); i++) {
      console.log(JSON.stringify(reviews[i]));
    }

    res.set("Access-Control-Allow-Origin", "*");
    const country_reviews = [
      ...reviews.map((review) => ({ ...review, country: countryCode })),
    ];

    // Convert reviews data to CSV format
    const csvData = jsonToCsv(country_reviews, "reviews");

    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    // Set response headers for CSV download
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${appId}_reviews.csv"`
    );
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
