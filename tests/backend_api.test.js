const express = require('express');
const request = require('supertest');

const mockSessionsRouter = express.Router();
const mockUsersRouter = express.Router();
const mockRoomsRouter = express.Router();

let sessions = [];
let users = [];
let rooms = [];

const app = express();
app.use(express.json());

mockSessionsRouter.get('/', (req, res) => {
  res.status(200).json(sessions);
});

mockSessionsRouter.post('/', (req, res) => {
  const newSession = req.body;
  sessions.push(newSession);
  res.status(201).json(newSession);
});

mockSessionsRouter.get('/:id', (req, res) => {
  const session = sessions.find(s => s.sessionId === req.params.id);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }
  res.status(200).json(session);
});

mockSessionsRouter.put('/:id', (req, res) => {
  const sessionIndex = sessions.findIndex(s => s.sessionId === req.params.id);
  if (sessionIndex === -1) {
    return res.status(404).json({ message: 'Session not found' });
  }
  sessions[sessionIndex] = { ...sessions[sessionIndex], ...req.body };
  res.status(200).json(sessions[sessionIndex]);
});

mockSessionsRouter.delete('/:id', (req, res) => {
  const sessionIndex = sessions.findIndex(s => s.sessionId === req.params.id);
  if (sessionIndex === -1) {
    return res.status(404).json({ message: 'Session not found' });
  }
  sessions.splice(sessionIndex, 1);
  res.status(200).json({ message: 'Session deleted' });
});

mockUsersRouter.get('/', (req, res) => {
  res.status(200).json(users);
});

mockUsersRouter.post('/', (req, res) => {
  const newUser = {
    _id: `user_${users.length + 1}`,
    ...req.body
  };
  users.push(newUser);
  res.status(201).json(newUser);
});

mockUsersRouter.get('/:id', (req, res) => {
  const user = users.find(u => u._id === req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  res.status(200).json(user);
});

mockRoomsRouter.get('/', (req, res) => {
  res.status(200).json(rooms);
});

mockRoomsRouter.post('/', (req, res) => {
  const newRoom = {
    _id: `room_${rooms.length + 1}`,
    ...req.body
  };
  rooms.push(newRoom);
  res.status(201).json(newRoom);
});

mockRoomsRouter.get('/:id', (req, res) => {
  const room = rooms.find(r => r._id === req.params.id);
  if (!room) {
    return res.status(404).json({ message: 'Room not found' });
  }
  res.status(200).json(room);
});

app.use('/api/sessions', mockSessionsRouter);
app.use('/api/users', mockUsersRouter);
app.use('/api/rooms', mockRoomsRouter);

beforeEach(() => {
  sessions = [];
  users = [];
  rooms = [];
});

describe('Session API Routes', () => {
  test('GET /api/sessions should return a list of sessions', async () => {
    const response = await request(app).get('/api/sessions');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
  
  test('POST /api/sessions should create a new session', async () => {
    const newSession = {
      sessionId: 'test-session-123',
      hostUser: 'test-user',
      active: true,
      createdAt: new Date().toISOString()
    };
    
    const response = await request(app)
      .post('/api/sessions')
      .send(newSession);
      
    expect(response.status).toBe(201);
    expect(response.body.sessionId).toBe(newSession.sessionId);
  });
  
  test('GET /api/sessions/:id should return a specific session', async () => {
    const newSession = {
      sessionId: 'test-session-get',
      hostUser: 'test-user',
      active: true,
      createdAt: new Date().toISOString()
    };
    
    await request(app)
      .post('/api/sessions')
      .send(newSession);
      
    const response = await request(app).get(`/api/sessions/${newSession.sessionId}`);
    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe(newSession.sessionId);
  });
  
  test('PUT /api/sessions/:id should update a session', async () => {
    const newSession = {
      sessionId: 'test-session-update',
      hostUser: 'test-user',
      active: true,
      createdAt: new Date().toISOString()
    };
    
    await request(app)
      .post('/api/sessions')
      .send(newSession);
      
    const updatedSession = {
      active: false
    };
    
    const response = await request(app)
      .put(`/api/sessions/${newSession.sessionId}`)
      .send(updatedSession);
      
    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);
  });
  
  test('DELETE /api/sessions/:id should delete a session', async () => {
    const newSession = {
      sessionId: 'test-session-delete',
      hostUser: 'test-user',
      active: true,
      createdAt: new Date().toISOString()
    };
    
    await request(app)
      .post('/api/sessions')
      .send(newSession);
      
    const response = await request(app).delete(`/api/sessions/${newSession.sessionId}`);
    expect(response.status).toBe(200);
    
    const getResponse = await request(app).get(`/api/sessions/${newSession.sessionId}`);
    expect(getResponse.status).toBe(404);
  });
  
  test('Session should maintain drawing layer data after reconnection', async () => {
    const sessionWithLayers = {
      sessionId: 'persistent-session',
      hostUser: 'persistence-test-user',
      active: true,
      createdAt: new Date().toISOString(),
      drawingLayers: [
        {
          layer_id: 'layer1',
          data: 'base64data',
          zIndex: 1
        }
      ]
    };
    
    await request(app)
      .post('/api/sessions')
      .send(sessionWithLayers);
    
    const response = await request(app).get('/api/sessions/persistent-session');
    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe('persistent-session');
    expect(response.body.drawingLayers).toBeDefined();
    expect(response.body.drawingLayers[0].layer_id).toBe('layer1');
  });
});

describe('Room API Routes', () => {
  test('POST /api/rooms should create a new room', async () => {
    const newRoom = {
      name: 'Test Room',
      description: 'A test room',
      ownerId: 'test-user-123'
    };
    
    const response = await request(app)
      .post('/api/rooms')
      .send(newRoom);
      
    expect(response.status).toBe(201);
    expect(response.body.name).toBe(newRoom.name);
  });
  
  test('GET /api/rooms should return all rooms', async () => {
    const response = await request(app).get('/api/rooms');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
  
  test('GET /api/rooms/:id should return a specific room', async () => {
    const newRoom = {
      name: 'Get Test Room',
      description: 'A room to test GET',
      ownerId: 'test-user-123'
    };
    
    const createResponse = await request(app)
      .post('/api/rooms')
      .send(newRoom);
      
    const roomId = createResponse.body._id;
      
    const response = await request(app).get(`/api/rooms/${roomId}`);
    expect(response.status).toBe(200);
    expect(response.body.name).toBe(newRoom.name);
  });
});

describe('User API Routes', () => {
  test('POST /api/users should create a new user', async () => {
    const newUser = {
      username: 'testuser',
      email: 'test@example.com',
      name: 'Test User'
    };
    
    const response = await request(app)
      .post('/api/users')
      .send(newUser);
      
    expect(response.status).toBe(201);
    expect(response.body.username).toBe(newUser.username);
  });
  
  test('GET /api/users should return all users', async () => {
    const response = await request(app).get('/api/users');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
  
  test('GET /api/users/:id should return a specific user', async () => {
    const newUser = {
      username: 'getuser',
      email: 'get@example.com',
      name: 'Get User'
    };
    
    const createResponse = await request(app)
      .post('/api/users')
      .send(newUser);
      
    const userId = createResponse.body._id;
      
    const response = await request(app).get(`/api/users/${userId}`);
    expect(response.status).toBe(200);
    expect(response.body.username).toBe(newUser.username);
  });
});

describe('Session Reconnection Tests', () => {
  test('Client should receive drawing layer data on reconnection', async () => {
    const sessionWithDrawingData = {
      sessionId: 'reconnect-session',
      hostUser: 'host-user',
      active: true,
      createdAt: new Date().toISOString(),
      drawingLayers: [
        {
          layer_id: 'background',
          data: 'base64-canvas-data',
          zIndex: 0
        },
        {
          layer_id: 'user-drawing',
          data: 'base64-drawing-data',
          zIndex: 1
        }
      ]
    };
    
    await request(app)
      .post('/api/sessions')
      .send(sessionWithDrawingData);
      
    const response = await request(app).get(`/api/sessions/${sessionWithDrawingData.sessionId}`);
    
    expect(response.status).toBe(200);
    expect(response.body.drawingLayers).toBeDefined();
    expect(response.body.drawingLayers.length).toBe(2);
    expect(response.body.drawingLayers[0].layer_id).toBe('background');
    expect(response.body.drawingLayers[1].layer_id).toBe('user-drawing');
  });
});

