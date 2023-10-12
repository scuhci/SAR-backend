const express = require('express');
const searchRoutes = require('./routes/searchRoutes');
const permissionsRoute = require('./routes/permissionsRoute');


const app = express();
const port = 5001;

app.use('/search', searchRoutes);
app.use('/permissions', permissionsRoute);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});