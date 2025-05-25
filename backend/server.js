const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const passport = require('passport');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

<<<<<<< Updated upstream
// Middleware
app.use(cors());
=======
app.use(cors({
  origin:["https://app.drawwave.space", "http://localhost:5173"] ,
  credentials: true, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));
>>>>>>> Stashed changes
app.use(bodyParser.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'drawwave_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(passport.initialize());
app.use(passport.session());

require('./config/passport')();

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/auth', require('./routes/auth'));

app.get('/', (req, res) => {
  res.send('DrawWave Session Management API');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});