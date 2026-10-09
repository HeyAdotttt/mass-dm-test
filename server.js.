const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "Backend is running" });
});

app.get("/api/admin/servers", (req, res) => {
  res.status(501).json({
    error: "Server data API is not configured yet."
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});