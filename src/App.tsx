import React, { useState, useEffect, useRef, Component } from 'react';
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp, 
  doc, 
  setDoc,
  getDoc,
  User,
  handleFirestoreError,
  OperationType,
  deleteDoc,
  firebaseConfig
} from './firebase';
import { 
  FileText, 
  Upload, 
  LogOut, 
  LogIn, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Image as ImageIcon,
  Plus,
  History,
  RefreshCw,
  LayoutDashboard,
  User as UserIcon,
  Search,
  ChevronRight,
  TrendingUp,
  Calendar,
  DollarSign,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, subDays, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState;
  props: ErrorBoundaryProps;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Algo salió mal.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "{}");
        if (parsed.error) displayMessage = `Error de Firestore: ${parsed.error}`;
      } catch (e) {
        displayMessage = this.state.error?.message || displayMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-10 text-center border border-red-100">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-gray-900 mb-4">¡Ups!</h2>
            <p className="text-gray-600 mb-8">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="flex items-center justify-center gap-2 w-full bg-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Types ---
interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  price: number;
  total: number;
}

interface InvoiceData {
  id?: string;
  vendorName: string;
  issueDate: string;
  invoiceNumber: string;
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  notes: string;
  status: 'pending' | 'processed' | 'error';
  ownerId: string;
  createdAt: any;
}

// --- Helpers ---
const formatCurrency = (amount: number | undefined, currencyCode: string | undefined) => {
  if (amount === undefined || amount === null) return '-';
  
  // Normalize common symbols to ISO codes
  let code = (currencyCode || 'ARS').toUpperCase().trim();
  if (code === '$') code = 'ARS'; // Change to ARS as per user request
  if (code === '€') code = 'EUR';
  if (code === '£') code = 'GBP';
  
  // Basic validation for ISO 4217 (3 uppercase letters)
  const isValidCode = /^[A-Z]{3}$/.test(code);
  const finalCode = isValidCode ? code : 'ARS';
  
  try {
    return amount.toLocaleString('es-AR', { 
      style: 'currency', 
      currency: finalCode 
    });
  } catch (e) {
    return `${finalCode} ${amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  }
};

// --- App Component ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'upload' | 'history' | 'profile'>('dashboard');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'processed' | 'pending' | 'error'>('all');
  const [filterDateRange, setFilterDateRange] = useState<'all' | 'today' | 'month' | 'year'>('all');
  const [filterCurrency, setFilterCurrency] = useState<'all' | 'ARS' | 'USD' | 'EUR'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      
      if (currentUser) {
        // Save user profile
        try {
          // Check if user already exists to avoid overwriting createdAt
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (!userDoc.exists()) {
            await setDoc(doc(db, 'users', currentUser.uid), {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              role: 'user',
              createdAt: serverTimestamp()
            });
          } else {
            // Just update profile info
            await setDoc(doc(db, 'users', currentUser.uid), {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
            }, { merge: true });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Listener for Invoices
  useEffect(() => {
    if (!user) {
      setInvoices([]);
      return;
    }

    const q = query(collection(db, 'invoices'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as InvoiceData[];
      // Sort by createdAt descending
      setInvoices(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'invoices');
    });

    return () => unsubscribe();
  }, [user]);

  // --- Handlers ---
  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Login Error:", err);
      if (err.code === 'auth/popup-blocked') {
        setError("El navegador bloqueó la ventana emergente. Por favor, habilita las ventanas emergentes para este sitio.");
      } else if (err.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        const projectId = firebaseConfig.projectId;
        setError(
          <span>
            Este dominio (<strong>{domain}</strong>) no está autorizado en Firebase. 
            Por favor, añádelo en la <a href={`https://console.firebase.google.com/project/${projectId}/authentication/providers`} target="_blank" rel="noopener noreferrer" className="underline font-bold">Consola de Firebase</a> 
            dentro de la sección "Dominios autorizados" en la pestaña "Configuración".
          </span>
        );
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError("La ventana de inicio de sesión se cerró antes de completar el proceso.");
      } else {
        setError("Error al iniciar sesión: " + (err.message || "Inténtalo de nuevo."));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout Error:", err);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPreviewUrl(reader.result as string);
      reader.readAsDataURL(file);
      setError(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const processInvoice = async () => {
    if (!selectedFile || !user) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Try to get the API key from multiple sources
      // 1. process.env.GEMINI_API_KEY (injected by Vite define)
      // 2. import.meta.env.VITE_GEMINI_API_KEY (standard Vite env var)
      // 3. GEMINI_API_KEY2 or VITE_GEMINI_API_KEY2 (fallbacks)
      const apiKey = 
        process.env.GEMINI_API_KEY || 
        (import.meta as any).env?.VITE_GEMINI_API_KEY || 
        (process.env as any).VITE_GEMINI_API_KEY ||
        (process.env as any).GEMINI_API_KEY2 ||
        (import.meta as any).env?.VITE_GEMINI_API_KEY2 ||
        (process.env as any).VITE_GEMINI_API_KEY2;
      
      if (!apiKey || apiKey.trim() === "" || apiKey === "undefined" || apiKey.includes("Free Tier")) {
        throw new Error("La clave de API de Gemini no está configurada correctamente. Por favor, ve al menú de 'Settings' (engranaje) en AI Studio y agrega un nuevo Secret llamado 'GEMINI_API_KEY2' con tu clave de API.");
      }

      const aiInstance = new GoogleGenAI({ apiKey });
      const base64Data = await fileToBase64(selectedFile);
      
      const response = await aiInstance.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: "Extrae los datos de esta factura en formato JSON. Si no puedes encontrar un campo, deja el valor como null o string vacío. Los campos requeridos son: vendorName, issueDate (YYYY-MM-DD), invoiceNumber, lineItems (array de objetos con description, quantity, unit, price, total), subtotal, tax, total, currency (código ISO 4217 de 3 letras, ej: USD, EUR, MXN), notes." },
              { inlineData: { data: base64Data, mimeType: selectedFile.type } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              vendorName: { type: Type.STRING },
              issueDate: { type: Type.STRING },
              invoiceNumber: { type: Type.STRING },
              lineItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    unit: { type: Type.STRING },
                    price: { type: Type.NUMBER },
                    total: { type: Type.NUMBER }
                  }
                }
              },
              subtotal: { type: Type.NUMBER },
              tax: { type: Type.NUMBER },
              total: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              notes: { type: Type.STRING }
            }
          }
        }
      });

      let text = response.text || '{}';
      // Remove potential markdown code blocks if they exist
      if (text.startsWith('```json')) {
        text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (text.startsWith('```')) {
        text = text.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }

      const extractedData = JSON.parse(text);

      // Sanitize data for Firestore
      const sanitizedData = {
        vendorName: String(extractedData.vendorName || 'S/N').substring(0, 199),
        issueDate: String(extractedData.issueDate || ''),
        invoiceNumber: String(extractedData.invoiceNumber || ''),
        lineItems: Array.isArray(extractedData.lineItems) ? extractedData.lineItems.map((item: any) => ({
          description: String(item.description || ''),
          quantity: Number(item.quantity) || 0,
          unit: String(item.unit || ''),
          price: Number(item.price) || 0,
          total: Number(item.total) || 0
        })) : [],
        subtotal: Number(extractedData.subtotal) || 0,
        tax: Number(extractedData.tax) || 0,
        total: Number(extractedData.total) || 0,
        currency: String(extractedData.currency || 'ARS').toUpperCase(),
        notes: String(extractedData.notes || '').substring(0, 1000),
        ownerId: user.uid,
        status: 'processed' as const,
        createdAt: serverTimestamp()
      };

      // Save to Firestore
      try {
        await addDoc(collection(db, 'invoices'), sanitizedData);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'invoices');
      }

      // Reset state
      setSelectedFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
    } catch (err: any) {
      console.error("Processing Error:", err);
      setError("Error al procesar la factura: " + (err.message || "Inténtalo de nuevo."));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteInvoice = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setConfirmDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;

    try {
      await deleteDoc(doc(db, 'invoices', confirmDeleteId));
      if (selectedInvoice?.id === confirmDeleteId) setSelectedInvoice(null);
      setConfirmDeleteId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `invoices/${confirmDeleteId}`);
    }
  };

  // --- Dashboard Data ---
  const getDashboardStats = () => {
    const totalSpent = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const thisMonth = invoices.filter(inv => {
      if (!inv.issueDate) return false;
      try {
        const date = parseISO(inv.issueDate);
        const now = new Date();
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      } catch (e) {
        return false;
      }
    });
    const monthSpent = thisMonth.reduce((sum, inv) => sum + (inv.total || 0), 0);
    
    // Top Vendor
    const vendorTotals: { [key: string]: number } = {};
    invoices.forEach(inv => {
      const name = inv.vendorName || 'Desconocido';
      vendorTotals[name] = (vendorTotals[name] || 0) + (inv.total || 0);
    });
    const topVendor = Object.entries(vendorTotals).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

    // Average Invoice
    const avgInvoice = invoices.length > 0 ? totalSpent / invoices.length : 0;

    // Chart data (last 7 days)
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = subDays(new Date(), 6 - i);
      const dayTotal = invoices
        .filter(inv => {
          if (!inv.issueDate) return false;
          try {
            return isSameDay(parseISO(inv.issueDate), date);
          } catch (e) {
            return false;
          }
        })
        .reduce((sum, inv) => sum + (inv.total || 0), 0);
      return {
        name: format(date, 'EEE', { locale: es }),
        total: dayTotal,
        date: format(date, 'dd/MM')
      };
    });

    return { totalSpent, monthSpent, count: invoices.length, chartData: last7Days, topVendor, avgInvoice };
  };

  const stats = getDashboardStats();

  const exportToCSV = () => {
    if (filteredInvoices.length === 0) return;
    
    const headers = ['Fecha', 'Proveedor', 'Numero', 'Total', 'Moneda', 'Estado'];
    const rows = filteredInvoices.map(inv => [
      inv.issueDate || '',
      inv.vendorName || '',
      inv.invoiceNumber || '',
      inv.total?.toString() || '0',
      inv.currency || '',
      inv.status || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `facturas_export_${format(new Date(), 'yyyyMMdd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- UI Components ---
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-xl p-10 text-center border border-gray-100"
        >
          <div className="bg-blue-50 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <FileText className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Gestor de Facturas IA</h1>
          <p className="text-gray-600 mb-10 text-lg">
            Sube tus facturas y deja que nuestra IA extraiga los datos automáticamente. Inicia sesión para comenzar.
          </p>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700 text-left">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 text-gray-700 font-semibold py-4 px-6 rounded-2xl hover:bg-gray-50 transition-all active:scale-95 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoggingIn ? (
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            ) : (
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
            )}
            {isLoggingIn ? "Iniciando sesión..." : "Continuar con Google"}
          </button>
        </motion.div>
      </div>
    );
  }

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = 
      inv.vendorName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = filterStatus === 'all' || inv.status === filterStatus;
    const matchesCurrency = filterCurrency === 'all' || inv.currency === filterCurrency;
    
    let matchesDate = true;
    if (filterDateRange !== 'all' && inv.issueDate) {
      const invDate = parseISO(inv.issueDate);
      const now = new Date();
      if (filterDateRange === 'today') {
        matchesDate = isSameDay(invDate, now);
      } else if (filterDateRange === 'month') {
        matchesDate = invDate.getMonth() === now.getMonth() && invDate.getFullYear() === now.getFullYear();
      } else if (filterDateRange === 'year') {
        matchesDate = invDate.getFullYear() === now.getFullYear();
      }
    }

    return matchesSearch && matchesStatus && matchesDate;
  });

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col sticky top-0 h-screen z-40">
          <div className="p-6 flex items-center gap-3 border-b border-gray-50">
            <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-200">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-black text-gray-900 tracking-tight">FacturaIA</span>
          </div>
          
          <nav className="flex-1 p-4 space-y-2">
            <SidebarButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard className="w-5 h-5" />} label="Dashboard" />
            <SidebarButton active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} icon={<Plus className="w-5 h-5" />} label="Nueva Factura" />
            <SidebarButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History className="w-5 h-5" />} label="Libro Diario" />
            <SidebarButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<UserIcon className="w-5 h-5" />} label="Mi Perfil" />
          </nav>

          <div className="p-4 border-t border-gray-50">
            <div className="bg-gray-50 p-4 rounded-2xl flex items-center gap-3">
              <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-10 h-10 rounded-xl border-2 border-white shadow-sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{user.displayName}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate">{user.email}</p>
              </div>
              <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-600 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile Header */}
          <header className="md:hidden bg-white border-b border-gray-200 sticky top-0 z-30 px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              <span className="font-black text-gray-900">FacturaIA</span>
            </div>
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-gray-100" />
          </header>

          <main className="max-w-6xl mx-auto w-full px-4 md:px-8 pt-8 pb-24 md:pb-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8 pb-10"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-black text-gray-900">Hola, {user.displayName?.split(' ')[0]}</h2>
                    <p className="text-gray-500 font-medium">Aquí tienes el resumen de tus finanzas.</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 bg-white p-2 rounded-2xl border border-gray-100 shadow-sm">
                    <Calendar className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-bold text-gray-700">{format(new Date(), 'MMMM yyyy', { locale: es })}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <motion.div 
                    whileHover={{ y: -2 }}
                    className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm"
                  >
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Gasto Total</p>
                    <h3 className="text-2xl font-black text-gray-900 mt-1">{formatCurrency(stats.totalSpent, 'ARS')}</h3>
                    <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-blue-600">
                      <TrendingUp className="w-3 h-3" />
                      <span>Histórico</span>
                    </div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ y: -2 }}
                    className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm"
                  >
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Este Mes</p>
                    <h3 className="text-2xl font-black text-gray-900 mt-1">{formatCurrency(stats.monthSpent, 'ARS')}</h3>
                    <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-green-600">
                      <Calendar className="w-3 h-3" />
                      <span>{format(new Date(), 'MMMM', { locale: es })}</span>
                    </div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ y: -2 }}
                    className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm"
                  >
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Ticket Promedio</p>
                    <h3 className="text-2xl font-black text-gray-900 mt-1">{formatCurrency(stats.avgInvoice, 'ARS')}</h3>
                    <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-purple-600">
                      <FileText className="w-3 h-3" />
                      <span>Por factura</span>
                    </div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ y: -2 }}
                    className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm"
                  >
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Top Proveedor</p>
                    <h3 className="text-lg font-black text-gray-900 mt-1 truncate">{stats.topVendor[0]}</h3>
                    <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-orange-600">
                      <UserIcon className="w-3 h-3" />
                      <span>{formatCurrency(stats.topVendor[1] as number, 'ARS')}</span>
                    </div>
                  </motion.div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h3 className="text-xl font-black text-gray-900">Actividad Semanal</h3>
                        <p className="text-sm text-gray-400 font-medium">Gastos de los últimos 7 días</p>
                      </div>
                      <div className="bg-gray-50 p-2 rounded-xl">
                        <TrendingUp className="w-5 h-5 text-blue-600" />
                      </div>
                    </div>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={stats.chartData}>
                          <defs>
                            <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15}/>
                              <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 11, fontWeight: 600}} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 11, fontWeight: 600}} />
                          <Tooltip 
                            contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px 16px'}}
                            itemStyle={{fontWeight: 800, color: '#111827'}}
                            labelStyle={{color: '#6b7280', marginBottom: '4px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em'}}
                            formatter={(value: number) => [formatCurrency(value, 'ARS'), 'Gasto']}
                          />
                          <Area type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={4} fillOpacity={1} fill="url(#colorTotal)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
                    <div className="p-8 border-b border-gray-50 flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-black text-gray-900">Últimos Movimientos</h3>
                        <p className="text-sm text-gray-400 font-medium">Tus facturas más recientes</p>
                      </div>
                      <button 
                        onClick={() => setActiveTab('history')} 
                        className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-100 transition-colors"
                      >
                        Ver Todo
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto max-h-[320px] divide-y divide-gray-50">
                      {invoices.length === 0 ? (
                        <div className="p-12 text-center">
                          <p className="text-gray-400 font-medium italic">No hay facturas registradas aún.</p>
                        </div>
                      ) : (
                        invoices.slice(0, 5).map(inv => (
                          <div 
                            key={inv.id} 
                            className="p-6 flex items-center justify-between hover:bg-gray-50 transition-all cursor-pointer group" 
                            onClick={() => setSelectedInvoice(inv)}
                          >
                            <div className="flex items-center gap-5">
                              <div className="bg-gray-50 w-12 h-12 rounded-2xl flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                                <FileText className="w-6 h-6 text-gray-400 group-hover:text-blue-600" />
                              </div>
                              <div>
                                <p className="font-black text-gray-900 text-base">{inv.vendorName || 'Sin Nombre'}</p>
                                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">{inv.issueDate || 'Sin fecha'}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-gray-900 text-lg">{formatCurrency(inv.total, inv.currency)}</p>
                              <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest">Procesado</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'upload' && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto space-y-8"
              >
                <section className="bg-white rounded-3xl shadow-sm border border-gray-200 p-8">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                    <Upload className="w-6 h-6 text-blue-600" />
                    Nueva Factura
                  </h2>

                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`
                      border-3 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
                      ${previewUrl ? 'border-blue-200 bg-blue-50' : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'}
                    `}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept="image/*,application/pdf"
                      className="hidden"
                    />
                    
                    {previewUrl ? (
                      <div className="relative group">
                        <img src={previewUrl} alt="Preview" className="max-h-64 mx-auto rounded-lg shadow-md" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-lg transition-opacity">
                          <p className="text-white font-medium">Cambiar archivo</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                          <Plus className="w-8 h-8 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-gray-900">Haz clic para subir</p>
                          <p className="text-sm text-gray-500">JPG, PNG o PDF (máx. 10MB)</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700">
                      <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                      <p className="text-sm font-medium">{error}</p>
                    </div>
                  )}

                  <button
                    disabled={!selectedFile || isProcessing}
                    onClick={processInvoice}
                    className={`
                      w-full mt-8 py-4 px-6 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                      ${!selectedFile || isProcessing 
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                        : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-95'}
                    `}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-6 h-6" />
                        Extraer Datos
                      </>
                    )}
                  </button>
                </section>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                        <History className="w-6 h-6 text-blue-600" />
                        Libro Diario de Facturas
                      </h2>
                      <p className="text-sm text-gray-500 font-medium">Visualización detallada y filtros avanzados de comprobantes.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={exportToCSV}
                        className="flex items-center gap-2 bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-50 transition-all"
                      >
                        <Upload className="w-4 h-4 rotate-180" />
                        Exportar CSV
                      </button>
                      <button 
                        onClick={() => setActiveTab('upload')}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-all shadow-sm shadow-blue-200"
                      >
                        <Plus className="w-4 h-4" />
                        Nueva Factura
                      </button>
                    </div>
                  </div>

                  {/* Smart Filters Bar */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col lg:flex-row gap-4 items-center">
                    <div className="relative flex-1 w-full">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="text" 
                        placeholder="Buscar por proveedor o número..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    
                    <div className="flex items-center gap-2 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0">
                      <select 
                        value={filterStatus}
                        onChange={(e: any) => setFilterStatus(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="all">Todos los estados</option>
                        <option value="processed">Procesados</option>
                        <option value="pending">Pendientes</option>
                        <option value="error">Error</option>
                      </select>

                      <select 
                        value={filterDateRange}
                        onChange={(e: any) => setFilterDateRange(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="all">Cualquier fecha</option>
                        <option value="today">Hoy</option>
                        <option value="month">Este mes</option>
                        <option value="year">Este año</option>
                      </select>

                      <select 
                        value={filterCurrency}
                        onChange={(e: any) => setFilterCurrency(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="all">Todas las monedas</option>
                        <option value="ARS">ARS ($)</option>
                        <option value="USD">USD (US$)</option>
                        <option value="EUR">EUR (€)</option>
                      </select>

                      <button 
                        onClick={() => {
                          setSearchQuery('');
                          setFilterStatus('all');
                          setFilterDateRange('all');
                          setFilterCurrency('all');
                        }}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Limpiar filtros"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Excel-like Table View */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-6 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Fecha</th>
                          <th className="px-6 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Proveedor</th>
                          <th className="px-6 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Nº Factura</th>
                          <th className="px-6 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider text-right">Total</th>
                          <th className="px-6 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider text-center">Estado</th>
                          <th className="px-6 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider text-center">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredInvoices.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-20 text-center">
                              <div className="flex flex-col items-center gap-3">
                                <Search className="w-10 h-10 text-gray-200" />
                                <p className="text-gray-400 font-medium">No se encontraron comprobantes con estos filtros.</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredInvoices.map((invoice) => (
                            <tr 
                              key={invoice.id}
                              onClick={() => setSelectedInvoice(invoice)}
                              className="hover:bg-blue-50/30 transition-colors cursor-pointer group"
                            >
                              <td className="px-6 py-4 text-sm font-medium text-gray-600 whitespace-nowrap">
                                {invoice.issueDate ? format(parseISO(invoice.issueDate), 'dd/MM/yyyy') : '-'}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                                    <FileText className="w-4 h-4" />
                                  </div>
                                  <span className="text-sm font-bold text-gray-900 truncate max-w-[200px]">
                                    {invoice.vendorName || 'S/N'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm font-mono text-gray-500">
                                {invoice.invoiceNumber || '-'}
                              </td>
                              <td className="px-6 py-4 text-sm font-bold text-gray-900 text-right whitespace-nowrap">
                                {formatCurrency(invoice.total, invoice.currency)}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className={`
                                  inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider
                                  ${invoice.status === 'processed' ? 'bg-green-100 text-green-700' : 
                                    invoice.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 
                                    'bg-red-100 text-red-700'}
                                `}>
                                  {invoice.status === 'processed' ? 'Procesado' : 
                                   invoice.status === 'pending' ? 'Pendiente' : 'Error'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <button 
                                    onClick={(e) => handleDeleteInvoice(invoice.id!, e)}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-600 transition-colors" />
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {filteredInvoices.length > 0 && (
                    <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Total de registros: {filteredInvoices.length}
                      </span>
                      <span className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                        Suma Total: {formatCurrency(filteredInvoices.reduce((acc, curr) => acc + (curr.total || 0), 0), 'ARS')}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'profile' && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="max-w-md mx-auto"
              >
                <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-xl shadow-blue-900/5 overflow-hidden">
                  <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 h-40 relative">
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
                  </div>
                  <div className="px-10 pb-10 text-center -mt-16 relative z-10">
                    <motion.img 
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      src={user.photoURL || ''} 
                      alt={user.displayName || ''} 
                      className="w-32 h-32 rounded-[2.5rem] border-8 border-white shadow-2xl mx-auto mb-6 object-cover" 
                    />
                    <h2 className="text-3xl font-black text-gray-900 tracking-tight">{user.displayName}</h2>
                    <p className="text-gray-400 font-bold text-sm uppercase tracking-widest mt-1 mb-10">{user.email}</p>
                    
                    <div className="grid grid-cols-2 gap-4 mb-10">
                      <div className="bg-gray-50 p-4 rounded-3xl border border-gray-100">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Gastado</p>
                        <p className="text-lg font-black text-gray-900">{formatCurrency(stats.totalSpent, 'ARS')}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-3xl border border-gray-100">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Documentos</p>
                        <p className="text-lg font-black text-gray-900">{stats.count}</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <button 
                        onClick={handleLogout}
                        className="w-full flex items-center justify-center gap-4 bg-red-50 text-red-600 font-black text-sm uppercase tracking-widest py-5 px-8 rounded-[1.5rem] hover:bg-red-100 active:scale-95 transition-all"
                      >
                        <LogOut className="w-5 h-5" />
                        Cerrar Sesión
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Bottom Navigation (Mobile Only) */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 z-40">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard />} label="Inicio" />
            <NavButton active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} icon={<Plus className="w-8 h-8" />} label="Subir" isCenter />
            <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History />} label="Facturas" />
            <NavButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<UserIcon />} label="Perfil" />
          </div>
        </nav>

        {/* Confirmation Modal */}
        <AnimatePresence>
          {confirmDeleteId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
              onClick={() => setConfirmDeleteId(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center"
                onClick={e => e.stopPropagation()}
              >
                <div className="bg-red-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Trash2 className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">¿Eliminar Factura?</h3>
                <p className="text-gray-500 mb-8 font-medium">Esta acción no se puede deshacer. ¿Estás seguro?</p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmDeleteId(null)}
                    className="flex-1 py-3 px-6 rounded-xl font-bold text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={confirmDelete}
                    className="flex-1 py-3 px-6 rounded-xl font-bold bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-200 transition-all active:scale-95"
                  >
                    Eliminar
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Invoice Detail Modal */}
        <AnimatePresence>
          {selectedInvoice && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setSelectedInvoice(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
                  <h3 className="text-xl font-bold text-gray-900">Detalles de Factura</h3>
                  <button onClick={() => setSelectedInvoice(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <X className="w-6 h-6 text-gray-500" />
                  </button>
                </div>
                
                <div className="p-10 overflow-y-auto space-y-12">
                  <div className="flex flex-col md:flex-row justify-between items-start gap-8">
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em]">Emisor de Factura</p>
                      <h4 className="text-4xl font-black text-gray-900 tracking-tight">{selectedInvoice.vendorName || 'Sin Nombre'}</h4>
                      <div className="flex items-center gap-4 pt-2">
                        <div className="bg-gray-100 px-3 py-1 rounded-lg text-sm font-bold text-gray-600">
                          #{selectedInvoice.invoiceNumber || 'S/N'}
                        </div>
                        <div className="flex items-center gap-2 text-gray-400 text-sm font-bold">
                          <Calendar className="w-4 h-4" />
                          {selectedInvoice.issueDate || 'Sin fecha'}
                        </div>
                      </div>
                    </div>
                    <div className="bg-blue-600 text-white p-8 rounded-[2.5rem] shadow-xl shadow-blue-200 min-w-[200px] text-center">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70 mb-2">Total Final</p>
                      <p className="text-4xl font-black">{formatCurrency(selectedInvoice.total, selectedInvoice.currency)}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-[2.5rem] p-8 border border-gray-100">
                    <h5 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-6 border-b border-gray-200 pb-4">Desglose de Conceptos</h5>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-gray-400 uppercase text-[10px] font-black tracking-[0.2em]">
                            <th className="pb-6">Descripción</th>
                            <th className="pb-6 text-center">Cant.</th>
                            <th className="pb-6 text-right">Precio Un.</th>
                            <th className="pb-6 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {selectedInvoice.lineItems?.map((item, i) => (
                            <tr key={i} className="group">
                              <td className="py-5 font-bold text-gray-800 text-base">{item.description}</td>
                              <td className="py-5 text-center">
                                <span className="bg-white border border-gray-200 px-3 py-1 rounded-lg text-sm font-black text-gray-600">
                                  {item.quantity} {item.unit}
                                </span>
                              </td>
                              <td className="py-5 text-right text-gray-500 font-medium">{formatCurrency(item.price, selectedInvoice.currency)}</td>
                              <td className="py-5 text-right font-black text-gray-900">{formatCurrency(item.total, selectedInvoice.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row justify-between items-start gap-10">
                    <div className="flex-1">
                      {selectedInvoice.notes && (
                        <div className="bg-amber-50/50 border border-amber-100 p-6 rounded-3xl">
                          <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2">Observaciones</p>
                          <p className="text-sm text-amber-900/70 leading-relaxed font-medium italic">"{selectedInvoice.notes}"</p>
                        </div>
                      )}
                    </div>
                    <div className="w-full md:w-72 space-y-4">
                      <div className="flex justify-between items-center px-4">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Subtotal</span>
                        <span className="font-bold text-gray-700">{formatCurrency(selectedInvoice.subtotal, selectedInvoice.currency)}</span>
                      </div>
                      <div className="flex justify-between items-center px-4">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Impuestos</span>
                        <span className="font-bold text-gray-700">{formatCurrency(selectedInvoice.tax, selectedInvoice.currency)}</span>
                      </div>
                      <div className="bg-gray-900 text-white p-6 rounded-3xl flex justify-between items-center shadow-lg">
                        <span className="text-xs font-black uppercase tracking-[0.2em]">Total</span>
                        <span className="text-2xl font-black">{formatCurrency(selectedInvoice.total, selectedInvoice.currency)}</span>
                      </div>
                      <button 
                        onClick={() => handleDeleteInvoice(selectedInvoice.id!)}
                        className="w-full py-4 text-red-600 font-black text-xs uppercase tracking-widest hover:bg-red-50 rounded-2xl transition-colors flex items-center justify-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar Registro
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  </ErrorBoundary>
);
}

function SidebarButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all
        ${active 
          ? 'bg-blue-50 text-blue-600 shadow-sm shadow-blue-100' 
          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}
      `}
    >
      {icon}
      {label}
    </button>
  );
}

function NavButton({ active, onClick, icon, label, isCenter }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, isCenter?: boolean }) {
  if (isCenter) {
    return (
      <button 
        onClick={onClick}
        className={`
          -mt-14 w-20 h-20 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-blue-600/30 transition-all active:scale-90 z-50
          ${active ? 'bg-blue-700 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}
        `}
      >
        {React.cloneElement(icon as React.ReactElement, { className: 'w-10 h-10' })}
      </button>
    );
  }

  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 transition-all active:scale-95 ${active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
    >
      <div className={`p-2 rounded-xl transition-colors ${active ? 'bg-blue-50' : 'bg-transparent'}`}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-6 h-6' })}
      </div>
      <span className={`text-[10px] font-black uppercase tracking-[0.15em] ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
    </button>
  );
}
