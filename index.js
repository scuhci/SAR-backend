const express = require('express');
const searchRoutes = require('./routes/searchRoutes');


const app = express();
const port = 5001;

app.use('/search', searchRoutes);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});