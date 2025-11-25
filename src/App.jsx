import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AppDataProvider } from "./context/AppDataContext";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import Matches from "./pages/Matches";
import MatchDetail from "./pages/MatchDetail";
import Statistics from "./pages/Statistics";
import Teams from "./pages/Teams";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import VerifyEmail from "./pages/VerifyEmail";

function PrivateRoute({ children }) {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!currentUser.emailVerified && location.pathname !== '/verify-email') {
    return <Navigate to="/verify-email" state={{ from: location }} replace />;
  }

  return children;
}

function AppContent() {
  return (
    <div className="min-h-screen flex bg-black text-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-neutral-900 p-4">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            
            <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/matches" element={<PrivateRoute><Matches /></PrivateRoute>} />
            <Route path="/matches/:matchId" element={<PrivateRoute><MatchDetail /></PrivateRoute>} />
            <Route path="/match/:matchId" element={<PrivateRoute><MatchDetail /></PrivateRoute>} />
            <Route path="/statistics" element={<PrivateRoute><Statistics /></PrivateRoute>} />
            <Route path="/teams" element={<PrivateRoute><Teams /></PrivateRoute>} />
            <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <AppDataProvider>
          <AppContent />
        </AppDataProvider>
      </AuthProvider>
    </Router>
  );
}