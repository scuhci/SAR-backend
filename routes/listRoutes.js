const express = require("express");
const morgan = require("morgan");
const router = express.Router();
const { scrapeList } = require("./controllers/listController");
const { queues } = require("../bullMQConfig.js");

router.use(morgan("combined"));

// Search endpoint
router.get("/", scrapeList);

// BullMQ Job Endpoint
router.get("/job-status", async (req, res) => {
    const jobId = req.query.jobId;
    if (!jobId) {
        console.error("Missing Job ID");
        return res.status(400).json({ error: "Job ID is missing.\n" });
    }
    const job = await queues.topLists.getJob(jobId);

    if (!job) {
        return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();

    if (state === "completed") {
        const result = await job.returnvalue;
        return res.json({ status: state, data: result });
    }

    if (state === "failed") {
        return res.status(500).json({ error: "An error occurred while processing your request." });
    }

    return res.json({ status: state });
});

module.exports = router;
