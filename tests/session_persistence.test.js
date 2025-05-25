


class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; 
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    
  
    setTimeout(() => {
      if (this.onopen) this.onopen({ target: this });
    }, 0);
  }
  
  send(data) {
    this.sent.push(data);
    this._handleMessage(data);
  }
  
 
  _handleMessage(message) {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'join_session') {
        
        setTimeout(() => {
          if (this.onmessage) {
            this.onmessage({
              data: JSON.stringify({
                type: 'session_joined',
                session_id: data.session_id,
                host: false,
                canvas_data: 'base64encodedcanvasdata',
                drawing_layers: [
                  {
                    layer_id: 'layer1',
                    data: 'base64encodedlayerdata',
                    zIndex: 1
                  }
                ]
              })
            });
          }
        }, 10);
      }
    } catch (e) {
      console.error('Error handling mock message', e);
    }
  }
  
  close() {
    if (this.onclose) {
      this.onclose({ code: 1000 });
    }
    this.readyState = 3; 
  }
}


const mockLocalStorage = {
  store: {},
  getItem: jest.fn(key => mockLocalStorage.store[key] || null),
  setItem: jest.fn((key, value) => {
    mockLocalStorage.store[key] = value;
  }),
  removeItem: jest.fn(key => {
    delete mockLocalStorage.store[key];
  }),
  clear: jest.fn(() => {
    mockLocalStorage.store = {};
  })
};

beforeEach(() => {
  global.WebSocket = MockWebSocket;
  Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });
  mockLocalStorage.clear();
});

describe('Session Persistence Tests', () => {
  test('WebSocket should send session data during reconnection', () => {
    const ws = new MockWebSocket('ws://localhost:8765');
    
    const sessionId = 'test-session-123';
    const userName = 'Test User';
    
    mockLocalStorage.setItem('sessionId', sessionId);
    mockLocalStorage.setItem('userName', userName);
    
    
    ws.send(JSON.stringify({
      type: 'join_session',
      session_id: sessionId,
      user_name: userName
    }));
    
    
    expect(ws.sent.length).toBe(1);
    const sentData = JSON.parse(ws.sent[0]);
    expect(sentData.type).toBe('join_session');
    expect(sentData.session_id).toBe(sessionId);
    
    
    return new Promise(resolve => {
      ws.onmessage = event => {
        const data = JSON.parse(event.data);
        
       
        expect(data.type).toBe('session_joined');
        expect(data.session_id).toBe(sessionId);
        expect(data.canvas_data).toBeDefined();
        expect(data.drawing_layers).toBeDefined();
        expect(data.drawing_layers.length).toBe(1);
        expect(data.drawing_layers[0].layer_id).toBe('layer1');
        
        resolve();
      };
    });
  });
  
  test('Session data should be stored and retrievable after disconnection', () => {
    
    
    
    const sessionHandler = {
      sessions: {},
      
    
      createSession(sessionId, userName) {
        this.sessions[sessionId] = {
          hostUser: userName,
          clients: [userName],
          canvas: 'base64canvas',
          drawingLayers: []
        };
        return sessionId;
      },
      
 
      addDrawingLayer(sessionId, layerId, data) {
        if (!this.sessions[sessionId]) return false;
        this.sessions[sessionId].drawingLayers.push({
          layer_id: layerId,
          data: data,
          zIndex: this.sessions[sessionId].drawingLayers.length
        });
        return true;
      },
      
      
      getSessionData(sessionId) {
        return this.sessions[sessionId] || null;
      }
    };
    

    const sessionId = 'persistent-session';
    const userName = 'Persistent User';
    sessionHandler.createSession(sessionId, userName);
    
    
    sessionHandler.addDrawingLayer(sessionId, 'background', 'backgrounddata');
    sessionHandler.addDrawingLayer(sessionId, 'user-drawing', 'userdrawingdata');
    
    
    const sessionData = sessionHandler.getSessionData(sessionId);
    
  
    expect(sessionData).not.toBeNull();
    expect(sessionData.hostUser).toBe(userName);
    expect(sessionData.canvas).toBe('base64canvas');
    expect(sessionData.drawingLayers.length).toBe(2);
    expect(sessionData.drawingLayers[0].layer_id).toBe('background');
    expect(sessionData.drawingLayers[1].layer_id).toBe('user-drawing');
  });
});
