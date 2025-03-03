const express = require('express');
const searchRoutes = require('./routes/searchRoutes');
const { downloadRelog, downloadCSV } = require('./controllers/searchController');
const { scrapeReviews, downloadReviewsRelog } = require('./controllers/reviewsController'); 
const { scrapeList, downloadTopChartsCSV, downloadTopChartsRelog} = require('./controllers/listController');
const path = require('path');
const app = express();
const port = 5001;

// change for deployment
const _dirname = path.dirname("");
const buildpath = path.join(_dirname, "../sar-frontend/build");
app.use(express.static(buildpath));

// API Endpoints
app.use('/ios/search', searchRoutes);
app.get('/ios/download-relog', downloadRelog);
app.get('/ios/download-csv', downloadCSV);
app.use('/ios/reviews', scrapeReviews);
app.use('/ios/download-reviews-relog', downloadReviewsRelog);
app.use('/ios/toplists', scrapeList)
app.use('/ios/download-top-relog', downloadTopChartsRelog);
app.use('/ios/download-top-csv', downloadTopChartsCSV);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
