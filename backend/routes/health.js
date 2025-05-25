const express = require('express');
const router = express.Router();


router.get('/', (req, res) => {
    // Return request headers for debugging
    const headers = {
      received: req.headers,
      sent: res.getHeaders()
    };
    
    res.json({
      status: 'ok',
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      headers: headers,
      environment: process.env.NODE_ENV || 'development'
    });
  });


  module.exports = router;
