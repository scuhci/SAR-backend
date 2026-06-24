const express = require('express');
const searchRoutes = require('./routes/searchRoutes');
const { downloadRelog, downloadCSV } = require('./controllers/searchController');
const { scrapeReviews, downloadReviewsRelog } = require('./controllers/reviewsController'); 
const { scrapeList, downloadTopChartsCSV, downloadTopChartsRelog} = require('./controllers/listController');
const { startPeriodicHealthCheck, getHealthStatus, checkAllServices } = require('./utilities/healthCheck');
const { prewarmCache } = require('./utilities/prewarmCache');
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
app.use('/download-reviews-relog', downloadReviewsRelog);
app.use('/toplists', scrapeList)
app.use('/download-top-relog', downloadTopChartsRelog);
app.use('/download-top-csv', downloadTopChartsCSV);

// Basic liveness check endpoint (for load balancers)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Detailed health check endpoint for scraper services
app.get('/health/scraper', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  
  try {
    // Always run a live check against the scraper
    const healthStatus = await checkAllServices();
    
    // Return 503 if unhealthy, 200 otherwise
    const statusCode = healthStatus.overall === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    console.error('[HEALTH] Error in health endpoint:', error.message);
    res.status(500).json({ 
      error: 'Failed to retrieve health status',
      message: error.message 
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);

  // Start periodic health check for scraper services
  startPeriodicHealthCheck();

  // Pre-warm Redis cache for example searches (fire-and-forget, 2s delay for routes to settle)
  setTimeout(() => prewarmCache().catch((err) => console.error('[Cache] Pre-warm error:', err.message)), 2000);
});
