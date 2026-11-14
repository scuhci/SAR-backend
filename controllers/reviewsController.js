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
// Written to the relog when this process holds no record of the scrape
// (server restarted, or the relog was requested without a scrape first)
const UNKNOWN_SCRAPE_VALUE = "unknown (no scrape recorded on this server)";

// One record per country + app + sort, so a relog describes the scrape it belongs to
const scrapeKey = (countryCode, appId, sortName) =>
  "c:" + String(countryCode || "").toLowerCase() + "_a:" + appId + "_s:" + sortName;

const resolveSort = (sortBy) => {
  const value = String(sortBy || "").trim().toUpperCase();
  if (value === "HELPFUL" || value === "HELPFULNESS") {
    return "HELPFUL";
  }
  return DEFAULT_SORT;
};

const downloadReviewsRelog = (req, res) => {
  cors()(req, res, () => {
    try {
      // Written by scrapeReviews once the reviews have actually been fetched
      const sortName = resolveSort(req.query.sortBy);
      const scrapeInfo = node_ttl.get(
        scrapeKey(req.query.countryCode, req.query.appId, sortName)
      );
      const logInfo = {
        version: json_raw.version,
        date_time: scrapeInfo ? scrapeInfo.scraped_at : new Date(),
        store: req.query.store,
        country: req.query.countryCode,
        num_reviews: scrapeInfo ? scrapeInfo.num_reviews : UNKNOWN_SCRAPE_VALUE, // rows delivered, not Apple's rating count
        total_ratings: scrapeInfo ? scrapeInfo.total_ratings : UNKNOWN_SCRAPE_VALUE,
        appId: req.query.appId,
        sort: scrapeInfo ? scrapeInfo.sort : UNKNOWN_SCRAPE_VALUE, // the sort that was really used for the scrape
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
      // "_reviews" keeps it apart from a search relog for the same term
      const filename =
        "Reproducibility_Log_" +
        encodeURIComponent(logInfo.appId) +
        "_reviews.txt";
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

const fetchReviews = async (appId, countryCode, sortName) => {
  const options = {
    appId: appId,
    sort: SORT_OPTIONS[sortName],
    page: 1,
    country: countryCode,
  };

  try {
    let reviews = [];
    const seenIds = new Set();
    let totalFetched = 0;
    let emptyInARow = 0;
    console.log(`Fetching up to ${MAX_REVIEWS_COUNT} Reviews for AppId: ${appId}`);

    while (totalFetched < MAX_REVIEWS_COUNT && options.page < 11) {
      console.log(`Fetching page ${options.page} of reviews\n`);
      const result = await iosStore.reviews(options);
      if (!result || result.length === 0) {
        emptyInARow++;
        console.log(`Page ${options.page} returned no reviews (${emptyInARow} empty page(s) in a row)`);
        if (emptyInARow >= 2) {
          break; // Two empty pages in a row: the feed has ended
        }
        // Apple sometimes serves one empty page in the middle of the feed, so skip it
        options.page = options.page + 1;
        continue;
      }
      emptyInARow = 0;
      for (const review of result) {
        if (review.id !== undefined && review.id !== null) {
          if (seenIds.has(review.id)) continue;
          seenIds.add(review.id);
        }
        reviews.push(review);
      }
      totalFetched = reviews.length;
      console.log(`Total reviews fetched so far: ${totalFetched}`);
      options.page = options.page + 1; // We can only scrape up to page 10, so we stop incrementing before we reach that point
    }

    if (reviews.length > MAX_REVIEWS_COUNT) {
      reviews = reviews.slice(0, MAX_REVIEWS_COUNT);
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
  const key = scrapeKey(countryCode, appId, sortName);
  node_ttl.del(key); // a failed scrape must not leave an older record behind
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

    // Fetch reviews up to the maximum limit, independent of Apple's rating count
    const reviews = await fetchReviews(appId, countryCode, sortName);
    console.log(
      `Received ${reviews.length} reviews for app: ${appId} (sort: ${sortName})`
    );

    // Record what was actually scraped so the reproducibility log is accurate
    node_ttl.push(
      key,
      {
        num_reviews: reviews.length, // rows written to the CSV
        total_ratings: reviewsCount, // Apple's userRatingCount for the app
        sort: SORT_OPTIONS[sortName], // App Store feed sortby value actually used
        scraped_at: new Date(),
      },
      null,
      604800
    ); // 1 week

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
