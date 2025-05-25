import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReconnectionHandler from './ReconnectionHandler';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';

// Interface for DrawAction to track drawing history
interface DrawAction {
  type: 'draw' | 'erase' | 'clear';
  points?: { x: number, y: number }[];
  timestamp: number;
}

// Interface for VirtualPainter props
interface VirtualPainterProps {
  onSessionUpdate?: (isInSession: boolean, currentSessionId: string, hostStatus: boolean) => void;
  downloadRef?: React.MutableRefObject<(() => void) | null>;
}

const VirtualPainter = ({ onSessionUpdate, downloadRef }: VirtualPainterProps) => {
  // Get auth context to access user information
  const { user, isAuthenticated } = useAuth();
  
  // State for gesture guide popup
  const [isGestureGuideOpen, setIsGestureGuideOpen] = useState<boolean>(false);
  
  // State for hand cursor tracking
  const [cursorPosition, setCursorPosition] = useState<{x: number, y: number} | null>(null);
  const [cursorMode, setCursorMode] = useState<string>('idle');
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null); // Dedicated canvas for cursor
  const cursorPulseRef = useRef<number>(0); // For cursor pulsing animation
  const cursorAnimationRef = useRef<number | null>(null); // For animation frame
  
  // Set username from auth context when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user && user.name) {
      setUserName(user.name);
      // Store authenticated username in localStorage
      localStorage.setItem('drawwave_userName', user.name);
    }
  }, [isAuthenticated, user]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const [wsConnection, setWsConnection] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState('#000000');
  const requestRef = useRef<number | null>(null);
  const [frameRate, setFrameRate] = useState(5); // frames per second - increased default
  
  // Session management states
  const [sessionId, setSessionId] = useState(() => {
    return localStorage.getItem('drawwave_sessionId') || '';
  }); // Current session ID when connected
  const [_roomId, setRoomId] = useState(() => {
    return localStorage.getItem('drawwave_roomId') || '';
  }); // Room ID associated with the session - using underscore prefix to indicate intentionally unused state
  
  // Connection status for user feedback
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const [reconnectStatus, setReconnectStatus] = useState<string>('');
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const maxReconnectAttempts = 3; // Maximum number of reconnection attempts
  const reconnectTimeoutsRef = useRef<number[]>([]);
  

  const [createRoomInput, setCreateRoomInput] = useState<string>('');
  const [joinSessionInput, setJoinSessionInput] = useState<string>('');
  const [_participants, setParticipants] = useState<number>(0); // Using underscore prefix to indicate intentionally unused state
  const [inSession, setInSession] = useState<boolean>(() => {
    return localStorage.getItem('drawwave_inSession') === 'true';
  });
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('drawwave_userName') || '';
  });

  // Mouse drawing state
  const [isMouseDrawing, setIsMouseDrawing] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [prevPoint, setPrevPoint] = useState<{x: number, y: number} | null>(null);
  
  // Drawing history for undo functionality
  const [drawHistory, setDrawHistory] = useState<DrawAction[]>([]);
  const [currentDrawAction, setCurrentDrawAction] = useState<{points: {x: number, y: number}[], type: 'draw' | 'erase'} | null>(null);
  
  // Track last undo time to prevent rapid multiple undos
  const lastUndoTimeRef = useRef<number>(0);

  // UI state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  
  // Function to handle leaving a room
  const handleLeaveRoom = useCallback(() => {
    console.log('Leaving room...');
    
    // Notify server about participant leaving if connected
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      try {
        // The server doesn't have a specific 'leave_session' message type,
        // but we'll send a message anyway for future compatibility
        wsConnection.send(JSON.stringify({
          type: 'participant_leaving',
          session_id: sessionId,
          user_name: userName
        }));
      } catch (error) {
        console.error('Error sending leave message:', error);
      }
    }
    
    // Clear session data
    clearSessionFromLocalStorage();
    
    // Update state
    setInSession(false);
    setSessionId('');
    setRoomId('');
    
    // Reset canvas if needed
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    if (drawingCanvasRef.current) {
      const ctx = drawingCanvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    }
    
    // Reset drawing history
    setDrawHistory([]);
    
    // Notify App component about session state change
    if (onSessionUpdate) {
      onSessionUpdate(false, '', false);
    }
    
    console.log('Successfully left room');
  }, [wsConnection, sessionId, userName, onSessionUpdate]);

  // We'll define the handleReconnect function after connectWebSocket is defined
  
  // Add event listener for the leaveRoom event
  useEffect(() => {
    const leaveRoomListener = () => {
      handleLeaveRoom();
    };
    
    window.addEventListener('leaveRoom', leaveRoomListener);
    
    return () => {
      window.removeEventListener('leaveRoom', leaveRoomListener);
    };
  }, [handleLeaveRoom]);
  
  // Mouse drawing functions  
  const toggleMouseDrawing = () => {
    const newValue = !isMouseDrawing;
    
    // Save the current drawing canvas state before toggling
    let currentDrawingState = null;
    if (drawingCanvasRef.current) {
      currentDrawingState = drawingCanvasRef.current.toDataURL('image/png');
    }
    
    setIsMouseDrawing(newValue);
    
    // Reset prevPoint to prevent connecting lines between modes
    setPrevPoint(null);
    
    // Ensure any ongoing drawing is stopped
    if (isDrawing) {
      stopDrawing();
    }
    
    // If mouse drawing is turned on, pause the video processing to stop gesture drawing
    if (newValue && videoRef.current) {
      const videoStream = videoRef.current.srcObject as MediaStream;
      if (videoStream) {
        // Pause or resume video tracks based on mouse drawing state
        videoStream.getVideoTracks().forEach(track => {
          track.enabled = !newValue; // Disable tracks when mouse drawing is enabled
        });
      }
    } else if (videoRef.current) {
      // Resume video if mouse drawing is turned off
      const videoStream = videoRef.current.srcObject as MediaStream;
      if (videoStream) {
        videoStream.getVideoTracks().forEach(track => {
          track.enabled = true;
        });
      }
    }
    
    // Restore the drawing canvas state after toggling
    if (currentDrawingState && drawingCanvasRef.current) {
      setTimeout(() => {
        const img = new Image();
        img.onload = () => {
          if (drawingCanvasRef.current) {
            const ctx = drawingCanvasRef.current.getContext('2d');
            if (ctx) {
              // Don't clear the canvas, just draw the saved state on top
              ctx.drawImage(img, 0, 0);
            }
          }
        };
        img.src = currentDrawingState;
      }, 50); // Small delay to ensure canvas is ready
    }
  };

  // Throttle function to limit the frequency of function calls
  const throttle = (callback: Function, delay: number) => {
    let lastCall = 0;
    return function(...args: any[]) {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        callback(...args);
      }
    };
  };

  const startDrawing = (x: number, y: number) => {
    // Ensure any previous drawing is properly stopped
    if (isDrawing) {
      stopDrawing();
    }
    
    // Reset the previous point - this is crucial to prevent connecting to previous lines
    setPrevPoint(null);
    
    // Now set drawing state
    setIsDrawing(true);
    
    // Set the first point of this new drawing path
    setPrevPoint({ x, y });
    
    // Initialize a new drawing action
    setCurrentDrawAction({
      type: 'draw',
      points: [{ x, y }]
    });
    
    // Draw a dot at the start point to ensure we have something visible
    // for individual dots or when starting a new path
    const drawingCanvas = drawingCanvasRef.current;
    if (drawingCanvas) {
      const ctx = drawingCanvas.getContext('2d');
      if (ctx) {
        const scaleFactor = {
          x: drawingCanvas.width / drawingCanvas.offsetWidth,
          y: drawingCanvas.height / drawingCanvas.offsetHeight
        };
        
        const scaledX = x * scaleFactor.x;
        const scaledY = y * scaleFactor.y;
        
        // Clear any existing path to ensure we're starting fresh
        ctx.beginPath();
        ctx.strokeStyle = selectedColor;
        ctx.fillStyle = selectedColor;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        
        // Draw a small circle at the starting point
        ctx.arc(scaledX, scaledY, 2.5, 0, 2 * Math.PI);
        ctx.fill();
        
        // Explicitly begin a new path after drawing the dot
        ctx.beginPath();
      }
    }
    
    // If we're in a session, send this initial point to the server
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN && sessionId) {
      wsConnection.send(JSON.stringify({
        type: 'start_drawing',
        position: { x, y },
        sessionId: sessionId
      }));
    }
  };

  const sendDrawingUpdate = useRef(
    throttle((canvas: HTMLCanvasElement) => {
      if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;
      
      const drawingDataURL = canvas.toDataURL('image/png');
      wsConnection.send(JSON.stringify({
        type: 'drawing_update',
        drawing: drawingDataURL
      }));
    }, 500) // Throttle to one update every 500ms
  ).current;

  const stopDrawing = () => {
    if (!isDrawing) return;
    
    setIsDrawing(false);
    setPrevPoint(null);
    
    // Finalize the current drawing action and add to history
    if (currentDrawAction && currentDrawAction.points.length > 0) {
      const newAction: DrawAction = {
        type: currentDrawAction.type,
        points: currentDrawAction.points,
        timestamp: Date.now()
      };
      
      setDrawHistory(prev => [...prev, newAction]);
      
      // Store drawing action in localStorage
      const sessionDrawHistory = JSON.parse(localStorage.getItem(`drawwave_history_${sessionId}`) || '[]');
      sessionDrawHistory.push(newAction);
      localStorage.setItem(`drawwave_history_${sessionId}`, JSON.stringify(sessionDrawHistory));
      
      setCurrentDrawAction(null);
    }
    
    // Send a final update to ensure the canvas state is synchronized
    const drawingCanvas = drawingCanvasRef.current;
    if (drawingCanvas && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      const drawingDataURL = drawingCanvas.toDataURL('image/png');
      wsConnection.send(JSON.stringify({
        type: 'drawing_update',
        drawing: drawingDataURL,
        isFinal: true
      }));
    }
  };
  
  // State to show undo feedback animation
  const [showUndoFeedback, setShowUndoFeedback] = useState<boolean>(false);

  // Handle undo action
  const handleUndo = useCallback(() => {
    // Prevent rapid multiple undos by enforcing a minimum time between undos (300ms)
    const now = Date.now();
    if (now - lastUndoTimeRef.current < 300) {
      console.log('Undo throttled');
      return;
    }
    lastUndoTimeRef.current = now;
    
    if (drawHistory.length === 0) {
      console.log('Nothing to undo');
      return;
    }
    
    console.log('Performing undo operation');
    
    // Show visual feedback for undo action
    setShowUndoFeedback(true);
    setTimeout(() => setShowUndoFeedback(false), 1000); // Hide after 1 second
    
    // Remove the last action from history
    const newHistory = [...drawHistory];
    newHistory.pop();
    setDrawHistory(newHistory);
    
    // Update localStorage
    localStorage.setItem(`drawwave_history_${sessionId}`, JSON.stringify(newHistory));
    
    // If connected to a session, broadcast the undo to others
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN && sessionId) {
      wsConnection.send(JSON.stringify({
        type: 'undo_action',
        session_id: sessionId
      }));
    }
    
    // Redraw canvas from scratch based on remaining history
    const drawingCanvas = drawingCanvasRef.current;
    if (drawingCanvas) {
      const ctx = drawingCanvas.getContext('2d');
      if (ctx) {
        // Clear canvas
        ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        
        // Replay all remaining drawing actions
        for (const action of newHistory) {
          if (action.type === 'clear') {
            ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
          } else if (action.type === 'draw' && action.points && action.points.length > 1) {
            // Redraw the strokes
            ctx.beginPath();
            ctx.strokeStyle = selectedColor; // Note: this will use current color, not original
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            const scaleFactor = {
              x: drawingCanvas.width / drawingCanvas.offsetWidth,
              y: drawingCanvas.height / drawingCanvas.offsetHeight
            };
            
            // Draw path from points
            const firstPoint = action.points[0];
            ctx.moveTo(
              firstPoint.x * scaleFactor.x,
              firstPoint.y * scaleFactor.y
            );
            
            for (let i = 1; i < action.points.length; i++) {
              const point = action.points[i];
              ctx.lineTo(
                point.x * scaleFactor.x,
                point.y * scaleFactor.y
              );
            }
            ctx.stroke();
          }
        }
        
        // Send the updated canvas to the server
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
          const updatedDrawingDataURL = drawingCanvas.toDataURL('image/png');
          wsConnection.send(JSON.stringify({
            type: 'drawing_update',
            drawing: updatedDrawingDataURL,
            isFinal: true
          }));
        }
      }
    }
  }, [drawHistory, sessionId, selectedColor, wsConnection]);
  
  const draw = (x: number, y: number) => {
    if (!isDrawing) return;

    const drawingCanvas = drawingCanvasRef.current;
    if (!drawingCanvas) return;

    const ctx = drawingCanvas.getContext('2d');
    if (!ctx) return;

    // Convert normalized coordinates (0-1) to actual canvas pixels
    const scaledX = x * drawingCanvas.width;
    const scaledY = y * drawingCanvas.height;
    
    // If we have a previous point, draw a line from it to current point
    if (prevPoint) {
      const scaledPrevX = prevPoint.x * drawingCanvas.width;
      const scaledPrevY = prevPoint.y * drawingCanvas.height;
      
      ctx.beginPath();
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(scaledPrevX, scaledPrevY);
      ctx.lineTo(scaledX, scaledY);
      ctx.stroke();
    } else {
      // If no previous point, just draw a dot at the current position
      ctx.beginPath();
      ctx.fillStyle = selectedColor;
      ctx.arc(scaledX, scaledY, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Update previous point with normalized coordinates
    setPrevPoint({ x, y });
    
    // Update current drawing action with normalized coordinates
    if (currentDrawAction) {
      setCurrentDrawAction(prev => {
        if (prev) {
          return {
            ...prev,
            points: [...prev.points, { x, y }]
          };
        }
        return prev;
      });
    }
    
    // Throttled sending of drawing updates to the server
    sendDrawingUpdate(drawingCanvas);
  };

const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
  if (!isMouseDrawing) return;
  
  const canvas = drawingCanvasRef.current;
  if (!canvas) return;
  
  const rect = canvas.getBoundingClientRect();
  
  // Calculate the normalized position (0 to 1) for consistent scaling
  const normalizedX = (e.clientX - rect.left) / rect.width;
  const normalizedY = (e.clientY - rect.top) / rect.height;
  
  // Use normalized coordinates for drawing
  startDrawing(normalizedX, normalizedY);
};

const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
  if (!isMouseDrawing || !isDrawing) return;
  
  const canvas = drawingCanvasRef.current;
  if (!canvas) return;
  
  const rect = canvas.getBoundingClientRect();
  
  // Calculate the normalized position (0 to 1) for consistent scaling
  const normalizedX = (e.clientX - rect.left) / rect.width;
  const normalizedY = (e.clientY - rect.top) / rect.height;
  
  // Use normalized coordinates for drawing
  draw(normalizedX, normalizedY);
};

const handleMouseUp = () => {
  if (!isMouseDrawing) return;
  stopDrawing();
};

const handleMouseLeave = () => {
  if (!isMouseDrawing) return;
  stopDrawing();
};

  // Function to clear session data from localStorage
  const clearSessionFromLocalStorage = () => {
    localStorage.removeItem('drawwave_sessionId');
    localStorage.removeItem('drawwave_roomId');
    localStorage.removeItem('drawwave_inSession');
    // Don't remove userName as we want to remember it for next time
    console.log('Session data cleared from localStorage');
    
    // Notify App component about session state change
    if (onSessionUpdate) {
      onSessionUpdate(false, '', false);
    }
  };

  // Function to connect to WebSocket server
  const connectWebSocket = useCallback(() => {
    // Clear any existing reconnection timeouts
    reconnectTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
    reconnectTimeoutsRef.current = [];
    
    // Get WebSocket URL from environment variables or fallback to dynamic determination
    let WS_URL = import.meta.env.VITE_WEBSOCKET_URL;
    
    // If no environment variable is set, fall back to automatic detection
    if (!WS_URL) {
      const host = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
      WS_URL = `ws://${host}:8765`;
      console.log('No WebSocket URL environment variable found, using auto-detected URL');
    }
    
    console.log('Connecting to WebSocket server at:', WS_URL);
    
    // Create a new WebSocket connection
    const ws = new WebSocket(WS_URL);
    setWsConnection(ws);
    
    // Setup WebSocket event handlers
    ws.onopen = () => {
      console.log('Connected to WebSocket server');
      setConnected(true);
      setReconnecting(false);
      setReconnectStatus(''); // Clear reconnection status message
      setError(null);
      setReconnectAttempts(0);
      
      // If we're in a session, attempt to reconnect using join_session
      if (inSession && sessionId) {
        console.log('Attempting to reconnect to existing session:', sessionId);
        ws.send(JSON.stringify({
          type: 'join_session',
          session_id: sessionId,
          user_name: userName
        }));
      }
    };
    
    ws.onclose = (event) => {
      console.log(`WebSocket connection closed: ${event.code}`);
      setConnected(false);
      
      // Only show error if we were already in a session
      if (inSession) {
        setError('Connection to drawing server lost');
      }
    };
    
    ws.onerror = () => {
      console.error('WebSocket connection error');
      setConnected(false);
      
      // Only show error if we were already in a session
      if (inSession) {
        setError('WebSocket connection error');
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Received WebSocket message:', data.type);
        
        // Various gesture-related message types are handled outside the switch
        if (data.type === "hand_position") {
          // Update cursor position with smoothing
          setCursorPosition(prevPos => {
            // If first position, just use the new position
            if (!prevPos) return data.position;
            
            // Apply smoothing - 70% previous position, 30% new position for more natural movement
            return {
              x: prevPos.x * 0.7 + data.position.x * 0.3,
              y: prevPos.y * 0.7 + data.position.y * 0.3
            };
          });
          
          // Store the previous gesture mode
          const previousMode = cursorMode;
          
          // Set the new gesture mode
          setCursorMode(data.mode);
          
          // Handle drawing/not drawing transitions based on gesture changes
          if (data.mode === 'drawing') {
            // If transitioning from non-drawing to drawing, ensure we start a new line
            if (previousMode !== 'drawing') {
              // If we were already drawing, stop first to create a break between lines
              if (isDrawing) {
                stopDrawing();
              }
              
              // Start a new drawing action at the current position
              startDrawing(data.position.x, data.position.y);
            } else if (isDrawing) {
              // Continue drawing if we're already in drawing mode
              draw(data.position.x, data.position.y);
            }
          } else {
            // If we're transitioning away from drawing mode, stop drawing
            if (previousMode === 'drawing' && isDrawing) {
              stopDrawing();
            }
            
            // Handle other gestures as needed
            if (data.mode === 'erase') {
              // Handle eraser if implemented
            } else if (data.mode === 'undo' && Date.now() - lastUndoTimeRef.current > 1000) {
              // Execute undo with throttling to prevent rapid multiple undos
              handleUndo();
              lastUndoTimeRef.current = Date.now();
            }
          }
          return; // Process this separately from the switch
        } else if (data.type === "gesture_start") {
          // Server signals the start of a new gesture (drawing or erasing)
          console.log('Received gesture_start:', data.gesture);
          if (data.gesture === "drawing") {
            // If we were already drawing, ensure we stop first to create a gap
            if (isDrawing) {
              stopDrawing();
            }
            // Don't actually start drawing yet - we'll wait for the first point
            // Just make sure previous state is cleared
            setPrevPoint(null);
          }
          return; // Process separately
        } else if (data.type === "gesture_complete") {
          // Server signals the end of a gesture
          console.log('Received gesture_complete for:', data.previous);
          if (data.previous === "drawing" && isDrawing) {
            stopDrawing();
          }
          return; // Process separately
        } else if (data.type === "gesture_point") {
          // Server is sending individual points for a gesture
          console.log('Received gesture_point:', data.gesture, data.point);
          if (data.gesture === "drawing") {
            if (!isDrawing) {
              // If we weren't already drawing, start a new drawing action
              startDrawing(data.point.x, data.point.y);
            } else {
              // Continue the current drawing
              draw(data.point.x, data.point.y);
            }
          } else if (data.gesture === "erase") {
            // Handle eraser points if implemented
          }
          return; // Process separately
        } else if (data.type === "gesture_action") {
          // Server signals a gesture action like undo
          console.log('Received gesture_action:', data.action);
          if (data.action === "undo") {
            handleUndo();
          }
          return; // Process separately
        }
        
        // Handle different message types
        switch(data.type) {
          case 'error':
            console.error('Connection error:', data.message);
            setError(`Error: ${data.message}`);
            
            // If the error is session not found, clear session data
            if (data.errorCode === 'session_not_found' || data.errorCode === 'no_active_session') {
              setInSession(false);
              clearSessionFromLocalStorage();
              
              // Notify App component about session state change
              if (onSessionUpdate) {
                onSessionUpdate(false, '', false);
              }
            }
            break;
            
          // Handle other message types
          case 'session_created':
            setSessionId(data.session_id);
            setRoomId(data.room_id);
            setInSession(true);
            setParticipants(1);
            
            // Save session data to localStorage
            localStorage.setItem('drawwave_sessionId', data.session_id);
            localStorage.setItem('drawwave_roomId', data.room_id);
            localStorage.setItem('drawwave_inSession', 'true');
            localStorage.setItem('drawwave_userName', userName);
            
            // Notify App component about session state change
            if (onSessionUpdate) {
              onSessionUpdate(true, data.session_id, true); // true for isHost since this is session creation
            }
            break;
            
          case 'session_joined':
            console.log('Successfully joined/reconnected to session:', data.session_id);
            setSessionId(data.session_id);
            setRoomId(data.room_id);
            setInSession(true);
            setParticipants(data.participants || 1);
            
            // Clear any reconnection states
            setReconnecting(false);
            setReconnectAttempts(0);
            
            // Show success message if we were reconnecting
            if (reconnecting) {
              setReconnectStatus('Successfully reconnected to session!');
              // Clear reconnection status after a delay
              setTimeout(() => {
                setReconnectStatus('');
              }, 3000);
            }
            
            // Save session data to localStorage
            localStorage.setItem('drawwave_sessionId', data.session_id);
            localStorage.setItem('drawwave_roomId', data.room_id);
            localStorage.setItem('drawwave_inSession', 'true');
            localStorage.setItem('drawwave_userName', userName);
            
            // Load drawing history from localStorage for this session
            try {
              const savedHistory = localStorage.getItem(`drawwave_history_${data.session_id}`);
              if (savedHistory) {
                const parsedHistory = JSON.parse(savedHistory) as DrawAction[];
                if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
                  console.log(`Restored ${parsedHistory.length} drawing actions from localStorage`);
                  setDrawHistory(parsedHistory);
                }
              }
            } catch (error) {
              console.error('Error restoring drawing history from localStorage:', error);
            }
            
            // Notify App component about session state change
            if (onSessionUpdate) {
              onSessionUpdate(true, data.session_id, false); // false for isHost since this is joining
            }
            
            // Apply canvas and drawing data if available
            if (data.canvas) {
              console.log('Restoring canvas state from server');
              const canvasImg = new Image();
              canvasImg.onload = () => {
                if (canvasRef.current) {
                  const ctx = canvasRef.current.getContext('2d');
                  if (ctx) {
                    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                    ctx.drawImage(canvasImg, 0, 0);
                  }
                }
              };
              canvasImg.src = data.canvas;
            }
            
            if (data.drawing) {
              console.log('Restoring drawing layer from server');
              const drawingImg = new Image();
              drawingImg.onload = () => {
                if (drawingCanvasRef.current) {
                  const ctx = drawingCanvasRef.current.getContext('2d');
                  if (ctx) {
                    ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
                    ctx.drawImage(drawingImg, 0, 0);
                  }
                }
              };
              drawingImg.src = data.drawing;
            }
            
            // Clear any error messages when successfully joined
            setError(null);
            break;
            
          case 'canvas_update':
            if (data.canvas) {
              const img = new Image();
              img.onload = () => {
                if (canvasRef.current) {
                  const ctx = canvasRef.current.getContext('2d');
                  if (ctx) ctx.drawImage(img, 0, 0);
                }
              };
              img.src = data.canvas;
            }
            break;
            
          case 'drawing_update':
            if (data.drawing) {
              const img = new Image();
              img.onload = () => {
                if (drawingCanvasRef.current) {
                  const ctx = drawingCanvasRef.current.getContext('2d');
                  if (ctx) ctx.drawImage(img, 0, 0);
                }
              };
              img.src = data.drawing;
            }
            break;
            
          case 'participant_joined':
          case 'participant_left':
            setParticipants(data.participants);
            break;
            
          case 'clear_canvas':
            if (canvasRef.current) {
              const ctx = canvasRef.current.getContext('2d');
              if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }
            if (drawingCanvasRef.current) {
              const ctx = drawingCanvasRef.current.getContext('2d');
              if (ctx) ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
            }
            break;
            
          // Process gesture-based undo action
          case 'gesture_action':
            if (data.action === 'undo') {
              console.log('Received undo gesture action from backend');
              // Trigger the undo action
              handleUndo();
            }
            break;
            
          default:
            console.log('Unhandled message type:', data.type);
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    return ws;
  }, [inSession, sessionId, userName]);
  
  // Function to handle manual reconnection from the ReconnectionHandler component
  const handleReconnect = useCallback(() => {
    console.log('Manual reconnection requested');
    setReconnectAttempts(0); // Reset attempt counter for manual reconnection
    
    // If we have session data in localStorage, try to reconnect
    const storedSessionId = localStorage.getItem('drawwave_sessionId');
    const storedUserName = localStorage.getItem('drawwave_userName');
    
    if (storedSessionId && storedUserName && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      // Send a join_session message to reconnect
      wsConnection.send(JSON.stringify({
        type: 'join_session',
        session_id: storedSessionId,
        user_name: storedUserName
      }));
      console.log('Reconnection attempt sent with session ID:', storedSessionId);
    } else {
      // If WebSocket is not connected, reconnect it first
      connectWebSocket();
      console.log('WebSocket not connected, reconnecting first');
    }
  }, [connectWebSocket, wsConnection]);

  // Function to attempt reconnection with exponential backoff
  const attemptReconnect = useCallback(() => {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error(`Failed to reconnect after ${maxReconnectAttempts} attempts`);
      setError('Failed to connect after several attempts. Please refresh the page.');
      return;
    }
    
    setReconnectAttempts(prev => prev + 1);
    const attemptNumber = reconnectAttempts + 1;
    const delay = Math.min(1000 * Math.pow(2, attemptNumber - 1), 10000); // Exponential backoff capped at 10s
    
    console.log(`Attempting to reconnect in ${delay/1000} seconds (attempt ${attemptNumber})`);
    setReconnectStatus(`Reconnecting to server... (attempt ${attemptNumber}/${maxReconnectAttempts})`);
    setReconnecting(true);
    
    const timeoutId = window.setTimeout(() => {
      connectWebSocket();
    }, delay);
    
    reconnectTimeoutsRef.current.push(timeoutId);
  }, [reconnectAttempts, maxReconnectAttempts, connectWebSocket]);

  // Function to render cursor on the cursor canvas
  const renderCursor = useCallback(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas || !cursorPosition) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear previous cursor
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Calculate pixel coordinates from normalized coordinates
    const x = cursorPosition.x * canvas.width;
    const y = cursorPosition.y * canvas.height;
    
    // Update cursor pulse value (0-1-0 oscillation for animation)
    cursorPulseRef.current += 0.05;
    if (cursorPulseRef.current > 1) cursorPulseRef.current = 0;
    
    // Pulse size effect - make cursor slightly grow and shrink
    const pulse = Math.sin(cursorPulseRef.current * Math.PI) * 3;
    
    // Draw different cursor styles based on mode
    ctx.save();
    
    if (cursorMode === 'drawing') {
      // Drawing cursor - blue circular cursor with crosshair
      const baseSize = 15 + pulse;
      
      // Outer circle
      ctx.beginPath();
      ctx.arc(x, y, baseSize, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 165, 255, 0.4)';
      ctx.fill();
      
      // Inner circle
      ctx.beginPath();
      ctx.arc(x, y, baseSize/2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 165, 255, 0.7)';
      ctx.fill();
      
      // White border
      ctx.beginPath();
      ctx.arc(x, y, baseSize, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Crosshair
      ctx.beginPath();
      ctx.moveTo(x - baseSize, y);
      ctx.lineTo(x + baseSize, y);
      ctx.moveTo(x, y - baseSize);
      ctx.lineTo(x, y + baseSize);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      
    } else if (cursorMode === 'erase') {
      // Eraser cursor - larger red circular cursor
      const baseSize = 25 + pulse;
      
      // Outer circle with transparency
      ctx.beginPath();
      ctx.arc(x, y, baseSize, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.fill();
      
      // Inner circle
      ctx.beginPath();
      ctx.arc(x, y, baseSize/3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
      ctx.fill();
      
      // White border
      ctx.beginPath();
      ctx.arc(x, y, baseSize, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Eraser symbol
      ctx.font = '16px Arial';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', x, y);
      
    } else { 
      // Idle cursor - neutral cursor with pulsing effect
      const baseSize = 12 + pulse;
      
      // Main circle
      ctx.beginPath();
      ctx.arc(x, y, baseSize, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(100, 100, 255, 0.5)';
      ctx.fill();
      
      // Inner dot
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();
      
      // Outer ring
      ctx.beginPath();
      ctx.arc(x, y, baseSize, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    ctx.restore();
    
    // Continue animation loop
    cursorAnimationRef.current = requestAnimationFrame(renderCursor);
  }, [cursorPosition, cursorMode]);
  
  // Start and stop cursor animation when position changes or component unmounts
  useEffect(() => {
    if (cursorPosition) {
      renderCursor();
    }
    
    return () => {
      if (cursorAnimationRef.current) {
        cancelAnimationFrame(cursorAnimationRef.current);
      }
    };
  }, [cursorPosition, renderCursor]);

  useEffect(() => {
    return () => {
      if (wsConnection) {
        wsConnection.onopen = null;
        wsConnection.onclose = null;
        wsConnection.onerror = null;
        wsConnection.onmessage = null;
        wsConnection.close();
      }
      
      // Clear any reconnection timeouts
      reconnectTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
      reconnectTimeoutsRef.current = [];
      
      // Also clean up cursor animation
      if (cursorAnimationRef.current) {
        cancelAnimationFrame(cursorAnimationRef.current);
      }
    };
  }, [inSession, sessionId, userName]);

  // Setup keyboard event listener for Ctrl+Z
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+Z (Windows/Linux) or Command+Z (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleUndo]);
  
  // Load drawing history from localStorage when session changes
  useEffect(() => {
    if (sessionId) {
      const savedHistory = localStorage.getItem(`drawwave_history_${sessionId}`);
      if (savedHistory) {
        try {
          const parsedHistory = JSON.parse(savedHistory) as DrawAction[];
          setDrawHistory(parsedHistory);
        } catch (error) {
          console.error('Error parsing drawing history:', error);
          localStorage.removeItem(`drawwave_history_${sessionId}`);
        }
      } else {
        setDrawHistory([]);
      }
    }
  }, [sessionId]);
  
  // Use useEffect to setup WebSocket connection and event handlers
  useEffect(() => {
    connectWebSocket();
    
    // Setup automatic reconnection when connection is lost
    if (!connected && inSession) {
      attemptReconnect();
    }
  }, [inSession, connected, connectWebSocket, attemptReconnect]);

  // Initialize webcam
  useEffect(() => {
    // Only initialize camera if in a session
    if (!inSession) return;
    
    console.log('Initializing webcam...');
    const startCamera = async () => {
      try {
        console.log('Requesting camera permissions...');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: 640, 
            height: 480,
            facingMode: 'user' 
          } 
        });
        
        console.log('Camera access granted, setting up video element');
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            console.log('Video metadata loaded, playing video');
            videoRef.current?.play()
              .then(() => {
                console.log('Video playback started successfully');
                setCameraReady(true);
              })
              .catch(err => {
                console.error('Video playback failed:', err);
              });
          };
        }
      } catch (err) {
        console.error('Error accessing webcam:', err);
        setError('Could not access webcam. Please ensure camera permissions are enabled in your browser settings.');
      }
    };
    
    startCamera();
    
    return () => {
      // Capture the ref value in a variable to avoid the warning
      const videoElement = videoRef.current;
      const stream = videoElement?.srcObject as MediaStream;
      if (stream) {
        console.log('Cleaning up webcam stream');
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [inSession]); // Re-initialize camera when inSession changes

  // Send frames to WebSocket server
  useEffect(() => {
    if (!wsConnection || !connected || !inSession) return;
    
    console.log('Setting up frame sending...');
    
    const sendFrame = () => {
      // Skip frame sending if mouse drawing is enabled
      if (isMouseDrawing) {
        // Still keep the loop going, just don't send frames
        const frameInterval = 1000 / frameRate;
        requestRef.current = requestAnimationFrame(() => {
          setTimeout(sendFrame, frameInterval);
        });
        return;
      }
      
      if (videoRef.current && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        // Only proceed if video has dimensions and is playing
        if (!videoRef.current.videoWidth || !videoRef.current.videoHeight) {
          console.log("Video not ready yet, waiting...");
          requestRef.current = requestAnimationFrame(() => {
            setTimeout(sendFrame, 100);
          });
          return;
        }
        
        try {
          const canvas = document.createElement('canvas');
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            console.error("Failed to get canvas context");
            return;
          }
          
          // Mirror the image horizontally
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          
          // Reset transform
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          
          // Reduce quality to improve performance and reduce bandwidth
          const frame = canvas.toDataURL('image/jpeg', 0.6);
          
          // Validate frame data
          if (!frame || !frame.startsWith('data:image/jpeg;base64,')) {
            console.error("Invalid frame data generated");
            return;
          }
          
          // Only send frame to server if:  
          // 1. We're not in mouse drawing mode
          // 2. We have a valid WebSocket connection
          // 3. We're actually in a session
          // 4. We have a valid session ID
          if (wsConnection && 
              wsConnection.readyState === WebSocket.OPEN && 
              inSession && 
              sessionId) {
            wsConnection.send(JSON.stringify({
              type: 'frame',
              frame
            }));
          } else if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            // If we're not in a session but trying to send frames, that's an issue
            // Log it once rather than repeatedly using a local variable to avoid spamming console
            const warningKey = 'drawwave_logged_session_warning';
            const hasLoggedWarning = sessionStorage.getItem(warningKey) === 'true';
            
            if (!hasLoggedWarning) {
              console.warn('Not sending frames - no active session');
              sessionStorage.setItem(warningKey, 'true');
              
              // Reset this flag after a delay so we don't spam the console but will log again if the issue persists
              setTimeout(() => {
                sessionStorage.removeItem(warningKey);
              }, 5000);
            }
          }
        } catch (err) {
          console.error('Error capturing frame:', err);
        }
      }
      
      // Calculate frame interval based on frameRate
      const frameInterval = 1000 / frameRate;
      requestRef.current = requestAnimationFrame(() => {
        setTimeout(sendFrame, frameInterval);
      });
    };
    
    sendFrame();
    
    // Set up drawing canvas to match size of main canvas
    if (canvasRef.current && drawingCanvasRef.current) {
      drawingCanvasRef.current.width = canvasRef.current.width;
      drawingCanvasRef.current.height = canvasRef.current.height;
    }
    
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [wsConnection, connected, frameRate, inSession, isMouseDrawing]);

  // Session management functions
  // Modified handleCreateSession
  const handleCreateSession = async () => {
    // Use authenticated user's name if available, otherwise check manually entered name
    const displayName = isAuthenticated && user ? user.name : userName;
    
    // Validate that a name exists
    if (!displayName.trim()) {
      setError('Please sign in with Google or enter your name');
      return;
    }
    
    // Validate that a room code has been generated
    if (!createRoomInput.trim()) {
      setError('Please generate a room code first');
      return;
    }
    
    // Save username in localStorage as soon as they attempt to create
    localStorage.setItem('drawwave_userName', userName);
    
    try {
      // Generate a unique session ID (different from room ID)
      const generatedSessionId = createRoomInput.trim() + '-' + Math.random().toString(36).substring(2, 7);
      
      // Get host from current location or use default for API
      // const host = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const CREATE = `${API_URL}/sessions/create`;
      console.log('Creating session with backend at:', CREATE);
      
      // Save session to MongoDB with both sessionId and roomId
      const response = await fetch(CREATE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: generatedSessionId,
          roomId: createRoomInput.trim(),
          userName: userName.trim()
        }),
      });
      
      console.log('Session creation response status:', response.status);
      const data = await response.json();
      console.log('Session creation response:', data);
      
      if (!data.success) {
        setError(data.message);
        return;
      }
      
      // If MongoDB save is successful, connect via WebSocket
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        console.log('Sending create session request to WebSocket server');
        wsConnection.send(JSON.stringify({
          type: 'create_session',
          session_id: generatedSessionId,
          room_id: createRoomInput.trim(),
          user_name: userName
        }));
      } else {
        console.error('WebSocket connection not open');
        setError('WebSocket connection not available. Please refresh the page.');
      }
    } catch (error) {
      setError('Failed to create session. Please try again.');
      console.error('Create session error:', error);
    }
  };
  
  const generateRoomId = () => {
    // Generate a random 6-character alphanumeric room ID
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    setCreateRoomInput(result);
    setError(null); // Clear any previous errors
  };
  
  const copyRoomId = () => {
    if (!createRoomInput.trim()) return;
    
    navigator.clipboard.writeText(createRoomInput).then(() => {
      // Provide user feedback
      setError('Room code copied to clipboard!');
      // Clear the success message after 2 seconds
      setTimeout(() => {
        setError(null);
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy room code:', err);
      setError('Failed to copy room code. Please try again.');
    });
  };
  
  const handleJoinSession = async () => {
    if (!joinSessionInput.trim()) {
      setError('Please enter a valid session ID');
      return;
    }
    
    // Use authenticated user's name if available, otherwise check manually entered name
    const displayName = isAuthenticated && user ? user.name : userName;
    
    if (!displayName.trim()) {
      setError('Please sign in with Google or enter your name');
      return;
    }
    
    // Save username in localStorage as soon as they attempt to join
    localStorage.setItem('drawwave_userName', userName);
    
    try {
      // Get host from current location or use default for API
      // const host = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const VALIDATE = `${API_URL}/sessions/validate`;
      console.log('Validating session with backend at:', VALIDATE);
      
      // Validate session in MongoDB
      const response = await fetch(VALIDATE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: joinSessionInput.trim(),
          userName: userName.trim()
        }),
      });
      
      console.log('Session validation response status:', response.status);
      const data = await response.json();
      console.log('Session validation response:', data);
      
      if (!data.success) {
        setError(data.message || 'Invalid session ID');
        return;
      }
      
      // If validation is successful, connect via WebSocket
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        console.log('Sending join request to WebSocket server');
        wsConnection.send(JSON.stringify({
          type: 'join_session',
          session_id: joinSessionInput.trim(),
          user_name: userName
        }));
      } else {
        console.error('WebSocket connection not open');
        setError('WebSocket connection not available. Please refresh the page.');
      }
    } catch (error) {
      setError('Failed to join session. Please try again.');
      console.error('Join session error:', error);
    }
  };
  
  const handleClearCanvas = () => {
    // Clear the drawing canvas
    const drawingCanvas = drawingCanvasRef.current;
    if (drawingCanvas) {
      const ctx = drawingCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      }
    }

    // Add clear action to history
    const clearAction: DrawAction = {
      type: 'clear',
      timestamp: Date.now()
    };
    setDrawHistory(prev => [...prev, clearAction]);
    
    // Update localStorage
    const sessionDrawHistory = JSON.parse(localStorage.getItem(`drawwave_history_${sessionId}`) || '[]');
    sessionDrawHistory.push(clearAction);
    localStorage.setItem(`drawwave_history_${sessionId}`, JSON.stringify(sessionDrawHistory));

    // If we're in a session, broadcast the clear canvas command
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN && sessionId) {
      wsConnection.send(JSON.stringify({
        type: 'clear_canvas',
        sessionId: sessionId
      }));
      
      // Also send an empty drawing update to keep the server's state in sync
      const emptyDrawingDataURL = drawingCanvasRef.current?.toDataURL('image/png');
      if (emptyDrawingDataURL) {
        wsConnection.send(JSON.stringify({
          type: 'drawing_update',
          drawing: emptyDrawingDataURL,
          isFinal: true
        }));
      }
    }
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const colorHex = e.target.value;
    setSelectedColor(colorHex);
    
    // Convert HEX to RGB and send to server
    const r = parseInt(colorHex.slice(1, 3), 16);
    const g = parseInt(colorHex.slice(3, 5), 16);
    const b = parseInt(colorHex.slice(5, 7), 16);
    
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN && inSession) {
      wsConnection.send(JSON.stringify({
        type: 'change_color',
        color: [r, g, b]
      }));
    }
  };
  
  // Toggle fullscreen mode for canvas
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };
  
  // Download canvas as PNG with all drawing layers
  const handleDownloadCanvas = () => {
    // Check if both canvases are available
    if (canvasRef.current && drawingCanvasRef.current) {
      // Create a temporary canvas to combine both layers
      const tempCanvas = document.createElement('canvas');
      const mainCanvas = canvasRef.current;
      const drawingCanvas = drawingCanvasRef.current;
      
      // Set dimensions to match the original canvas
      tempCanvas.width = mainCanvas.width;
      tempCanvas.height = mainCanvas.height;
      
      // Get the context for our temporary canvas
      const tempCtx = tempCanvas.getContext('2d');
      
      if (tempCtx) {
        // First draw the main canvas (background)
        tempCtx.drawImage(mainCanvas, 0, 0);
        
        // Then add the drawing canvas layer on top
        tempCtx.drawImage(drawingCanvas, 0, 0);
        
        // Convert the combined canvas to data URL
        const dataURL = tempCanvas.toDataURL('image/png');
        
        // Create a temporary link element
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = 'drawwave-canvas.png';
        
        // Append to the body, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        console.log('Canvas downloaded with all drawing layers');
      }
    } else {
      console.error('Canvas references not available for download');
    }
  };
  
  // Make handleDownloadCanvas available via ref for Navbar to access
  useEffect(() => {
    if (downloadRef) {
      downloadRef.current = handleDownloadCanvas;
    }
  }, [downloadRef]);

  // Show session setup UI instead of canvas if not in a session
  const renderSessionControls = () => {
    if (inSession) {
      return null; // No session info displayed when in a session
    }
    
    return (
      <div className="session-setup p-6 sm:p-10 rounded-xl mx-auto my-10 flex flex-col w-full max-w-6xl animate-fadeIn transition-all duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--accent-primary)', borderWidth: '1px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)' }}>
        <div className="flex flex-col lg:flex-row justify-center w-full gap-10 md:gap-16 transform transition-all duration-500 md:px-4">
          {/* Create Room Section */}
          <div className="flex-1 flex flex-col items-center p-6 sm:p-8 rounded-lg shadow-lg transition-transform hover:scale-[1.02] duration-300 animate-fadeIn md:w-[450px] min-h-[400px] overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid rgba(var(--accent-primary-rgb), 0.2)' }}>
            <div className="bg-gradient-to-r from-[#a855f7] to-[#8b5cf6] text-transparent bg-clip-text w-full mb-6">
              <h2 className="text-xl font-bold text-center">Create Room</h2>
            </div>
            
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              className="w-full mb-6 rounded-md px-4 py-3 text-base transition-all duration-300 theme-input"
            />
            
            <div className="w-full mb-6 grid grid-cols-12 gap-0 relative group">
              <input
                type="text"
                value={createRoomInput}
                onChange={(e) => setCreateRoomInput(e.target.value)}
                placeholder="Room ID"
                className="col-span-6 rounded-l-md px-4 py-3 text-base transition-all duration-300 theme-input"
                readOnly
              />
              <button
                type="button"
                onClick={generateRoomId}
                className="col-span-4 font-medium py-3 px-2 text-sm text-center theme-gradient rounded-none"
              >
                Generate
              </button>
              <button
                type="button"
                onClick={copyRoomId}
                className="col-span-2 bg-gradient-to-r from-[#f43f5e] to-[#f87171] hover:from-[#fb7185] hover:to-[#fca5a5] text-white font-medium py-3 px-0 text-sm rounded-none transition-all duration-300"
                disabled={!createRoomInput.trim()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
            
            <button 
              type="button"
              onClick={handleCreateSession}
              className="w-full relative overflow-hidden theme-gradient font-medium py-3 px-4 rounded-md text-base shadow-lg group"
              disabled={!connected || !userName.trim() || !createRoomInput.trim()}
            >
              <span className="relative z-10">Create Room</span>
              <span className="absolute inset-0 rounded-md overflow-hidden">
                <span className="absolute -inset-full h-full w-1/2 z-5 block transform -skew-x-12 bg-gradient-to-r from-transparent to-white opacity-40 group-hover:animate-shine"></span>
              </span>
            </button>
            {!userName.trim() && <p className="text-xs text-[#a855f7]/70 mt-2 text-center">Please enter your name</p>}
            {!createRoomInput.trim() && <p className="text-xs text-[#a855f7]/70 mt-2 text-center">Please generate a room code</p>}
          </div>
          
          {/* OR Divider */}
          <div className="flex items-center justify-center relative">
            <div className="w-px h-32 bg-gradient-to-b from-transparent via-[#a855f7]/30 to-transparent absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 hidden md:block"></div>
            <div className="w-full h-px bg-gradient-to-r from-transparent via-[#a855f7]/30 to-transparent my-4 md:hidden"></div>
            <span className="text-lg font-medium bg-gradient-to-r from-[#a855f7] to-[#8b5cf6] text-transparent bg-clip-text px-4 relative z-10 md:rotate-0 md:transform">OR</span>
          </div>
          
          {/* Join Room Section */}
          <div className="flex-1 flex flex-col items-center p-6 sm:p-8 rounded-lg shadow-lg transition-transform hover:scale-[1.02] duration-300 animate-fadeIn animation-delay-300 md:w-[450px] min-h-[400px] overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid rgba(var(--accent-primary-rgb), 0.2)' }}>
            <div className="bg-gradient-to-r from-[#8b5cf6] to-[#a855f7] text-transparent bg-clip-text w-full mb-6">
              <h2 className="text-xl font-bold text-center">Join Room</h2>
            </div>
            
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              className="w-full mb-6 rounded-md px-4 py-3 text-base transition-all duration-300 theme-input"
            />
            
            <div className="w-full mb-6 grid grid-cols-12 gap-0 relative group">
              <input
                type="text"
                placeholder="Enter Session ID"
                value={joinSessionInput}
                onChange={(e) => setJoinSessionInput(e.target.value)}
                className="col-span-12 rounded-md px-4 py-3 text-base transition-all duration-300 theme-input"
              />
            </div>
            
            <button
              type="button"
              onClick={handleJoinSession}
              className="w-full relative overflow-hidden theme-gradient font-medium py-3 px-4 rounded-md text-base shadow-lg group"
              disabled={!connected || !userName.trim() || !joinSessionInput.trim()}
            >
              <span className="relative z-10">Join Room</span>
              <span className="absolute inset-0 rounded-md overflow-hidden">
                <span className="absolute -inset-full h-full w-1/2 z-5 block transform -skew-x-12 bg-gradient-to-r from-transparent to-white opacity-40 group-hover:animate-shine"></span>
              </span>
            </button>
            {!userName.trim() && <p className="text-xs text-[#a855f7]/70 mt-2 text-center">Please enter your name</p>}
            {!joinSessionInput.trim() && <p className="text-xs text-[#a855f7]/70 mt-2 text-center">Please enter a session ID</p>}
          </div>
        </div>
      </div>
    );
  };

  // The handleReconnect function is defined above near the connectWebSocket function

  return (
    <div className="max-w-full w-full mx-auto px-0 sm:px-1">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 sm:px-4 py-2 sm:py-3 rounded mb-4 text-sm sm:text-base max-w-7xl mx-auto">
          {error}
        </div>
      )}
      
      {reconnecting && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-3 sm:px-4 py-2 sm:py-3 rounded mb-4 text-sm sm:text-base max-w-7xl mx-auto flex items-center">
          <span className="inline-block mr-2 animate-spin">⟳</span>
          <span>{reconnectStatus || 'Reconnecting to previous session...'}</span>
        </div>
      )}
      
      {!reconnecting && reconnectStatus && reconnectStatus.length > 0 && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-3 sm:px-4 py-2 sm:py-3 rounded mb-4 text-sm sm:text-base max-w-7xl mx-auto">
          {reconnectStatus}
        </div>
      )}
      
      {/* ReconnectionHandler component */}
      <ReconnectionHandler
        isConnected={connected}
        inSession={inSession}
        sessionId={sessionId}
        userName={userName}
        onReconnect={handleReconnect}
      />
      
      {/* Session controls */}
      {renderSessionControls()}
      
      {/* Only show main content when in a session */}
      {inSession && (
        <div>
          {/* Session content starts directly without the information panel */}
          <div className={`flex flex-col ${isFullscreen ? '' : 'xl:flex-row'} gap-4 justify-center items-center w-full max-w-7xl mx-auto`}>
            <div className={`relative rounded-lg overflow-hidden shadow-lg bg-white w-full max-w-full md:max-w-2xl xl:max-w-3xl ${isFullscreen ? 'hidden' : ''}`}>
              <video 
                ref={videoRef}
                className="w-full h-auto" 
                muted
                playsInline
              ></video>
              {!connected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
                  Connecting to server...
                </div>
              )}
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 text-white">
                  <div className="text-center">
                    <p className="mb-2">Camera not detected</p>
                    <button 
                      onClick={() => {
                        setCameraReady(false); // Reset status while trying
                        navigator.mediaDevices.getUserMedia({ 
                          video: { width: 640, height: 480, facingMode: 'user' } 
                        })
                        .then(stream => {
                          if (videoRef.current) {
                            // Stop any existing tracks
                            const oldStream = videoRef.current.srcObject as MediaStream;
                            if (oldStream) {
                              oldStream.getTracks().forEach(track => track.stop());
                            }
                            
                            // Set new stream
                            videoRef.current.srcObject = stream;
                            videoRef.current.play()
                              .then(() => setCameraReady(true))
                              .catch(playErr => {
                                console.error('Play failed:', playErr);
                                setError('Failed to play video: ' + playErr.message);
                              });
                          }
                        })
                        .catch(err => {
                          console.error('Camera access error:', err);
                          setError('Camera access denied. Please check your browser settings.');
                        });
                      }}
                      className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                    >
                      Enable Camera
                    </button>
                  </div>
                </div>
              )}
              <div className="absolute top-0 right-0 p-2 bg-black bg-opacity-50 text-white text-xs">
                <div className="flex items-center">
                  <div className={`w-3 h-3 rounded-full mr-2 ${cameraReady ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span>{cameraReady ? 'Camera connected' : 'Camera disconnected'}</span>
                </div>
              </div>
            </div>
            
            <div className="relative rounded-lg overflow-hidden shadow-lg bg-white w-full max-w-full md:max-w-2xl xl:max-w-3xl" style={{position: 'relative', ...(isFullscreen ? {width: '100%', maxWidth: '90vw', height: isFullscreen ? '75vh' : 'auto'} : {})}}>
              <div className="absolute top-2 right-2 z-20">
                <button
                  onClick={toggleFullscreen}
                  className="bg-purple-600 hover:bg-purple-700 text-white p-2 rounded-full flex items-center justify-center shadow-md transition-all"
                  title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Mode'}
                >
                  {isFullscreen ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                    </svg>
                  )}
                </button>
              </div>
              <div style={{position: 'relative', width: '100%', height: 'auto'}}>
                <canvas 
                  ref={canvasRef}
                  width={640}
                  height={480}
                  className="w-full h-auto"
                  style={{position: 'absolute', top: 0, left: 0, zIndex: 0}}
                ></canvas>
                <canvas 
                  ref={drawingCanvasRef}
                  width={640}
                  height={480}
                  className="w-full h-auto"
                  style={{position: 'absolute', top: 0, left: 0, zIndex: 10, backgroundColor: 'transparent'}}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                ></canvas>
                <canvas 
                  ref={cursorCanvasRef}
                  width={640}
                  height={480}
                  className="w-full h-auto"
                  style={{position: 'absolute', top: 0, left: 0, zIndex: 20, backgroundColor: 'transparent', pointerEvents: 'none'}}
                ></canvas>
                <div style={{position: 'relative', width: '100%', paddingTop: '75%'}}></div>
              </div>
            </div>
          </div>
          
          {/* Redesigned Control Panel */}
          <div className="mt-6 sm:mt-8">
            {/* Main Controls */}
            <div className="bg-gradient-to-r from-slate-800/90 via-slate-900 to-slate-800/90 backdrop-blur-sm rounded-xl p-3 max-w-fit mx-auto shadow-xl border border-slate-700">
              <div className="flex items-center justify-center space-x-2 sm:space-x-3">
                {/* Clear Canvas */}
                <button 
                  onClick={handleClearCanvas}
                  className="bg-gradient-to-br from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-medium py-2 px-3 rounded-lg text-sm shadow-lg shadow-rose-500/20 transition-all duration-300 transform hover:scale-105 flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v1h10V3a1 1 0 112 0v1a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V6a2 2 0 012-2V3a1 1 0 011-1zm.707 4.293a1 1 0 00-1.414 1.414L8.586 13l-1.293 1.293a1 1 0 101.414 1.414L13 11.414l1.293 1.293a1 1 0 001.414-1.414l-1.293-1.293 1.293-1.293a1 1 0 00-1.414-1.414L13 8.586l-4.293-4.293z" clipRule="evenodd" />
                  </svg>
                  <span>Clear Canvas</span>
                </button>
                
                {/* Mouse Drawing Toggle */}
                <button 
                  onClick={toggleMouseDrawing}
                  className={`${isMouseDrawing ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-emerald-500/20' : 'bg-gradient-to-br from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 shadow-slate-500/20'} text-white font-medium py-2 px-3 rounded-lg text-sm shadow-lg transition-all duration-300 transform hover:scale-105 flex items-center gap-1`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.415 1.415l.707-.708zm-7.071 7.072l.707-.707A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z" clipRule="evenodd" />
                  </svg>
                  <span>Mouse: {isMouseDrawing ? 'ON' : 'OFF'}</span>
                </button>
                
                {/* Undo Button */}
                <button 
                  onClick={handleUndo}
                  disabled={drawHistory.length === 0}
                  className={`${drawHistory.length === 0 ? 'bg-slate-400 cursor-not-allowed opacity-60' : 'bg-gradient-to-br from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 shadow-indigo-500/20'} text-white font-medium py-2 px-3 rounded-lg text-sm shadow-lg transition-all duration-300 transform hover:scale-105 flex items-center gap-1`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
                  </svg>
                  <span>Undo</span>
                </button>
                
                {/* Color Picker */}
                <div className="flex items-center bg-slate-700/50 rounded-lg px-2 py-1.5 border border-slate-600">
                  <label htmlFor="colorPicker" className="text-slate-300 mr-1.5 text-sm">Color:</label>
                  <div className="relative">
                    <input 
                      id="colorPicker"
                      type="color"
                      value={selectedColor}
                      onChange={handleColorChange}
                      className="w-7 h-7 rounded-md cursor-pointer opacity-0 absolute inset-0 z-10"
                    />
                    <div className="w-7 h-7 rounded-md" style={{ backgroundColor: selectedColor, boxShadow: `0 0 10px ${selectedColor}` }}></div>
                  </div>
                </div>
                
                {/* FPS Selector */}
                <div className="flex items-center bg-slate-700/50 rounded-lg px-3 py-1.5 border border-slate-600">
                  <label htmlFor="frameRate" className="text-slate-300 mr-1.5 text-sm">FPS:</label>
                  <select
                    id="frameRate"
                    value={frameRate}
                    onChange={(e) => setFrameRate(Number(e.target.value))}
                    className="bg-slate-800 text-white border border-slate-600 rounded-md px-0 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 w-12"
                  >
                    <option value="10">10</option>
                    <option value="15">15</option>
                    <option value="20">20</option>
                    <option value="30">30</option>
                  </select>
                </div>
                
                {/* Test Reconnection */}
                <button 
                  onClick={() => {
                    if (wsConnection) {
                      console.log('Testing reconnection by closing the WebSocket');
                      wsConnection.close();
                    }
                  }}
                  className="bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-medium py-2 px-3 rounded-lg text-sm shadow-lg shadow-amber-500/20 transition-all duration-300 transform hover:scale-105 flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                  <span>Test Reconnection</span>
                </button>
              </div>
            </div>
          </div>
          
          {/* Visual feedback for undo operation */}
          {showUndoFeedback && (
            <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
              <div className="bg-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg text-xl font-bold animate-bounce">
                Undo! 🔄
              </div>
            </div>
          )}
          
          {/* Gesture Guide button */}
          <div className="mt-8 sm:mt-10 flex justify-center">
            <button
              onClick={() => setIsGestureGuideOpen(true)}
              className="flex items-center gap-3 bg-gradient-to-r from-violet-600 to-indigo-700 text-white px-6 py-3 rounded-full shadow-lg shadow-indigo-500/20 hover:shadow-xl transform hover:scale-105 transition-all duration-300 font-medium"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
              </svg>
              <span>Gesture Guide</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 animate-pulse" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1z" />
              </svg>
            </button>
          </div>
          
          {/* Animated Gesture Guide Popup */}
          <AnimatePresence>
            {isGestureGuideOpen && (
              <motion.div 
                className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsGestureGuideOpen(false)}
              >
                <motion.div 
                  className="bg-slate-900 rounded-2xl overflow-hidden shadow-2xl max-w-2xl w-full border border-slate-700"
                  onClick={(e) => e.stopPropagation()}
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.9, y: 20 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                >
                  <div className="bg-gradient-to-r from-violet-900 via-indigo-800 to-violet-900 p-6 text-white relative">
                    <div className="flex items-center gap-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
                      </svg>
                      <div>
                        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 to-purple-200">Hand Gesture Guide</h2>
                        <p className="text-indigo-300 text-sm">Master these gestures to control DrawWave</p>
                      </div>
                    </div>
                    <button 
                      className="absolute top-4 right-4 text-indigo-300 hover:text-white transition-colors rounded-full p-1 hover:bg-indigo-800/50"
                      onClick={() => setIsGestureGuideOpen(false)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Draw Gesture */}
                    <motion.div 
                      className="bg-gradient-to-br from-slate-800 to-slate-700 p-5 rounded-xl border border-slate-600 flex items-center gap-4 group"
                      whileHover={{ scale: 1.03, y: -5 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <div className="relative w-16 h-16 flex-shrink-0">
                        <motion.div 
                          className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-full flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40"
                          animate={{ scale: [1, 1.1, 1] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                        >
                          <span className="text-2xl">✏️</span>
                        </motion.div>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-white group-hover:text-indigo-300 transition-colors">Draw</h3>
                        <p className="text-slate-400 text-sm">Extend index finger only</p>
                        <motion.div 
                          className="mt-2 h-1 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: '100%' }}
                          transition={{ duration: 1 }}
                        />
                      </div>
                    </motion.div>
                    
                    {/* Mouse Draw */}
                    <motion.div 
                      className="bg-gradient-to-br from-slate-800 to-slate-700 p-5 rounded-xl border border-slate-600 flex items-center gap-4 group"
                      whileHover={{ scale: 1.03, y: -5 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <div className="relative w-16 h-16 flex-shrink-0">
                        <motion.div 
                          className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:shadow-emerald-500/40"
                          animate={{ rotate: [0, 15, 0, -15, 0] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.415 1.415l.707-.708zm-7.071 7.072l.707-.707A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z" clipRule="evenodd" />
                          </svg>
                        </motion.div>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-white group-hover:text-emerald-300 transition-colors">Mouse Draw</h3>
                        <p className="text-slate-400 text-sm">Click the Mouse draw option</p>
                        <motion.div 
                          className="mt-2 h-1 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: '100%' }}
                          transition={{ duration: 1, delay: 0.2 }}
                        />
                      </div>
                    </motion.div>
                    
                    {/* Undo Gesture */}
                    <motion.div 
                      className="bg-gradient-to-br from-slate-800 to-slate-700 p-5 rounded-xl border border-slate-600 flex items-center gap-4 group"
                      whileHover={{ scale: 1.03, y: -5 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <div className="relative w-16 h-16 flex-shrink-0">
                        <motion.div 
                          className="absolute inset-0 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:shadow-amber-500/40"
                          animate={{ 
                            rotate: [0, 360],
                          }}
                          transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                        >
                          <span className="text-2xl">↩️</span>
                        </motion.div>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-white group-hover:text-amber-300 transition-colors">Undo</h3>
                        <p className="text-slate-400 text-sm">Show all five fingers</p>
                        <motion.div 
                          className="mt-2 h-1 bg-gradient-to-r from-amber-600 to-orange-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: '100%' }}
                          transition={{ duration: 1, delay: 0.4 }}
                        />
                      </div>
                    </motion.div>
                    
                    {/* Stop Drawing Gesture */}
                    <motion.div 
                      className="bg-gradient-to-br from-slate-800 to-slate-700 p-5 rounded-xl border border-slate-600 flex items-center gap-4 group"
                      whileHover={{ scale: 1.03, y: -5 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <div className="relative w-16 h-16 flex-shrink-0">
                        <motion.div 
                          className="absolute inset-0 bg-gradient-to-br from-rose-500 to-pink-600 rounded-full flex items-center justify-center shadow-lg shadow-rose-500/20 group-hover:shadow-rose-500/40"
                          animate={{ scale: [1, 0.9, 1] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                        >
                          <span className="text-2xl">✋</span>
                        </motion.div>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-white group-hover:text-rose-300 transition-colors">Stop Drawing</h3>
                        <p className="text-slate-400 text-sm">Show fist or other gestures</p>
                        <motion.div 
                          className="mt-2 h-1 bg-gradient-to-r from-rose-600 to-pink-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: '100%' }}
                          transition={{ duration: 1, delay: 0.6 }}
                        />
                      </div>
                    </motion.div>
                  </div>
                  
                  <div className="p-5 bg-slate-800/50 border-t border-slate-700 text-center">
                    <motion.button
                      className="bg-gradient-to-r from-violet-600 to-indigo-700 text-white px-8 py-3 rounded-full font-medium shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 transition-shadow"
                      onClick={() => setIsGestureGuideOpen(false)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Got it!
                    </motion.button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default VirtualPainter; 