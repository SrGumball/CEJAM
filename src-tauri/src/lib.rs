use serde::{Serialize, Deserialize};
use yup_oauth2::{ServiceAccountKey, ServiceAccountAuthenticator};
use reqwest::Client;

#[derive(Debug, Serialize, Deserialize)]
pub struct ResetResponse {
    success: bool,
    message: String,
}

#[tauri::command]
async fn cmd_admin_reset_password(email: String, nova_senha: String) -> Result<ResetResponse, String> {
    // A chave agora é embutida diretamente no executável durante a compilação
    let key_data = include_str!("../../chave-admin.json");
    
    // 1. Ler a chave do Service Account a partir da string embutida
    let secret = yup_oauth2::parse_service_account_key(key_data)
        .map_err(|_| "Erro interno na chave de administração. O binário precisa ser recompilado.")?;

    // 2. Criar autenticador para o Google Auth
    let auth = ServiceAccountAuthenticator::builder(secret)
        .build()
        .await
        .map_err(|e| format!("Falha ao iniciar autenticador: {}", e))?;

    // 3. Obter token com escopo do Identity Toolkit (Firebase Auth)
    let scopes = &["https://www.googleapis.com/auth/identitytoolkit"];
    let token = auth.token(scopes)
        .await
        .map_err(|e| format!("Falha ao obter token do Google: {}", e))?;

    // 4. Chamar a API do Firebase para obter o UID do usuário pelo e-mail
    let client = Client::new();
    let lookup_url = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
    let lookup_body = serde_json::json!({ "email": vec![email.clone()] });

    let lookup_res = client.post(lookup_url)
        .bearer_auth(token.token().unwrap_or(""))
        .json(&lookup_body)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar usuário: {}", e))?;

    let lookup_data: serde_json::Value = lookup_res.json().await.unwrap_or_default();
    let local_id = lookup_data["users"][0]["localId"].as_str()
        .ok_or_else(|| format!("Usuário {} não encontrado no sistema de autenticação.", email))?;

    // 5. Agora sim, atualizar a senha usando o local_id (UID)
    let update_url = "https://identitytoolkit.googleapis.com/v1/accounts:update";
    let update_body = serde_json::json!({
        "localId": local_id,
        "password": nova_senha,
        "returnSecureToken": true
    });

    let res = client.post(update_url)
        .bearer_auth(token.token().unwrap_or(""))
        .json(&update_body)
        .send()
        .await
        .map_err(|e| format!("Erro na requisição de atualização: {}", e))?;

    if res.status().is_success() {
        Ok(ResetResponse {
            success: true,
            message: format!("Senha de {} alterada com sucesso!", email),
        })
    } else {
        let err_body: serde_json::Value = res.json().await.unwrap_or_default();
        Err(format!("Erro no Firebase: {}", err_body["error"]["message"]))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![cmd_admin_reset_password])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar aplicação CEJAM");
}
