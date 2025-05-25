const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  createdBy: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 
  },
  participants: [{
    name: String,
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  canvasData: {
    type: String,  
    default: ''
  },
  drawingLayerData: {
    type: String,  
    default: ''
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Session', SessionSchema);