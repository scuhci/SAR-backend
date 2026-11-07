const nodeTTL = require("node-ttl");

// node-ttl only evaluates an entry's TTL inside get(), unless it is constructed
// with a checkPeriode that starts a background sweep. The controllers keep every
// scraped result set (up to a few hundred full-detail app objects per key) for a
// week so the CSV can be downloaded later, and a key that is never downloaded is
// never read, so without the sweep it stays in memory until the process restarts.
// This builds the cache with a sweep and caps the number of entries, dropping the
// oldest ones first, so memory stays bounded however many distinct queries come in.
const DEFAULT_CHECK_PERIOD_MS = 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;

const createResultCache = ({ checkPeriode = DEFAULT_CHECK_PERIOD_MS, maxEntries = DEFAULT_MAX_ENTRIES } = {}) => {
    const cache = new nodeTTL({ checkPeriode });
    const keysByAge = []; // oldest first

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
        get: (keys, callback) => cache.get(keys, callback),
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
