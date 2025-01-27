const express = require('express');
const searchRoutes = require('./routes/searchRoutes');
const { downloadRelog, downloadCSV } = require('./controllers/searchController');
const { scrapeReviews } = require('./controllers/reviewsController'); 
const { scrapeList, downloadTopChartsCSV, downloadTopChartsRelog} = require('./controllers/listController');
const path = require('path');
const app = express();
const port = 5002;

// change for deployment
const _dirname = path.dirname("");
const buildpath = path.join(_dirname, "../sar-frontend/build");
app.use(express.static(buildpath));

// API Endpoints
app.use('/search', searchRoutes);
app.get('/download-relog', downloadRelog);
app.get('/download-csv', downloadCSV);
app.use('/reviews', scrapeReviews);
app.use('/ios/toplists', scrapeList)
app.use('/download-top-relog', downloadTopChartsRelog);
app.use('/download-top-csv', downloadTopChartsCSV);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
