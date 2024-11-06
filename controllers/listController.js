const gplay = require("google-play-scraper");
const {jsonToCsv} = require('../utilities/jsonToCsv');

const MAX_APPS_COUNT = 1000000;
const path = require("path");
const file_name = path.basename(__filename);

const fetchList = async (collection, category, num) => {
    options = {
      category: category,
      collection: collection,
      lang: 'en',
      country: 'us',
      num: num,
      fullDetail: false,
    };
  
    try {
      let numAppsToFetch = num && num < MAX_APPS_COUNT ? num : MAX_APPS_COUNT;

      const toplist = await gplay.list(options);

      for (const result of toplist) {
        console.log(`[%s] App Title: %s\n`, file_name, result.title);
      }

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
    console.log("Received Top List Scrape Request");
    const collection = req.query.collection;
    const category = req.query.category;
    const num = req.query.num ? req.query.num : MAX_APPS_COUNT;
  
    try {
      // Fetch top list based on the count or the maximum limit
      const toplist = await fetchList(collection, category, num);
      console.log(`Scraped Top ${toplist.length} Apps for ${collection} and ${category}`);
  
      return res.json({
        totalCount: toplist.length,
        results: toplist,
      });
    } catch (error) {
      console.error("Error getting top list:", error);
      res.status(500).json({ error: "An error occurred while getting top list." });
    }
  };
  
  module.exports = {
    scrapeList,
  };
  