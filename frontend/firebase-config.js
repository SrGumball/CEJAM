// ═══════════════════════════════════════════
// CEJAM — Configuração Firebase (Pure Cloud)
// ═══════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { 
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, 
  getDocs, getDoc, query, where, orderBy, onSnapshot, serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBqFgKVfW80CPTGXmUjuQ6uhyRZRbjW4cI",
  authDomain: "cejam-c93c9.firebaseapp.com",
  projectId: "cejam-c93c9",
  storageBucket: "cejam-c93c9.firebasestorage.app",
  messagingSenderId: "93573813305",
  appId: "1:93573813305:web:53d6499abc72623007a9e8"
};

// Inicialização
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Instância secundária para criar usuários sem deslogar o admin
const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
const secondaryAuth = getAuth(secondaryApp);

// Exportar para uso em outros módulos e no escopo global
export const fb = { 
  auth, db, app, secondaryAuth,
  // Funções do SDK para uso direto
  collection, doc, addDoc, setDoc, updateDoc, getDocs, getDoc, 
  query, where, orderBy, onSnapshot, serverTimestamp 
};
window.fb = fb;

console.log("🔥 Firebase Cloud Native Inicializado");
