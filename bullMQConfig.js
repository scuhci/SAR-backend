const { Queue, Worker, QueueScheduler } = require("bullmq");
const Redis = require("ioredis");

// Redis connection configuration
const redisConnection = {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
};

// Create Redis connection instance
const redisClient = new Redis(redisConnection);

// Define queues for different job types
const queues = {
    search: new Queue("search-queue", { connection: redisConnection }),
    reviews: new Queue("reviews-queue", { connection: redisConnection }),
    topList: new Queue("toplist-queue", { connection: redisConnection }),
};

// Create a simple cache mechanism using Redis
const cacheService = {
    async set(key, value, ttlSeconds = 3600) {
        await redisClient.set(key, JSON.stringify(value), "EX", ttlSeconds);
    },

    async get(key) {
        const data = await redisClient.get(key);
        return data ? JSON.parse(data) : null;
    },

    async delete(key) {
        await redisClient.del(key);
    },
};

module.exports = {
    queues,
    cacheService,
    redisClient,
    redisConnection,
};
