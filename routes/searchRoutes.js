const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const permissionsController = require('../controllers/permissionsController')

// Search endpoint
router.get('/', searchController.search);

// Endpoint to download CSV
router.get('/download-csv', searchController.downloadCSV);

module.exports = router;
