const express = require('express');
const morgan = require('morgan');
const router = express.Router();
const searchController = require('../controllers/searchController');

router.use(morgan('combined'));

// Search endpoint
router.get('/', searchController.search);

// Endpoint to download CSV & Relog
router.get('/download-csv', searchController.downloadCSV);
router.get('/download-relog', searchController.downloadRelog);

module.exports = router;