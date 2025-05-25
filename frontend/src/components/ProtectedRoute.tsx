import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  redirectPath?: string;
}

const ProtectedRoute = ({ 
  children, 
  redirectPath = '/'
}: ProtectedRouteProps) => {
  const { isAuthenticated, loading, checkAuthStatus } = useAuth();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  
  useEffect(() => {
    const verify = async () => {
      if (!loading && isAuthenticated) {
        setAuthorized(true);
        setChecking(false);
        return;
      }
      
      const isAuthorized = await checkAuthStatus();
      setAuthorized(isAuthorized);
      setChecking(false);
    };
    
    verify();
  }, [loading, isAuthenticated, checkAuthStatus]);
  
  if (checking || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto mb-3"></div>
          <p className="text-white">Authenticating...</p>
        </div>
      </div>
    );
  }
  
  if (!authorized) {
    return <Navigate to={redirectPath} replace />;
  }
  
  return <>{children}</>;
};

export default ProtectedRoute;
