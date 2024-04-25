const natural = require('natural');
const { search, app } = require("google-play-scraper");
const { cleanText, jsonToCsv } = require('../utilities/jsonToCsv');

const path = require('path');
const file_name = path.basename(__filename);
const cors = require('cors'); 

