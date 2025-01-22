const express = require('express');
const router = express.Router();
var morgan = require('morgan');
router.use(morgan('combined'));

// Search endpoint
// router.get('/permissions', permissionsController.fetchPermissions);

module.exports = router;