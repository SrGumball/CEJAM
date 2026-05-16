
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function checkAlas() {
    const snap = await db.collection('alas').get();
    console.log('Alas count:', snap.size);
    snap.forEach(doc => {
        console.log(doc.id, '=>', doc.data());
    });
}

checkAlas();
