const express = require('express');
var morgan = require('morgan');
const router = express.Router();
const searchController = require('../controllers/searchController');
const permissionsController = require('../controllers/permissionsController')
router.use(morgan('combined'));
// Search endpoint
router.get('/search', searchController.search);

// Endpoint to download CSV
router.get('/download-csv', searchController.downloadCSV);

module.exports = router;