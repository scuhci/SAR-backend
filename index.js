const express = require("express");
const searchRoutes = require("./routes/searchRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const listRoutes = require("./routes/listRoutes");
const permissionsRoute = require("./routes/permissionsRoute");
const { downloadRelog, downloadCSV } = require("./controllers/searchController");
const { downloadTopChartsCSV, downloadTopChartsRelog } = require("./controllers/listController");

const path = require("path");
const app = express();
const port = 5001;

// change for deployment
const _dirname = path.dirname("");
const buildpath = path.join(_dirname, "../sar-frontend/build");
app.use(express.static(buildpath));

// API Endpoints
app.use("/search", searchRoutes);
app.get("/download-relog", downloadRelog);
app.get("/download-csv", downloadCSV);
app.use("/permissions", permissionsRoute);
app.use("/reviews", reviewRoutes);
app.use("/toplists", listRoutes);
app.use("/download-top-relog", downloadTopChartsRelog);
app.use("/download-top-csv", downloadTopChartsCSV);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
