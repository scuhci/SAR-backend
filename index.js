const express = require('express');
const searchRoutes = require('./routes/searchRoutes');
const { downloadCSV } = require('./controllers/searchController');

const app = express();
const port = 5001;

app.use('/search', searchRoutes);

// Endpoint for CSV download
app.get('/download-csv', downloadCSV);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
