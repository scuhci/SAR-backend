const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  enableOfflineQueue: false,
});

redis.on('connect', () => console.log('[Redis] connected'));
redis.on('error', (err) => console.error('[Redis] connection error:', err.message));

module.exports = redis;
