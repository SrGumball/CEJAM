use bcrypt::hash;
use rusqlite::{Connection, params};
use std::path::PathBuf;

fn main() {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let db_path = PathBuf::from(home).join(".cejam").join("cejam.db");
    
    if !db_path.exists() {
        println!("Bancos de dados não encontrado em {:?}", db_path);
        return;
    }

    let conn = Connection::open(db_path).expect("Falha ao abrir banco");
    let new_hash = hash("10203040", 10).expect("Falha ao gerar hash");
    
    conn.execute(
        "UPDATE funcionarios SET email='alefdias44@cejam.com', senha_hash=?1 WHERE id='admin'",
        params![new_hash],
    ).expect("Falha ao atualizar admin");

    println!("✓ Admin atualizado localmente: alefdias44@cejam.com");
}
