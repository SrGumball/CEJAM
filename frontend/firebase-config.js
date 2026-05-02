// ═══════════════════════════════════════════
// CEJAM — Configuração Firebase (Compat Mode)
// ═══════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyBqFgKVfW80CPTGXmUjuQ6uhyRZRbjW4cI",
  authDomain: "cejam-c93c9.firebaseapp.com",
  projectId: "cejam-c93c9",
  storageBucket: "cejam-c93c9.firebasestorage.app",
  messagingSenderId: "93573813305",
  appId: "1:93573813305:web:53d6499abc72623007a9e8"
};

// Inicialização (se ainda não foi inicializado)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();

// Desativa a persistência nativa (que trava no protocolo tauri://)
auth.setPersistence(firebase.auth.Auth.Persistence.NONE)
  .then(() => console.log("🔥 Persistência definida como NONE (Compatibilidade Tauri)"))
  .catch(err => console.error("Erro ao definir persistência:", err));

const db = firebase.firestore();

// Exportar para uso em outros módulos e no escopo global
export const fb = { 
  auth, db, 
  // Funções helpers para manter compatibilidade com o app.js
  serverTimestamp: firebase.firestore.FieldValue.serverTimestamp
};

window.fb = fb;
console.log("🔥 Firebase Cloud (Compat) Inicializado");
