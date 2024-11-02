const gplay = require("google-play-scraper");
const {jsonToCsv} = require('../utilities/jsonToCsv');

const MAX_APPS_COUNT = 1000000;

const fetchList = async (collection, category, fullDetail, num) => {
    const options = {
      collection: collection,
      category: category,
      num: num,
      lang: 'en',
      country: 'us',
      fullDetail: fullDetail,
    };
  
    try {
      let numAppsToFetch = num && num < MAX_APPS_COUNT ? num : MAX_APPS_COUNT;
      console.log(`Fetching ${numAppsToFetch} Apps within ${collection} and ${category}` );
  
      toplist = await gplay.list(options);
  
      if(toplist.length > numAppsToFetch) {
        toplist = toplist.slice(0, numAppsToFetch)
      }
  
      return toplist;
    } catch (error) {
      console.error("Error scraping top list.", error);
      throw new Error("An error occurred while scraping for top list.");
    }
  };
  
  const scrapeList = async (req, res) => {
    const collection = req.query.collection;
    const category = req.query.category;
    const num = req.query.num;
    const fullDetail = req.query.fullDetail === 'true';
  
    try {
      // Fetch top list based on the count or the maximum limit
      const toplist = await fetchList(collection, category, fullDetail, num);
      console.log(`Scraped top ${toplist.length} apps for ${collection} and ${category}`);
  
      console.log("Top 10 of list retrieved:");
      for (let i = 0; i < Math.min(10, toplist.length); i++) {
        console.log(JSON.stringify(toplist[i]));
      }
  
      res.set("Access-Control-Allow-Origin", "*");
  
      // Convert top list data to CSV format
      const csvData = jsonToCsv(toplist, 'toplist');
  
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  
      // Set response headers for CSV download
      res.setHeader('Content-Disposition', `attachment; filename="${collection}_${category}_toplist.csv"`);
      res.setHeader('Content-Type', 'text/csv');
  
      // Send the CSV data as a response
      res.status(200).send(csvData);
  
    } catch (error) {
      console.error("Error getting top list:", error);
      res.status(500).json({ error: "An error occurred while getting top list." });
    }
  };
  
  module.exports = {
    scrapeList,
  };
  