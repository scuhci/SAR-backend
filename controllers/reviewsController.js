const gplay = require("google-play-scraper");
const {jsonToCsv} = require('../utilities/jsonToCsv');

const MAX_REVIEWS_COUNT = 10000; //Fixed for now, can be updated for future development

const fetchReviews = async (appId) => {
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

    while (totalFetched < MAX_REVIEWS_COUNT) {
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

    if(reviews.length > MAX_REVIEWS_COUNT){
      reviews = reviews.slice(0, MAX_REVIEWS_COUNT);
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
    const reviews = await fetchReviews(appId);
    console.log(`Received ${reviews.length} reviews for app: ${appId}`);

    res.set("Access-Control-Allow-Origin", "*");

    // Convert reviews data to CSV format
    const csvData = jsonToCsv(reviews);

    // Set response headers for CSV download
    res.setHeader('Content-Disposition', `attachment; filename="${appId}_reviews.csv"`);
    res.setHeader('Content-Type', 'text/csv');

    // Send the CSV data as a response
    res.status(200).send(csvData);

    // res.json(reviews);
  } catch (error) {
    console.error("Error getting reviews:", error);
    res.status(500).json({ error: "An error occurred while getting reviews." });
  }
};

module.exports = {
  scrapeReviews,
};