const { permissions } = require('google-play-scraper');

const permissionsController = async (req, res) => {

    const query = req.query.query;
    console.log(query);
  
    res.set('Access-Control-Allow-Origin', '*');

    if (!query) {
        return res.status(400).json({ error: 'Search query is missing.' });
    }
    
    try {
        // Search for the main query
        const results = await permissions({ appId: query, lang: 'en', country: 'us' }).then(console.log);;

        if (!results || !Array.isArray(results) || results.length === 0 ) {
            return res.status(404).json({ message: `Search for '${query}' did not return any results.` });
        }

        res.json(results);
    } catch (error) {
        console.error('Error occurred during search:', error);
        res
          .status(500)
          .json({ error: 'An error occurred while processing your request.' });
    }
};
    
module.exports = {
    permissions: permissionsController,
};