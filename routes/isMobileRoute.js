// Based off source: https://www.npmjs.com/package/express-useragent
const express = require('express');
const router = express.Router();
var useragent = require('express-useragent');

router.use(useragent.express());
 
router.get('/', function(req, res){
    res.send(req.useragent.isMobile);
});
