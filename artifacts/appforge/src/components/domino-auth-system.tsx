/**
 * DOMINO Chain - Sistema de Autenticación Completo
 * Incluye: Registro, Login, Logout, Perfil de Usuario
 */

import React, { useState, useEffect } from 'react';
import { Mail, Lock, User, LogOut, Heart, Zap, TrendingUp } from 'lucide-react';

// ============================================================================
// TIPOS Y INTERFACES
// ============================================================================

interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  kindnessCredits: number;
  completedChallenges: number;
  totalImpact: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  joinedDate: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
}

// ============================================================================
// CONTEXTO DE AUTENTICACIÓN
// ============================================================================

const AuthContext = React.createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Verificar sesión al cargar
  useEffect(() => {
    const checkSession = async () => {
      try {
        const token = localStorage.getItem('authToken');
        if (token) {
          const response = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const userData = await response.json();
            setUser(userData);
          } else {
            localStorage.removeItem('authToken');
          }
        }
      } catch (error) {
        console.error('Session check failed:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkSession();
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      const { token, user: userData } = await response.json();
      localStorage.setItem('authToken', token);
      setUser(userData);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (email: string, name: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      });

      if (!response.ok) {
        throw new Error('Registration failed');
      }

      const { token, user: userData } = await response.json();
      localStorage.setItem('authToken', token);
      setUser(userData);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      localStorage.removeItem('authToken');
      setUser(null);
    }
  };

  const updateProfile = async (data: Partial<User>) => {
    const token = localStorage.getItem('authToken');
    const response = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      const updatedUser = await response.json();
      setUser(updatedUser);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// ============================================================================
// COMPONENTES DE AUTENTICACIÓN
// ============================================================================

/**
 * Formulario de Registro
 */
export const RegisterForm: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const { register, isLoading } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validaciones
    if (!formData.email || !formData.name || !formData.password) {
      setError('Por favor completa todos los campos');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    if (formData.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    if (!agreedToTerms) {
      setError('Debes aceptar los términos y condiciones');
      return;
    }

    try {
      await register(formData.email, formData.name, formData.password);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en el registro');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Crea tu Cuenta</h2>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
        <div className="relative">
          <User className="absolute left-3 top-3 text-gray-400" size={20} />
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Tu nombre completo"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <div className="relative">
          <Mail className="absolute left-3 top-3 text-gray-400" size={20} />
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="tu@email.com"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
        <div className="relative">
          <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Mínimo 8 caracteres"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar Contraseña</label>
        <div className="relative">
          <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
          <input
            type="password"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder="Repite tu contraseña"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="terms"
          checked={agreedToTerms}
          onChange={(e) => setAgreedToTerms(e.target.checked)}
          className="h-4 w-4 text-purple-600 rounded"
        />
        <label htmlFor="terms" className="ml-2 text-sm text-gray-600">
          Acepto los términos y condiciones
        </label>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-2 rounded-lg hover:shadow-lg transition disabled:opacity-50"
      >
        {isLoading ? 'Creando cuenta...' : 'Crear Cuenta'}
      </button>
    </form>
  );
};

/**
 * Formulario de Login
 */
export const LoginForm: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const { login, isLoading } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.email || !formData.password) {
      setError('Por favor completa todos los campos');
      return;
    }

    try {
      await login(formData.email, formData.password);
      if (rememberMe) {
        localStorage.setItem('rememberEmail', formData.email);
      }
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en el inicio de sesión');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Inicia Sesión</h2>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <div className="relative">
          <Mail className="absolute left-3 top-3 text-gray-400" size={20} />
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="tu@email.com"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
        <div className="relative">
          <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Tu contraseña"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <input
            type="checkbox"
            id="remember"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 text-purple-600 rounded"
          />
          <label htmlFor="remember" className="ml-2 text-sm text-gray-600">
            Recuérdame
          </label>
        </div>
        <a href="#" className="text-sm text-purple-600 hover:text-purple-700">
          ¿Olvidaste tu contraseña?
        </a>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-2 rounded-lg hover:shadow-lg transition disabled:opacity-50"
      >
        {isLoading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
      </button>
    </form>
  );
};

/**
 * Perfil de Usuario con Botón de Logout
 */
export const UserProfile: React.FC = () => {
  const { user, logout } = useAuth();

  if (!user) return null;

  const getTierColor = (tier: string) => {
    const colors: Record<string, string> = {
      bronze: 'text-amber-700 bg-amber-100',
      silver: 'text-gray-600 bg-gray-100',
      gold: 'text-yellow-600 bg-yellow-100',
      platinum: 'text-blue-600 bg-blue-100',
    };
    return colors[tier] || 'text-gray-600 bg-gray-100';
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-md">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-4">
          <img
            src={user.avatar}
            alt={user.name}
            className="w-12 h-12 rounded-full"
          />
          <div>
            <h3 className="text-lg font-bold text-gray-800">{user.name}</h3>
            <p className="text-sm text-gray-600">{user.email}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="p-2 hover:bg-red-100 rounded-lg transition"
          title="Cerrar sesión"
        >
          <LogOut className="text-red-600" size={20} />
        </button>
      </div>

      <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold mb-4 ${getTierColor(user.tier)}`}>
        {user.tier.toUpperCase()}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <Heart className="text-red-500 mx-auto mb-2" size={24} />
          <p className="text-2xl font-bold text-gray-800">{user.kindnessCredits}</p>
          <p className="text-xs text-gray-600">Créditos</p>
        </div>
        <div className="text-center">
          <Zap className="text-yellow-500 mx-auto mb-2" size={24} />
          <p className="text-2xl font-bold text-gray-800">{user.completedChallenges}</p>
          <p className="text-xs text-gray-600">Retos</p>
        </div>
        <div className="text-center">
          <TrendingUp className="text-green-500 mx-auto mb-2" size={24} />
          <p className="text-2xl font-bold text-gray-800">{user.totalImpact}</p>
          <p className="text-xs text-gray-600">Impacto</p>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Miembro desde {new Date(user.joinedDate).toLocaleDateString('es-ES')}
      </p>
    </div>
  );
};

/**
 * Componente de Logout
 */
export const LogoutButton: React.FC = () => {
  const { logout, isLoading } = useAuth();

  return (
    <button
      onClick={logout}
      disabled={isLoading}
      className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
    >
      <LogOut size={18} />
      <span>{isLoading ? 'Cerrando...' : 'Cerrar Sesión'}</span>
    </button>
  );
};

export default {
  AuthProvider,
  useAuth,
  RegisterForm,
  LoginForm,
  UserProfile,
  LogoutButton,
};
