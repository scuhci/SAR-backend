const gplay = require("google-play-scraper");
const {jsonToCsv} = require('../utilities/jsonToCsv');

const MAX_REVIEWS_COUNT = 10000; //Fixed value for now, can be updated for future development

const fetchReviews = async (appId, reviewsCount) => {
  const options = {
    appId: appId,
    sort: gplay.sort.NEWEST,
    lang: 'en',
    country: 'us',
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

      reviews = reviews.concat(newData);
      totalFetched += newData.length;
      console.log(`Total reviews fetched so far: ${totalFetched}`);
      nextToken = result.nextPaginationToken;
    }

    if(reviews.length > numReviews){
      reviews = reviews.slice(0, numReviews);
    }

    return reviews;
  } catch (error) {
    console.error("Error scraping reviews:", error);
    throw new Error("An error occurred while scraping reviews.");
  }
};

const scrapeReviews = async (req, res) => {
  const { appId } = req.query;

  try {
    // Get the actual count of reviews
    const appDetails = await gplay.app({ appId: appId });
    const reviewsCount = appDetails.reviews;

    console.log(`App ${appId} contains ${reviewsCount} reviews`);

    // Fetch reviews based on the count or the maximum limit
    const reviews = await fetchReviews(appId, reviewsCount);
    console.log(`Received ${reviews.length} reviews for app: ${appId}`);

    res.set("Access-Control-Allow-Origin", "*");

    // Convert reviews data to CSV format
    const csvData = jsonToCsv(reviews);

    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // Set response headers for CSV download
    res.setHeader('Content-Disposition', `attachment; filename="${appId}_reviews.csv"`);
    res.setHeader('Content-Type', 'text/csv');

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