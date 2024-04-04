const express = require('express');
const router = express.Router();
const permissionsController = require('../controllers/permissionsController')

// Search + permissions endpoint
router.get('/', permissionsController.fetchPermissions);

module.exports = router;