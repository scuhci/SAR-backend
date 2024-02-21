const express = require('express');
const searchRoutes = require('./routes/searchRoutes');
const permissionsRoute = require('./routes/permissionsRoute');
const { downloadCSV } = require('./controllers/searchController');
const path = require('path')
const app = express();
const port = 5001;
const logger = require('log-timestamp') // adding timestamps to logs

app.use('/search', searchRoutes);

// change for deployment
const _dirname=path.dirname("")
const buildpath = path.join(_dirname,"../sar-frontend/build")
app.use(express.static(buildpath));

// Endpoint for CSV download
app.get('/download-csv', downloadCSV);
app.use('/permissions', permissionsRoute);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});