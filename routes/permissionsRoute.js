const express = require('express');
const router = express.Router();
const permissionsController = require('../controllers/permissionsController')

// Search endpoint
router.get('/', permissionsController.permissions);

module.exports = router;