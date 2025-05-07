const express = require("express");
const searchRoutes = require("./routes/searchRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const { downloadRelog, downloadCSV } = require("./controllers/searchController");
const path = require("path");
const app = express();
const port = 5001;

// change for deployment
const _dirname = path.dirname("");
const buildpath = path.join(_dirname, "../sar-frontend/build");
app.use(express.static(buildpath));

// Create a router for all API endpoints
const apiRouter = express.Router();

// API Endpoints
apiRouter.use("/search", searchRoutes);
apiRouter.get("/download-relog", downloadRelog);
apiRouter.get("/download-csv", downloadCSV);
apiRouter.use("/reviews", reviewRoutes);

// Mount the router with the /ios prefix
// app.use("/ios", apiRouter);
app.use("/", apiRouter);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
