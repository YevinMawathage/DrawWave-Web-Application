import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const AuthCallback = () => {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { checkAuthStatus } = useAuth();

  useEffect(() => {
    const handleCallback = async () => {
      try {
       
        const params = new URLSearchParams(location.search);
        const token = params.get('token');

        if (!token) {
          setError('No authentication token received');
          return;
        }


        localStorage.setItem('auth_token', token);
        
      
        const isAuthenticated = await checkAuthStatus();
        
        if (isAuthenticated) {

          const redirectPath = localStorage.getItem('auth_redirect') || '/';
          localStorage.removeItem('auth_redirect'); 
          navigate(redirectPath);
        } else {
          setError('Authentication failed');
        }
      } catch (err) {
        console.error('Auth callback error:', err);
        setError('Authentication process failed');
      }
    };

    handleCallback();
  }, [location, navigate, checkAuthStatus]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900">
        <div className="bg-red-600 text-white px-4 py-2 rounded mb-4">
          {error}
        </div>
        <button 
          onClick={() => navigate('/')}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded"
        >
          Return to Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto mb-3"></div>
        <p className="text-white">Completing authentication...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
