const express = require('express');
const { apiPool } = require('../db');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await apiPool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    console.error('health: db check failed:', err.message);
    res.status(503).json({ status: 'degraded', db: 'unavailable' });
  }
});

module.exports = router;
