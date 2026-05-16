use reqwest::Client;
use yup_oauth2::ServiceAccountAuthenticator;
use serde_json::Value;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key_data = include_str!("../../../chave-admin.json");
    let secret = yup_oauth2::parse_service_account_key(key_data)?;
    let auth = ServiceAccountAuthenticator::builder(secret).build().await?;
    let scopes = &["https://www.googleapis.com/auth/datastore"];
    let token = auth.token(scopes).await?.token().unwrap_or("").to_string();
    
    let client = Client::new();
    let project_id = "cejam-c93c9";
    
    let meds_json = std::fs::read_to_string("../meds.json")?;
    let meds: Vec<Value> = serde_json::from_str(&meds_json)?;
    
    println!("Encontrados {} medicamentos...", meds.len());
    let mut imported = 0;
    let mut ignored = 0;

    for med in meds {
        let apresentacao = med["apresentacao"].as_str().unwrap_or("").to_lowercase();
        let tipo = if apresentacao.contains("injetavel") || apresentacao.contains("ampola") || apresentacao.contains("seringa") {
            "injetável"
        } else if apresentacao.contains("comprimido") || apresentacao.contains("capsula") || apresentacao.contains("sache") || apresentacao.contains("envelope") {
            "comprimido"
        } else if apresentacao.contains("xarope") || apresentacao.contains("gotas") || apresentacao.contains("liquido") || apresentacao.contains("frasco") {
            "líquido"
        } else {
            "outro"
        };

        if tipo == "outro" {
            ignored += 1;
            continue;
        }

        let nome = med["nome"].as_str().unwrap_or("");
        let dosagem = med["dosagem"].as_str().unwrap_or("");
        let unidade = med["unidade_medida"].as_str().unwrap_or("");
        let miligrama = if !dosagem.is_empty() { dosagem } else { unidade };

        let doc_body = serde_json::json!({
            "fields": {
                "nome": { "stringValue": nome },
                "miligrama": { "stringValue": miligrama },
                "tipo": { "stringValue": tipo }
            }
        });

        let url = format!("https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents/medicamentos", project_id);
        
        let res = client.post(&url)
            .bearer_auth(&token)
            .json(&doc_body)
            .send()
            .await?;

        if res.status().is_success() {
            imported += 1;
        } else {
            println!("Erro ao importar {}: {:?}", nome, res.text().await?);
        }
    }

    println!("Importados: {}", imported);
    println!("Ignorados (pomadas, etc): {}", ignored);

    Ok(())
}
