const admin = require('firebase-admin');
const sqlite3 = require('sqlite3').verbose();

// Inicializa o Firebase com a chave admin
const serviceAccount = require('../../chave-admin.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Mapeia as apresentações para injetavel, comprimido, ou liquido
function mapApresentacao(apresentacao) {
  if (!apresentacao) return 'outro';
  const a = apresentacao.toLowerCase();
  if (a.includes('injetavel') || a.includes('ampola') || a.includes('seringa')) return 'injetável';
  if (a.includes('comprimido') || a.includes('capsula') || a.includes('sache') || a.includes('envelope')) return 'comprimido';
  if (a.includes('xarope') || a.includes('gotas') || a.includes('liquido') || a.includes('frasco')) return 'líquido';
  return 'outro'; // pomada, creme, shampoo, etc
}

// Conecta ao banco SQLite
const dbPath = '../../Pegar apenas modelo e apagar/backup 02 maio 2026.db';
const sqldb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Erro ao abrir SQLite:', err.message);
    process.exit(1);
  }
});

async function importarMedicamentos() {
  sqldb.all(`SELECT nome, dosagem, unidade_medida, apresentacao FROM Medicamento`, async (err, rows) => {
    if (err) {
      console.error(err.message);
      return;
    }
    
    console.log(`Encontrados ${rows.length} medicamentos. Iniciando importação para o Firebase...`);
    
    let batch = db.batch();
    let count = 0;
    let ignored = 0;

    for (const row of rows) {
      const tipo = mapApresentacao(row.apresentacao);
      
      // O usuário quer "injetavel, comprimido, liquido"
      if (tipo === 'outro') {
        ignored++;
        continue;
      }

      const nomeOriginal = row.nome;
      const miligrama = row.dosagem || row.unidade_medida || '';
      
      const docRef = db.collection('medicamentos').doc();
      batch.set(docRef, {
        nome: nomeOriginal,
        miligrama: miligrama,
        tipo: tipo
      });
      
      count++;
      
      // Limite do batch do Firestore é 500
      if (count > 0 && count % 400 === 0) {
        await batch.commit();
        console.log(`Lote de ${count} importado...`);
        batch = db.batch(); // cria novo batch
      }
    }
    
    // Comita o resto
    if (count % 400 !== 0) {
      await batch.commit();
    }
    
    console.log(`Finalizado! ${count} medicamentos importados para o Firestore.`);
    console.log(`(Ignorados ${ignored} medicamentos que não eram injetáveis, comprimidos ou líquidos, ex: pomadas)`);
    process.exit(0);
  });
}

importarMedicamentos();
