const express = require("express");
const searchRoutes = require("./routes/searchRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const listRoutes = require("./routes/listRoutes");

const path = require("path");
const app = express();
const port = 5001;

// change for deployment
const _dirname = path.dirname("");
const buildpath = path.join(_dirname, "../sar-frontend/build");
app.use(express.static(buildpath));

// API Endpoints
app.use("/search", searchRoutes);
app.use("/reviews", reviewRoutes);
app.use("/toplists", listRoutes);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
