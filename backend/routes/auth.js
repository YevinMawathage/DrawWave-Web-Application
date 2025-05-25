const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');


router.get('/google', passport.authenticate('google', { 
  scope: ['profile', 'email'] 
}));


router.get('/google/callback', 
  passport.authenticate('google', { 
    failureRedirect: '/' 
  }),
  (req, res) => {
   
    const payload = {
      user: {
        id: req.user.id,
        name: req.user.displayName,
        email: req.user.email,
        picture: req.user.profilePicture
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '7d' }, 
      (err, token) => {
        if (err) throw err;
      
        res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
      }
    );
  }
);


router.get('/user', async (req, res) => {
  try {
 
    const token = req.header('x-auth-token');
    
    if (!token) {
      return res.status(401).json({ msg: 'No token, authorization denied' });
    }

 
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    

    const user = await User.findById(decoded.user.id).select('-googleId');
    
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error in auth/user route:', err);
    res.status(401).json({ msg: 'Token is not valid' });
  }
});


router.get('/verify', (req, res) => {
  try {
    
    const token = req.header('x-auth-token');
    
    if (!token) {
      return res.status(401).json({ msg: 'No token, authorization denied' });
    }

  
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
    res.json({ 
      user: decoded.user,
      isValid: true 
    });
  } catch (err) {
    res.status(401).json({ 
      msg: 'Token is not valid',
      isValid: false
    });
  }
});


router.post('/refresh', (req, res) => {
  try {
    const token = req.header('x-auth-token');
    
    if (!token) {
      return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    jwt.sign(
      { user: decoded.user },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );
  } catch (err) {
    console.error('Error refreshing token:', err);
    res.status(401).json({ msg: 'Token refresh failed' });
  }
});


router.post('/logout', (req, res) => {
  req.logout();
  res.json({ msg: 'User logged out' });
});

module.exports = router;
