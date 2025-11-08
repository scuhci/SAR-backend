const express = require('express');
const morgan = require('morgan');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { scrapeReviews } = require('../controllers/reviewsController');

router.use(morgan('combined'));

// Search endpoint
router.get('/search', searchController.search);

// Review endpoint
router.get('/reviews', scrapeReviews);

// Endpoint to download CSV & Relog
router.get('/download-csv', searchController.downloadCSV);
router.get('/download-relog', searchController.downloadRelog);

// Notifications endpoint
router.put('/email', searchController.addEmailNotification);

module.exports = router;