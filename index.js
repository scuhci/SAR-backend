const express = require("express");
const searchRoutes = require("./routes/searchRoutes");
const permissionsRoute = require("./routes/permissionsRoute");
const { downloadRelog, downloadCSV, addEmailNotification } = require("./controllers/searchController");
const { scrapeReviews, downloadReviewsRelog } = require("./controllers/reviewsController");
const { downloadTopChartsCSV, downloadTopChartsRelog, scrapeList } = require("./controllers/listController");

const path = require("path");
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

// Bulk reviews relog
app.use("/download-reviews-relog", downloadReviewsRelog);

// Top lists
app.use("/toplists", scrapeList);
app.use("/download-top-relog", downloadTopChartsRelog);
app.use("/download-top-csv", downloadTopChartsCSV);

// Fallback
app.get("/*", (req, res) => res.sendFile("/home/ubuntu/smar/sar-frontend/public/index.html"));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
