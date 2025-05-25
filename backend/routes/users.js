const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Session = require('../models/Session');

router.post('/create', async (req, res) => {
  try {
    const { userName, sessionId, roomId } = req.body;
    
    if (!userName || !sessionId || !roomId) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    const newUser = new User({
      userName,
      sessionId,
      roomId
    });
    
    await newUser.save();
    
    res.status(201).json({
      success: true,
      data: {
        userName: newUser.userName,
        sessionId: newUser.sessionId,
        roomId: newUser.roomId
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const users = await User.find({ sessionId });
    
    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/activity/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.lastActive = Date.now();
    await user.save();
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
