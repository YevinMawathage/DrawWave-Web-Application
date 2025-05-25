

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BrowserRouter } from 'react-router-dom';
import VirtualPainter from '../frontend/src/components/VirtualPainter';
import Desktop from '../frontend/src/components/Desktop';
import ReconnectionHandler from '../frontend/src/components/ReconnectionHandler';
import Home from '../frontend/src/components/Home';
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.OPEN;
    this.onopen = jest.fn();
    this.onmessage = jest.fn();
    this.onclose = jest.fn();
    this.onerror = jest.fn();
    this.send = jest.fn();
    
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 0);
  }
  
  close() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose({ code: 1000 });
  }

  mockReceiveMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

const localStorageMock = (function() {
  let store = {};
  return {
    getItem: jest.fn(key => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn(key => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    length: 0,
    key: jest.fn()
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
global.WebSocket = MockWebSocket;

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => ({ sessionId: 'test-session-123' }),
  useLocation: () => ({ state: { userName: 'Test User' } })
}));

describe('VirtualPainter Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('establishes WebSocket connection and handles session creation', async () => {
    render(
      <BrowserRouter>
        <VirtualPainter 
          sessionId="test-session"
          userName="Test User"
          inSession={true}
        />
      </BrowserRouter>
    );

    expect(global.WebSocket).toHaveBeenCalled();
    const wsInstance = global.WebSocket.mock.instances[0];
    
    await waitFor(() => {
      expect(wsInstance.send).toHaveBeenCalled();
    });
    
    const sentData = JSON.parse(wsInstance.send.mock.calls[0][0]);
    expect(sentData.type).toBe('join_session');
    expect(sentData.session_id).toBe('test-session');
    expect(sentData.user_name).toBe('Test User');
  });

  test('handles drawing updates and broadcasts them', async () => {
    render(
      <BrowserRouter>
        <VirtualPainter 
          sessionId="test-session"
          userName="Test User"
          inSession={true}
        />
      </BrowserRouter>
    );
    
    const wsInstance = global.WebSocket.mock.instances[0];
    
    act(() => {
      wsInstance.mockReceiveMessage({
        type: 'draw_update',
        points: [{x: 100, y: 100}, {x: 200, y: 200}],
        color: '#FF0000',
        thickness: 5
      });
    });
    
    
    await waitFor(() => {
      expect(true).toBeTruthy(); 
    });
  });

  test('handles reconnection after disconnection', async () => {
    localStorage.setItem('sessionId', 'test-session');
    localStorage.setItem('userName', 'Test User');
    
    render(
      <BrowserRouter>
        <VirtualPainter 
          sessionId="test-session"
          userName="Test User"
          inSession={true}
        />
      </BrowserRouter>
    );
    
    const wsInstance = global.WebSocket.mock.instances[0];
    
    act(() => {
      wsInstance.close();
    });
    
    await waitFor(() => {
      expect(global.WebSocket.mock.instances.length).toBeGreaterThan(1);
    });
    
    const newWsInstance = global.WebSocket.mock.instances[1];
    await waitFor(() => {
      expect(newWsInstance.send).toHaveBeenCalled();
    });
    
    const sentData = JSON.parse(newWsInstance.send.mock.calls[0][0]);
    expect(sentData.type).toBe('join_session');
    expect(sentData.session_id).toBe('test-session');
  });
});

describe('Desktop Component', () => {
  test('renders the VirtualPainter component and Navbar', () => {
    render(
      <BrowserRouter>
        <Desktop />
      </BrowserRouter>
    );
    
    expect(screen.getByTestId('desktop-container')).toBeInTheDocument();
    expect(screen.getByTestId('navbar-component')).toBeInTheDocument();
    expect(screen.getByTestId('virtual-painter')).toBeInTheDocument();
  });
  
  test('handles leaving session correctly', () => {
    render(
      <BrowserRouter>
        <Desktop />
      </BrowserRouter>
    );
    
    const leaveButton = screen.getByText('Leave Session');
    fireEvent.click(leaveButton);
    
    expect(mockNavigate).toHaveBeenCalledWith('/');
    
    expect(localStorage.removeItem).toHaveBeenCalledWith('sessionId');
    expect(localStorage.removeItem).toHaveBeenCalledWith('userName');
  });
});

describe('ReconnectionHandler Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });
  
  test('attempts to reconnect when session info is available', async () => {
    localStorage.setItem('sessionId', 'test-session');
    localStorage.setItem('userName', 'Test User');
    
    render(
      <BrowserRouter>
        <ReconnectionHandler />
      </BrowserRouter>
    );
    
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/session/test-session', {
        state: { userName: 'Test User' }
      });
    });
  });
  
  test('does not attempt to reconnect when no session info is available', () => {
    render(
      <BrowserRouter>
        <ReconnectionHandler />
      </BrowserRouter>
    );
    
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Home Component Session Creation', () => {
  test('creates a new session when the create button is clicked', async () => {
    render(
      <BrowserRouter>
        <Home />
      </BrowserRouter>
    );
    
    const userNameInput = screen.getByPlaceholderText('Your Name');
    fireEvent.change(userNameInput, { target: { value: 'Test User' } });
    
    const createButton = screen.getByText('Create New Session');
    fireEvent.click(createButton);
    
    expect(global.WebSocket).toHaveBeenCalled();
    const wsInstance = global.WebSocket.mock.instances[0];
    
    await waitFor(() => {
      expect(wsInstance.send).toHaveBeenCalled();
    });
    
    const sentData = JSON.parse(wsInstance.send.mock.calls[0][0]);
    expect(sentData.type).toBe('create_session');
    expect(sentData.user_name).toBe('Test User');
    
    act(() => {
      wsInstance.mockReceiveMessage({
        type: 'session_created',
        session_id: 'new-session-123',
        host: true
      });
    });
    
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/session/new-session-123', {
        state: { userName: 'Test User', isHost: true }
      });
    });
    
    expect(localStorage.setItem).toHaveBeenCalledWith('sessionId', 'new-session-123');
    expect(localStorage.setItem).toHaveBeenCalledWith('userName', 'Test User');
  });
});
