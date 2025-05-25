import React from 'react';
import VirtualPainter from './VirtualPainter';
import Navbar from './Navbar';

interface DesktopProps {
  
}

const Desktop: React.FC<DesktopProps> = () => {
  
  const downloadCanvasRef = React.useRef<(() => void) | null>(null);
  const [sessionId, setSessionId] = React.useState('');
  const [inSession, setInSession] = React.useState(false);

  
  const handleSessionUpdate = (isInSession: boolean, currentSessionId: string, _hostStatus: boolean) => {
    setInSession(isInSession);
    setSessionId(currentSessionId);
  };

  const handleLeaveRoom = () => {
    const leaveEvent = new CustomEvent('leaveRoom');
    window.dispatchEvent(leaveEvent);
    
    setTimeout(() => {
      const isStillInSession = localStorage.getItem('drawwave_inSession') === 'true';
      if (!isStillInSession) {
        window.location.href = '/';
      }
    }, 500);
  };

  return (
    <div className="desktop-container">
      <Navbar 
        inSession={inSession}
        sessionId={sessionId}
        onLeaveRoom={handleLeaveRoom}
        onDownloadCanvas={downloadCanvasRef.current || undefined}
      />
      <div className="pt-4 sm:pt-6 animate-fadeIn">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center bg-gradient-to-r from-indigo-400 to-purple-400 text-transparent bg-clip-text py-4 sm:py-6 animate-shimmer-slow drop-shadow-glow-indigo">
          DrawWave Desktop
        </h1>
        <div className="w-48 h-1 mx-auto bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full animate-gradient-x"></div>
      </div>
      <VirtualPainter 
        onSessionUpdate={handleSessionUpdate} 
        downloadRef={downloadCanvasRef}
      />
    </div>
  );
};

export default Desktop;
