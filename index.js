const express = require('express');
const searchRoutes = require('./routes/searchRoutes');
const permissionsRoute = require('./routes/permissionsRoute');
const { downloadCSV } = require('./controllers/searchController');


const app = express();
const port = 5001;

app.use('/search', searchRoutes);

// Endpoint for CSV download
app.get('/download-csv', downloadCSV);
app.use('/permissions', permissionsRoute);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});