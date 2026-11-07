const express = require("express");
const searchRoutes = require("./routes/searchRoutes");
const permissionsRoute = require("./routes/permissionsRoute");
const { downloadRelog, downloadCSV, addEmailNotification } = require("./controllers/searchController");
const { scrapeReviews, downloadReviewsRelog } = require("./controllers/reviewsController");
const { downloadTopChartsCSV, downloadTopChartsRelog, scrapeList } = require("./controllers/listController");
const { startPeriodicHealthCheck, getHealthStatus, checkAllServices } = require("./utilities/healthCheck");

const path = require("path");
const searchController = require("./controllers/searchController");
const app = express();
const port = 5001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// change for deployment
const _dirname = path.dirname("");
const buildpath = path.join(_dirname, "../sar-frontend/build");
app.use(express.static(buildpath));

// API Endpoints

//! FOR LOCAL TESTING ONLY
app.use("/api", searchRoutes);
app.use("/ios", searchRoutes);

// Regular search
app.use("/search", searchRoutes);
app.use("/permissions", permissionsRoute);
app.use("/reviews", scrapeReviews);
app.use("/download-csv", downloadCSV);
app.use("/download-relog", downloadRelog);
app.post("/email", searchController.addEmailNotification);

// Bulk reviews relog
app.use("/download-reviews-relog", downloadReviewsRelog);

// Top lists (GET only: app.use also ran these for POST/PUT and any sub-path)
app.get("/toplists", scrapeList);
app.get("/download-top-relog", downloadTopChartsRelog);
app.get("/download-top-csv", downloadTopChartsCSV);

// Basic liveness check endpoint (for load balancers)
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Detailed health check endpoint for scraper services
app.get("/health/scraper", async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");

    try {
        // Always run a live check
        const healthStatus = await checkAllServices();

        // Return 503 if unhealthy, 200 otherwise
        const statusCode = healthStatus.overall === "unhealthy" ? 503 : 200;
        res.status(statusCode).json(healthStatus);
    } catch (error) {
        console.error("[HEALTH] Error in health endpoint:", error.message);
        res.status(500).json({
            error: "Failed to retrieve health status",
            message: error.message,
        });
    }
});

// Fallback
app.get("/*", (req, res) => res.sendFile("/home/ubuntu/smar/sar-frontend/public/index.html"));

// Errors thrown by a handler: answer with JSON instead of Express's default HTML
// page, which includes the stack trace and server paths outside production.
app.use((err, req, res, next) => {
    console.error("Unhandled error on %s %s:", req.method, req.path, err);
    if (res.headersSent) {
        return next(err);
    }
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: status >= 500 ? "Internal server error." : err.message });
});

// Safety net: Express 4 does not catch rejected async route handlers, and Node exits
// on an unhandled rejection, dropping every in-flight request and the in-memory caches.
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
});

// Listen only when started directly (node index.js / pm2 start index.js); tests require the app.
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);

        // Start periodic health check for scraper services
        startPeriodicHealthCheck();
    });
}

module.exports = app;
