import { useState, useEffect } from 'react';

interface PreloaderProps {
  onFinished: () => void;
}

const Preloader = ({ onFinished }: PreloaderProps) => {
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        const newProgress = prev + Math.random() * 15;
        return newProgress > 100 ? 100 : newProgress;
      });
    }, 200);
    
    return () => clearInterval(interval);
  }, []);
  
  useEffect(() => {
    if (progress === 100) {
      const timeout = setTimeout(() => {
        setFadeOut(true);
        
        setTimeout(() => {
          onFinished();
        }, 1000); 
      }, 500);
      
      return () => clearTimeout(timeout);
    }
  }, [progress, onFinished]);
  
  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-1000 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
      style={{ pointerEvents: fadeOut ? 'none' : 'auto' }}
    >
      {/* Purple/Blue gradient background with animated pulse */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a002a] via-[#150025] to-[#0a001a] opacity-80"></div>
        
        {/* Animated gradient circles */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vh] h-[60vh] rounded-full bg-gradient-to-r from-[#a855f7]/10 to-[#8b5cf6]/10 blur-3xl animate-pulse-slow"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40vh] h-[40vh] rounded-full bg-gradient-to-r from-[#8b5cf6]/15 to-[#6366f1]/15 blur-3xl animate-pulse-slow animation-delay-300"></div>
      </div>
      

      
      {/* Loading text with typewriter effect */}
      <div className="relative z-10 text-center mb-10 mt-4">
        <h2 className="text-[#a855f7] text-2xl font-bold mb-2">DrawWave</h2>
        <p className="text-white/80 text-sm">Loading creative workspace...</p>
      </div>
      
      {/* Progress bar */}
      <div className="relative z-10 w-64 h-1 bg-[#2d1846] rounded-full overflow-hidden mb-2">
        <div 
          className="h-full bg-gradient-to-r from-[#8b5cf6] to-[#a855f7] rounded-full transition-all duration-200 ease-out"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      
      {/* Progress percentage */}
      <div className="relative z-10 text-white/50 text-xs">
        {Math.round(progress)}%
      </div>
      
      {/* Animated dots at the bottom */}
      <div className="absolute bottom-8 flex gap-3">
        {[0, 1, 2].map((i) => (
          <div 
            key={i}
            className="w-2 h-2 rounded-full bg-[#a855f7]/70 animate-pulse-slow"
            style={{ animationDelay: `${i * 0.3}s` }}
          ></div>
        ))}
      </div>
    </div>
  );
};

export default Preloader;
