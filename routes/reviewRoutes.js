const express = require("express");
const morgan = require("morgan");
const router = express.Router();
const { scrapeReviews } = require("../controllers/reviewsController");
const { queues } = require("../bullMQConfig.js");

router.use(morgan("combined"));

// Search endpoint
router.get("/", scrapeReviews);

// BullMQ Job Endpoint
router.get("/job-status", async (req, res) => {
    const jobId = req.query.jobId;
    if (!jobId) {
        console.error("Missing Job ID");
        return res.status(400).json({ error: "Job ID is missing.\n" });
    }
    const job = await queues.reviews.getJob(jobId);

    if (!job) {
        return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();
    res.setHeader("X-Job-State", state);
    if (state === "completed") {
        const result = await job.returnvalue;
        console.log("Result: ", result);

        res.set("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

        // Set response headers for CSV download
        res.setHeader("Content-Disposition", `attachment; filename="${job.data.appId}_reviews.csv"`);
        res.setHeader("Content-Type", "text/csv");

        return res.send(result.data);
    }

    if (state === "failed") {
        return res.status(500).json({ error: "An error occurred while processing your request." });
    }

    return res.json({ status: state });
});

module.exports = router;
