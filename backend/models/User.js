const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true
  },
  // Google Auth 
  googleId: {
    type: String,
    sparse: true
  },
  email: {
    type: String,
    sparse: true
  },
  displayName: {
    type: String,
    sparse: true
  },
  firstName: {
    type: String,
    sparse: true
  },
  lastName: {
    type: String,
    sparse: true
  },
  profilePicture: {
    type: String,
    sparse: true
  },
  sessionId: {
    type: String,
    ref: 'Session'
  }, 
  roomId: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', UserSchema);
