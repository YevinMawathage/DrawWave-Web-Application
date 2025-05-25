import React, { useState, useEffect, useCallback } from 'react';

interface ReconnectionHandlerProps {
  isConnected: boolean;
  inSession: boolean;
  sessionId: string;
  userName: string;
  onReconnect: () => void;
}


const ReconnectionHandler: React.FC<ReconnectionHandlerProps> = ({ 
  isConnected, 
  inSession, 

  onReconnect 
}) => {
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(5);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (!isConnected && inSession) {
      setIsReconnecting(true);
      setCountdown(5);
    } else {
      setIsReconnecting(false);
    }
  }, [isConnected, inSession]);

  useEffect(() => {
    if (!isReconnecting) return;
    
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      
      return () => clearTimeout(timer);
    } else {
      try {
        console.log("Attempting automatic reconnection...");
        onReconnect();
      } catch (error) {
        console.error("Error during automatic reconnection:", error);
        setErrorMessage("Failed to reconnect automatically. Please try refreshing the page.");
      }
    }
  }, [isReconnecting, countdown, onReconnect]);

  const handleManualReconnect = useCallback(() => {
    try {
      setCountdown(0);
      setErrorMessage(''); 
      console.log('Manual reconnection triggered');
      onReconnect();
    } catch (error) {
      console.error("Error during manual reconnection:", error);
      setErrorMessage("Failed to reconnect. Please try refreshing the page.");
    }
  }, [onReconnect]);

  if (!isReconnecting) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md mx-auto">
        <h2 className="text-xl font-bold mb-4 text-indigo-700">Connection Lost</h2>
        
        {errorMessage ? (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {errorMessage}
          </div>
        ) : (
          <>
            <p className="mb-4">
              We've lost connection to the drawing server. Your session information is saved.
            </p>
            <p className="mb-6">
              Automatically reconnecting in <span className="font-bold">{countdown}</span> seconds...
            </p>
            <div className="flex justify-between">
              <button
                onClick={handleManualReconnect}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md"
              >
                Reconnect Now
              </button>
              <button
                onClick={() => window.location.reload()}
                className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md"
              >
                Refresh Page
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReconnectionHandler;
