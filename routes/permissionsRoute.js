const express = require('express');
const router = express.Router();
var morgan = require('morgan');
const permissionsController = require('../controllers/permissionsController')
router.use(morgan('combined'));
// Search endpoint
router.get('/', permissionsController.permissions);

module.exports = router;