const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

module.exports = function() {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: '/api/auth/google/callback'
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
     
          let user = await User.findOne({ googleId: profile.id });
          
          if (user) {
          
            user.lastActive = new Date();
            await user.save();
            return done(null, user);
          }
          
          
          const newUser = new User({
            googleId: profile.id,
            userName: profile.displayName,
            email: profile.emails[0].value,
            displayName: profile.displayName,
            firstName: profile.name.givenName,
            lastName: profile.name.familyName,
            profilePicture: profile.photos[0].value
          });
          
          await newUser.save();
          return done(null, newUser);
        } catch (err) {
          console.error('Error in Google authentication:', err);
          return done(err, null);
        }
      }
    )
  );

  
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });
};
