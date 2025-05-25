import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

interface User {
  id: string;
  name: string;
  email: string;
  picture: string;
}

interface DecodedToken {
  user: User;
  exp: number;
  iat: number;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: () => void;
  logout: () => void;
  checkAuthStatus: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const isTokenExpired = (token: string): boolean => {
    try {
      const decoded = jwtDecode<DecodedToken>(token);
      return decoded.exp * 1000 < Date.now();
    } catch (error) {
      return true;
    }
  };

  const setAuthToken = (token: string | null) => {
    if (token) {
      axios.defaults.headers.common['x-auth-token'] = token;
      localStorage.setItem('auth_token', token);
    } else {
      delete axios.defaults.headers.common['x-auth-token'];
      localStorage.removeItem('auth_token');
    }
  };

  const checkAuthStatus = async (): Promise<boolean> => {
    setLoading(true);
    
    const token = localStorage.getItem('auth_token');
    
    if (!token || isTokenExpired(token)) {
      setAuthToken(null);
      setUser(null);
      setLoading(false);
      return false;
    }
    
    setAuthToken(token);
    
    try {
      const res = await axios.get(`${API_URL}/auth/verify`);
      
      if (res.data.isValid && res.data.user) {
        setUser(res.data.user);
        setLoading(false);
        return true;
      } else {
        setAuthToken(null);
        setUser(null);
        setLoading(false);
        return false;
      }
    } catch (error) {
      console.error('Auth verification error:', error);
      setAuthToken(null);
      setUser(null);
      setLoading(false);
      return false;
    }
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const refreshToken = async () => {
      try {
        const res = await axios.post(`${API_URL}/auth/refresh`);
        const { token } = res.data;
        
        setAuthToken(token);
      } catch (error) {
        console.error('Token refresh error:', error);
        logout();
      }
    };
    
    const refreshInterval = setInterval(refreshToken, 55 * 60 * 1000);
    
    return () => clearInterval(refreshInterval);
  }, [user]);

  const login = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  const logout = async () => {
    try {
      await axios.post(`${API_URL}/auth/logout`);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setAuthToken(null);
      setUser(null);
      
      localStorage.removeItem('drawwave_inSession');
      localStorage.removeItem('drawwave_sessionId');
      localStorage.removeItem('drawwave_isHost');
      
      window.location.href = '/';
    }
  };

  const contextValue: AuthContextType = {
    user,
    isAuthenticated: !!user,
    loading,
    login,
    logout,
    checkAuthStatus
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
};
