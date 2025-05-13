import { useEffect, useRef, useState } from 'react';

const VirtualPainter = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const [wsConnection, setWsConnection] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState('#000000');
  const requestRef = useRef<number | null>(null);
  const [frameRate, setFrameRate] = useState(5); // frames per second
  
  // Session state
  const [sessionId, setSessionId] = useState<string>('');
  const [createRoomInput, setCreateRoomInput] = useState<string>('');
  const [joinRoomInput, setJoinRoomInput] = useState<string>('');
  const [participants, setParticipants] = useState<number>(0);
  const [inSession, setInSession] = useState<boolean>(false);
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [userName, setUserName] = useState<string>('');
  
  // Mouse drawing state
  const [isMouseDrawing, setIsMouseDrawing] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [prevPoint, setPrevPoint] = useState<{x: number, y: number} | null>(null);

  // Mouse drawing functions  
  const toggleMouseDrawing = () => {
    const newValue = !isMouseDrawing;
    setIsMouseDrawing(newValue);
    
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
  };
  
  const startDrawing = (x: number, y: number) => {
    setIsDrawing(true);
    setPrevPoint({ x, y });
  };
  
  const draw = (x: number, y: number) => {
    if (!isDrawing || !prevPoint) return;
    
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    ctx.beginPath();
    ctx.moveTo(prevPoint.x, prevPoint.y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = selectedColor;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    
    // Send drawing data to server
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({
        type: 'mouse_draw',
        start: { x: prevPoint.x, y: prevPoint.y },
        end: { x, y },
        color: selectedColor
      }));
      
      // Also send the updated canvas state
      const drawingCanvas = drawingCanvasRef.current;
      if (drawingCanvas) {
        const drawingDataURL = drawingCanvas.toDataURL('image/png');
        wsConnection.send(JSON.stringify({
          type: 'drawing_update',
          drawing: drawingDataURL
        }));
      }
    }
    
    setPrevPoint({ x, y });
  };
  
  const stopDrawing = () => {
    setIsDrawing(false);
    setPrevPoint(null);
  };
  
  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDrawing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    startDrawing(x, y);
  };
  
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDrawing || !isDrawing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    draw(x, y);
  };
  
  const handleMouseUp = () => {
    if (!isMouseDrawing) return;
    stopDrawing();
  };
  
  const handleMouseLeave = () => {
    if (!isMouseDrawing) return;
    stopDrawing();
  };

  // Initialize websocket connection
  useEffect(() => {
    const ws = new WebSocket('ws://192.168.1.3:8765');
    
    ws.onopen = () => {
      console.log('Connected to WebSocket server');
      setConnected(true);
      setError(null);
    };
    
    ws.onclose = () => {
      console.log('Disconnected from WebSocket server');
      setConnected(false);
      setError('Connection to server lost. Please refresh the page.');
      setInSession(false);
      setSessionId('');
    };
    
    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
      setError('Failed to connect to the server. Is the Python backend running?');
      setConnected(false);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        let canvasImage: HTMLImageElement;
        let ctx: CanvasRenderingContext2D | null;
        
        switch (data.type) {
          case 'clear_canvas':
            handleClearCanvas();
            break;
            
          case 'canvas_update':
            canvasImage = new Image();
            canvasImage.onload = () => {
              ctx = canvasRef.current?.getContext('2d') ?? null;
              if (ctx && canvasRef.current) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                ctx.drawImage(canvasImage, 0, 0);
              }
            };
            canvasImage.src = data.canvas;
            break;
            
          case 'session_created':
            setSessionId(data.session_id);
            setInSession(true);
            setParticipants(1); // Creator is the first participant
            setError(null);
            console.log('Room created successfully. Session ID:', data.session_id);
            // Clear input fields since we're now in a session
            setCreateRoomInput('');
            setJoinRoomInput('');
            break;
            
          case 'session_joined':
            setSessionId(data.session_id);
            setInSession(true);
            setParticipants(data.participants);
            console.log('Successfully joined room. Session ID:', data.session_id);
            
            // Set initial canvas state if one exists
            if (data.canvas) {
              canvasImage = new Image();
              canvasImage.onload = () => {
                ctx = canvasRef.current?.getContext('2d') ?? null;
                if (ctx && canvasRef.current) {
                  ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                  ctx.drawImage(canvasImage, 0, 0);
                }
              };
              canvasImage.src = data.canvas;
            }
            
            // Also restore any drawing layer data if it exists
            if (data.drawing && drawingCanvasRef.current) {
              const drawingImage = new Image();
              drawingImage.onload = () => {
                const drawingCtx = drawingCanvasRef.current?.getContext('2d');
                if (drawingCtx && drawingCanvasRef.current) {
                  // Keep existing drawings
                  drawingCtx.drawImage(drawingImage, 0, 0);
                }
              };
              drawingImage.src = data.drawing;
            }
            
            // Clear input fields since we're now in a session
            setCreateRoomInput('');
            setJoinRoomInput('');
            setError(null);
            break;
            
          case 'participant_joined':
            setParticipants(data.participants);
            break;
            
          case 'participant_left':
            setParticipants(data.participants);
            break;
            
          case 'color_changed':
            // Optionally handle color changes from other participants
            break;
            
          case 'mouse_draw':
            // Handle drawing data from other participants
            if (drawingCanvasRef.current) {
              const ctx = drawingCanvasRef.current.getContext('2d');
              if (ctx) {
                ctx.beginPath();
                ctx.moveTo(data.start.x, data.start.y);
                ctx.lineTo(data.end.x, data.end.y);
                ctx.strokeStyle = data.color;
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                ctx.stroke();
              }
            }
            break;
            
          case 'drawing_update':
            // Handle complete drawing canvas updates from other users
            if (drawingCanvasRef.current && data.drawing) {
              const drawingImage = new Image();
              drawingImage.onload = () => {
                const drawingCtx = drawingCanvasRef.current?.getContext('2d');
                if (drawingCtx && drawingCanvasRef.current) {
                  drawingCtx.drawImage(drawingImage, 0, 0);
                }
              };
              drawingImage.src = data.drawing;
            }
            break;
            
          case 'error':
            console.error('Server error:', data.message);
            setError(`Server error: ${data.message}`);
            // If the error is related to session joining, we'll keep the user in the form view
            if (data.errorCode === 'session_not_found' || data.errorCode === 'invalid_session') {
              setInSession(false);
            }
            break;
            
          default:
            break;
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };
    
    setWsConnection(ws);
    
    return () => {
      console.log('Closing WebSocket connection');
      ws.close();
    };
  }, []);

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
          
          // Only send frame to server if not in mouse drawing mode
          wsConnection.send(JSON.stringify({
            type: 'frame',
            frame
          }));
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
  const handleCreateSession = () => {
    // Validate that the user has entered a username
    if (!userName.trim()) {
      setError('Please enter your name');
      return;
    }
    
    // Validate that a room code has been generated
    if (!createRoomInput.trim()) {
      setError('Please generate a room code first');
      return;
    }
    
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({
        type: 'create_session',
        session_id: createRoomInput.trim(),
        user_name: userName
      }));
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
  
  const handleJoinSession = () => {
    if (!joinRoomInput.trim()) {
      setError('Please enter a valid session ID');
      return;
    }
    
    if (!userName.trim()) {
      setError('Please enter your name');
      return;
    }
    
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({
        type: 'join_session',
        session_id: joinRoomInput.trim(),
        user_name: userName
      }));
    }
  };
  
  const handleClearCanvas = () => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN && inSession) {
      // Clear the drawing canvas locally first
      if (drawingCanvasRef.current) {
        const drawingCtx = drawingCanvasRef.current.getContext('2d');
        if (drawingCtx) {
          drawingCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        }
      }
      
      // Then send clear canvas command to server for all clients
      wsConnection.send(JSON.stringify({
        type: 'clear_canvas'
      }));
      
      // Also send empty drawing update to ensure drawing layer is cleared on all clients
      if (drawingCanvasRef.current) {
        const emptyDrawing = drawingCanvasRef.current.toDataURL('image/png');
        wsConnection.send(JSON.stringify({
          type: 'drawing_update',
          drawing: emptyDrawing
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
  
  // Show session setup UI instead of canvas if not in a session
  const renderSessionControls = () => {
    if (inSession) {
      return (
        <div className="session-info bg-indigo-50 p-3 sm:p-4 rounded-md mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 max-w-7xl mx-auto">
          <div className="text-black flex flex-wrap gap-2 items-center">
            <span className="font-medium text-black">Session ID:</span> <span className="bg-white px-2 py-1 rounded text-black">{sessionId}</span>
            <span className="font-medium text-black ml-0 sm:ml-4">Participants:</span> <span className="bg-white px-2 py-1 rounded text-black">{participants}</span>
          </div>
          <div className="text-sm text-black">
            Share this ID with others to let them join your drawing session
          </div>
        </div>
      );
    }
    
    return (
      <div className="session-setup bg-white p-4 rounded-lg shadow-md mx-auto my-4 flex flex-col w-full max-w-4xl">
        <div className="flex flex-col md:flex-row justify-between w-full gap-4">
          {/* Create Room Section */}
          <div className="flex-1 flex flex-col items-center">
            <h2 className="text-xl font-bold mb-4 text-indigo-700">Create Room</h2>
            
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              className="w-full mb-4 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-base bg-gray-50"
            />
            
            <div className="w-full mb-4 flex">
              <input
                type="text"
                value={createRoomInput}
                onChange={(e) => setCreateRoomInput(e.target.value)}
                placeholder="Room ID"
                className="flex-1 border border-gray-300 rounded-l-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-base bg-gray-50"
                readOnly
              />
              <button
                onClick={generateRoomId}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 text-sm"
              >
                Generate
              </button>
              <button
                onClick={copyRoomId}
                className="bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-4 rounded-r-md text-sm"
                disabled={!createRoomInput.trim()}
              >
                Copy
              </button>
            </div>
            
            <button 
              onClick={handleCreateSession}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md text-base"
              disabled={!connected || !userName.trim() || !createRoomInput.trim()}
            >
              Create Room
            </button>
            {!userName.trim() && <p className="text-xs text-gray-500 mt-2 text-center">Please enter your name</p>}
            {!createRoomInput.trim() && <p className="text-xs text-gray-500 mt-2 text-center">Please generate a room code</p>}
          </div>
          
          {/* OR Divider */}
          <div className="flex items-center justify-center">
            <span className="text-lg font-medium text-gray-500 px-4">OR</span>
          </div>
          
          {/* Join Room Section */}
          <div className="flex-1 flex flex-col items-center">
            <h2 className="text-xl font-bold mb-4 text-indigo-700">Join Room</h2>
            
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              className="w-full mb-4 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-base bg-gray-50"
            />
            
            <input
              type="text"
              value={joinRoomInput}
              onChange={(e) => setJoinRoomInput(e.target.value)}
              placeholder="Enter room code"
              className="w-full mb-4 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-base bg-gray-50"
            />
            
            <button
              onClick={handleJoinSession}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md text-base"
              disabled={!connected || !userName.trim() || !joinRoomInput.trim()}
            >
              Join Room
            </button>
            {!userName.trim() && <p className="text-xs text-gray-500 mt-2 text-center">Please enter your name</p>}
            {!joinRoomInput.trim() && <p className="text-xs text-gray-500 mt-2 text-center">Please enter a room code</p>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-full w-full mx-auto px-0 sm:px-1">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 sm:px-4 py-2 sm:py-3 rounded mb-4 text-sm sm:text-base max-w-7xl mx-auto">
          {error}
        </div>
      )}
      
      {/* Session controls */}
      {renderSessionControls()}
      
      {/* Only show main content when in a session */}
      {inSession && (
        <div>
          <div className="flex flex-col xl:flex-row gap-4 justify-center items-center w-full max-w-7xl mx-auto">
            <div className="relative rounded-lg overflow-hidden shadow-lg bg-white w-full max-w-full md:max-w-2xl xl:max-w-3xl">
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
            
            <div className="relative rounded-lg overflow-hidden shadow-lg bg-white w-full max-w-full md:max-w-2xl xl:max-w-3xl" style={{position: 'relative'}}>
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
                <div style={{position: 'relative', width: '100%', paddingTop: '75%'}}></div>
              </div>
            </div>
          </div>
          
          <div className="mt-4 sm:mt-6 flex flex-wrap justify-center gap-2 sm:gap-4">
            <button 
              onClick={handleClearCanvas}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-3 sm:px-4 rounded text-sm sm:text-base transition-colors duration-200"
            >
              Clear Canvas
            </button>
            <button 
              onClick={toggleMouseDrawing}
              className={`${isMouseDrawing ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'} text-white font-medium py-2 px-3 sm:px-4 rounded text-sm sm:text-base transition-colors duration-200`}
            >
              {isMouseDrawing ? 'Mouse Drawing: ON' : 'Mouse Drawing: OFF'}
            </button>
            
            <div className="flex items-center">
              <label htmlFor="colorPicker" className="mr-2 text-sm sm:text-base">Color:</label>
              <input 
                id="colorPicker"
                type="color"
                value={selectedColor}
                onChange={handleColorChange}
                className="w-8 h-8 sm:w-10 sm:h-10 rounded cursor-pointer"
              />
            </div>
            
            <div className="flex items-center gap-1 sm:gap-2">
              <label htmlFor="frameRate" className="text-gray-700 text-sm sm:text-base">FPS:</label>
              <select
                id="frameRate"
                value={frameRate}
                onChange={(e) => setFrameRate(Number(e.target.value))}
                className="border rounded px-1 sm:px-2 py-1 text-sm sm:text-base"
              >
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="15">15</option>
                <option value="30">30</option>
              </select>
            </div>
          </div>
          
          <div className="mt-6 sm:mt-8 bg-blue-50 p-3 sm:p-4 rounded-lg shadow-inner max-w-3xl mx-auto w-full">
            <h2 className="text-lg sm:text-xl font-semibold text-indigo-700 mb-2">Gesture Guide:</h2>
            <ul className="list-disc pl-5 space-y-1 text-gray-700 text-sm sm:text-base">
              <li>✏️ <strong>Draw:</strong> Extend index finger only</li>
              <li>🧽 <strong>Erase:</strong> Extend index and middle fingers</li>
              <li>✋ <strong>Stop Drawing:</strong> Show all five fingers</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default VirtualPainter; 