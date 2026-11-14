const nodeTTL = require("node-ttl");

// node-ttl only evaluates an entry's TTL inside get(), unless it is constructed
// with a checkPeriode that starts a background sweep. The controllers keep every
// scraped result set (up to a few hundred full-detail app objects per key) for a
// week so the CSV can be downloaded later, and a key that is never downloaded is
// never read, so without the sweep it stays in memory until the process restarts.
// This builds the cache with a sweep and caps the number of entries, dropping the
// least recently used ones first (stored or read), so memory stays bounded however
// many distinct queries come in and a result that is being downloaded is not the
// first to go.
const DEFAULT_CHECK_PERIOD_MS = 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;

const createResultCache = ({ checkPeriode = DEFAULT_CHECK_PERIOD_MS, maxEntries = DEFAULT_MAX_ENTRIES } = {}) => {
    const cache = new nodeTTL({ checkPeriode });
    const keysByAge = []; // least recently used first

    const forget = (key) => {
        const index = keysByAge.indexOf(key);
        if (index !== -1) {
            keysByAge.splice(index, 1);
        }
    };
    cache.on("del", forget);
    cache.on("clear", () => keysByAge.splice(0));

    return {
        push: (key, value, timeOutFunction, ttl) => {
            if (!cache.push(key, value, timeOutFunction, ttl)) {
                return false;
            }
            forget(key);
            keysByAge.push(key);
            while (keysByAge.length > maxEntries) {
                cache.del(keysByAge.shift());
            }
            return true;
        },
        get: (keys, callback) => {
            const value = cache.get(keys, callback);
            if (typeof keys === "string" && value != null) {
                // A read counts as use for the cap; it does not extend the TTL.
                forget(keys);
                keysByAge.push(keys);
            }
            return value;
        },
        del: (keys) => cache.del(keys),
        size: () => cache.size(),
        getOptions: () => cache.getOptions(),
    };
};

module.exports = {
    createResultCache,
    DEFAULT_CHECK_PERIOD_MS,
    DEFAULT_MAX_ENTRIES,
};
