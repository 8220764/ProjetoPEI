const ensureArray = (data) => {
    if (!data) return [];
    return Array.isArray(data) ? data : [data];
};

module.exports = { ensureArray };