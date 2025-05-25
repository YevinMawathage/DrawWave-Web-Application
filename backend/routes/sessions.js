const express = require('express');
const router = express.Router();
const Session = require('../models/Session');
const User = require('../models/User');

router.post('/create', async (req, res) => {
  try {
    const { sessionId, roomId, userName } = req.body;
    
    if (!sessionId || !roomId || !userName) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    const existingSession = await Session.findOne({ $or: [{ sessionId }, { roomId }] });
    if (existingSession) {
      return res.status(400).json({ success: false, message: 'Session or Room ID already exists' });
    }
    
    const newSession = new Session({
      sessionId,
      roomId,
      createdBy: userName,
      participants: [{ name: userName }]
    });
    
    await newSession.save();
    
    const newUser = new User({
      userName,
      sessionId,
      roomId
    });
    
    await newUser.save();
    
    res.status(201).json({
      success: true,
      data: {
        sessionId: newSession.sessionId,
        roomId: newSession.roomId,
        userId: newUser._id
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/validate', async (req, res) => {
  try {
    const { sessionId, userName } = req.body;
    
    if (!sessionId || !userName) {
      return res.status(400).json({ success: false, message: 'Session ID and user name are required' });
    }
    
    const session = await Session.findOne({ sessionId });
    
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    let existingUser = await User.findOne({ userName, sessionId });
    let userId;
    
    if (!existingUser) {
      if (!session.participants.some(p => p.name === userName)) {
        session.participants.push({ name: userName });
        await session.save();
      }
      
      const newUser = new User({
        userName,
        sessionId: session.sessionId,
        roomId: session.roomId
      });
      
      await newUser.save();
      userId = newUser._id;
    } else {
      userId = existingUser._id;
    }
    
    res.status(200).json({
      success: true,
      data: {
        sessionId: session.sessionId,
        roomId: session.roomId,
        createdBy: session.createdBy,
        participantCount: session.participants.length,
        userId: userId
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (sessionId === 'active') {
      return await getAllActiveSessions(req, res);
    }
    
    const session = await Session.findOne({ sessionId });
    
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    res.status(200).json({
      success: true,
      data: {
        sessionId: session.sessionId,
        roomId: session.roomId,
        createdBy: session.createdBy,
        participants: session.participants.length,
        createdAt: session.createdAt,
        canvasData: session.canvasData ? `data:image/png;base64,${session.canvasData}` : null,
        drawingLayerData: session.drawingLayerData ? `data:image/png;base64,${session.drawingLayerData}` : null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

async function getAllActiveSessions(req, res) {
  try {
    const activeSessions = await Session.find({
      lastUpdated: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).sort({ lastUpdated: -1 });
    
    const sessionData = activeSessions.map(session => ({
      sessionId: session.sessionId,
      roomId: session.roomId,
      createdBy: session.createdBy,
      participants: session.participants.length,
      createdAt: session.createdAt,
      lastUpdated: session.lastUpdated,
      hasCanvasData: !!session.canvasData,
      hasDrawingLayerData: !!session.drawingLayerData
    }));
    
    res.status(200).json({
      success: true,
      data: sessionData
    });
  } catch (error) {
    console.error('Error getting active sessions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

router.post('/update-canvas', async (req, res) => {
  try {
    const { sessionId, canvasData, isDrawingLayer } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }
    
    const session = await Session.findOne({ sessionId });
    
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    if (isDrawingLayer) {
      session.drawingLayerData = canvasData;
    } else {
      session.canvasData = canvasData;
    }
    
    session.lastUpdated = Date.now();
    await session.save();
    
    res.status(200).json({
      success: true,
      message: 'Canvas state updated successfully'
    });
  } catch (error) {
    console.error('Error updating canvas state:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;