import { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import VirtualPainter from './components/VirtualPainter';
import Navbar from './components/Navbar';
import Home from './components/Home';
import Preloader from './components/Preloader';
import AuthCallback from './components/AuthCallback';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';

function App() {
  const [inSession, setInSession] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [showHome, setShowHome] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  
  const downloadCanvasRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const storedInSession = localStorage.getItem('drawwave_inSession') === 'true';
    if (storedInSession) {
      setShowHome(false);
      setInSession(true);
    }
    
    const preloadAssets = async () => {
    };
    
    preloadAssets();
  }, []);

  const handleSessionUpdate = (isInSession: boolean, currentSessionId: string, _hostStatus: boolean) => {
    setInSession(isInSession);
    setSessionId(currentSessionId);
  };

  const handleStartRoom = () => {
    setShowHome(false);
  };

  const handleLeaveRoom = () => {
    const leaveEvent = new CustomEvent('leaveRoom');
    window.dispatchEvent(leaveEvent);
    
    setTimeout(() => {
      const isStillInSession = localStorage.getItem('drawwave_inSession') === 'true';
      if (!isStillInSession) {
        setShowHome(true);
      }
    }, 500);
  };

  const handlePreloaderFinished = () => {
    setIsLoading(false);
  };

  return (
    <AuthProvider>
      <ThemeProvider>
        <Router>
          <div className="min-h-screen w-full p-0 overflow-x-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>

            {isLoading && <Preloader onFinished={handlePreloaderFinished} />}
            
           
            <div className={`min-h-screen w-full transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
            
              <Routes>
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="*" element={null} /> </Routes>

             
              {!showHome && (
                <Navbar 
                  inSession={inSession}
                  sessionId={sessionId}
                  onLeaveRoom={handleLeaveRoom}
                  onDownloadCanvas={downloadCanvasRef.current || undefined}
                />
              )}
              
              {showHome ? (
                <Home onStartRoom={handleStartRoom} />
              ) : (
                <>
                  <div className="pt-4 sm:pt-6 animate-fadeIn">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center bg-gradient-to-r from-indigo-400 to-purple-400 text-transparent bg-clip-text py-4 sm:py-6 animate-shimmer-slow drop-shadow-glow-indigo">
                    </h1>
                    <div className="w-48 h-1 mx-auto bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full animate-gradient-x"></div>
                  </div>
                  <VirtualPainter 
                    onSessionUpdate={handleSessionUpdate} 
                    downloadRef={downloadCanvasRef}
                  />
                </>
              )}
            </div>
          </div>
        </Router>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
