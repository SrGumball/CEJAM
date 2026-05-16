use serde::{Serialize, Deserialize};
use yup_oauth2::{ServiceAccountAuthenticator};
use reqwest::Client;
use base64::{Engine as _, engine::general_purpose};
use genpdf::{Element, Alignment};

#[derive(Debug, Serialize, Deserialize)]
pub struct ResetResponse {
    success: bool,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub success: bool,
    pub message: String,
    pub uid: Option<String>,
    pub id_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PrescriptionData {
    pub paciente: String,
    pub leito: String,
    pub medicamento: String,
    pub dose: String,
    pub via: String,
    pub frequencia: String,
    pub medico: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PedidoData {
    pub dias: String,
    pub itens: Vec<PedidoItem>,
    pub responsavel: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PedidoItem {
    pub medicamento: String,
    pub doses_dia: String,
    pub total: String,
    pub pacientes_count: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CustomTokenClaims {
    pub iss: String,
    pub sub: String,
    pub aud: String,
    pub iat: u64,
    pub exp: u64,
    pub uid: String,
}



#[tauri::command]
async fn cmd_login_nativo(email: String, senha: String) -> Result<LoginResponse, String> {
    let api_key = "AIzaSyBqFgKVfW80CPTGXmUjuQ6uhyRZRbjW4cI";
    let url = format!("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={}", api_key);
    
    let client = Client::new();
    let body = serde_json::json!({
        "email": email,
        "password": senha,
        "returnSecureToken": true
    });

    let res = client.post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Falha na conexão com o servidor: {}", e))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| format!("Erro ao processar resposta: {}", e))?;

    if status.is_success() {
        Ok(LoginResponse {
            success: true,
            message: "Login realizado com sucesso!".to_string(),
            uid: data["localId"].as_str().map(|s| s.to_string()),
            id_token: data["idToken"].as_str().map(|s| s.to_string()),
        })
    } else {
        let err_msg = data["error"]["message"].as_str().unwrap_or("Erro desconhecido");
        let user_msg = match err_msg {
            "EMAIL_NOT_FOUND" | "INVALID_PASSWORD" | "INVALID_LOGIN_CREDENTIALS" => "E-mail ou senha incorretos.",
            "USER_DISABLED" => "Este usuário foi desativado.",
            "TOO_MANY_ATTEMPTS_TRY_LATER" => "Muitas tentativas. Tente mais tarde.",
            _ => err_msg,
        };
        Ok(LoginResponse {
            success: false,
            message: user_msg.to_string(),
            uid: None,
            id_token: None,
        })
    }
}

#[tauri::command]
async fn cmd_gerar_prescricao_pdf(data: PrescriptionData) -> Result<String, String> {
    let font_family = genpdf::fonts::from_files("/usr/share/fonts/truetype/dejavu", "DejaVuSans", None)
        .map_err(|e| format!("Erro ao carregar fonte: {}", e))?;

    let mut doc = genpdf::Document::new(font_family);
    doc.set_title(format!("Prescrição - {}", data.paciente));
    
    let mut decorator = genpdf::SimplePageDecorator::new();
    decorator.set_margins(10);
    doc.set_page_decorator(decorator);

    doc.push(genpdf::elements::Paragraph::new("CEJAM — SISTEMA HOSPITALAR")
        .styled(genpdf::style::Style::new().bold().with_font_size(18)));
    doc.push(genpdf::elements::Paragraph::new("RELATÓRIO DE PRESCRIÇÃO MÉDICA")
        .styled(genpdf::style::Style::new().with_font_size(12)));
    doc.push(genpdf::elements::Break::new(1.0));

    doc.push(genpdf::elements::Paragraph::new(format!("Paciente: {}", data.paciente)).styled(genpdf::style::Style::new().bold()));
    doc.push(genpdf::elements::Paragraph::new(format!("Leito: {}", data.leito)));
    doc.push(genpdf::elements::Paragraph::new(format!("Data: {}", data.data)));
    doc.push(genpdf::elements::Break::new(1.0));

    doc.push(genpdf::elements::Paragraph::new("MEDICAMENTOS PRESCRITOS:")
        .styled(genpdf::style::Style::new().bold().with_font_size(10)));
    
    let mut table = genpdf::elements::TableLayout::new(vec![3, 1, 1, 2]);
    table.set_cell_decorator(genpdf::elements::FrameCellDecorator::new(true, true, false));
    
    table.row()
        .element(genpdf::elements::Paragraph::new("Medicamento").styled(genpdf::style::Style::new().bold()))
        .element(genpdf::elements::Paragraph::new("Dose").styled(genpdf::style::Style::new().bold()))
        .element(genpdf::elements::Paragraph::new("Via").styled(genpdf::style::Style::new().bold()))
        .element(genpdf::elements::Paragraph::new("Frequência").styled(genpdf::style::Style::new().bold()))
        .push();

    table.row()
        .element(genpdf::elements::Paragraph::new(&data.medicamento))
        .element(genpdf::elements::Paragraph::new(&data.dose))
        .element(genpdf::elements::Paragraph::new(&data.via))
        .element(genpdf::elements::Paragraph::new(&data.frequencia))
        .push();

    doc.push(table);
    doc.push(genpdf::elements::Break::new(2.0));

    doc.push(genpdf::elements::Paragraph::new("________________________________________________")
        .aligned(Alignment::Center));
    doc.push(genpdf::elements::Paragraph::new(format!("Dr(a). {}", data.medico))
        .aligned(Alignment::Center));
    doc.push(genpdf::elements::Paragraph::new("Assinatura e Carimbo")
        .aligned(Alignment::Center)
        .styled(genpdf::style::Style::new().with_font_size(8)));

    let mut buffer = Vec::new();
    doc.render(&mut buffer).map_err(|e| format!("Erro ao renderizar PDF: {}", e))?;
    
    Ok(general_purpose::STANDARD.encode(buffer))
}

#[tauri::command]
async fn cmd_gerar_pedido_pdf(data: PedidoData) -> Result<String, String> {
    let font_family = genpdf::fonts::from_files("/usr/share/fonts/truetype/dejavu", "DejaVuSans", None)
        .map_err(|e| format!("Erro ao carregar fonte: {}", e))?;

    let mut doc = genpdf::Document::new(font_family);
    doc.set_title("Pedido de Medicamentos");
    
    let mut decorator = genpdf::SimplePageDecorator::new();
    decorator.set_margins(10);
    doc.set_page_decorator(decorator);

    doc.push(genpdf::elements::Paragraph::new("CEJAM — SISTEMA HOSPITALAR")
        .styled(genpdf::style::Style::new().bold().with_font_size(18)));
    doc.push(genpdf::elements::Paragraph::new("PROJEÇÃO PARA PEDIDO DE COMPRA")
        .styled(genpdf::style::Style::new().with_font_size(12)));
    doc.push(genpdf::elements::Paragraph::new(format!("Período de Projeção: {} dias", data.dias)));
    doc.push(genpdf::elements::Paragraph::new(format!("Data do Relatório: {}", data.data)));
    doc.push(genpdf::elements::Break::new(1.0));

    let mut table = genpdf::elements::TableLayout::new(vec![3, 1, 1, 1]);
    table.set_cell_decorator(genpdf::elements::FrameCellDecorator::new(true, true, false));
    
    table.row()
        .element(genpdf::elements::Paragraph::new("Medicamento").styled(genpdf::style::Style::new().bold()))
        .element(genpdf::elements::Paragraph::new("Doses/Dia").styled(genpdf::style::Style::new().bold()))
        .element(genpdf::elements::Paragraph::new("Qtd Total").styled(genpdf::style::Style::new().bold()))
        .element(genpdf::elements::Paragraph::new("Pacientes").styled(genpdf::style::Style::new().bold()))
        .push();

    for item in data.itens {
        table.row()
            .element(genpdf::elements::Paragraph::new(&item.medicamento))
            .element(genpdf::elements::Paragraph::new(&item.doses_dia))
            .element(genpdf::elements::Paragraph::new(&item.total))
            .element(genpdf::elements::Paragraph::new(&item.pacientes_count))
            .push();
    }

    doc.push(table);
    doc.push(genpdf::elements::Break::new(2.0));

    doc.push(genpdf::elements::Paragraph::new("________________________________________________")
        .aligned(Alignment::Center));
    doc.push(genpdf::elements::Paragraph::new(format!("Responsável: {}", data.responsavel))
        .aligned(Alignment::Center));

    let mut buffer = Vec::new();
    doc.render(&mut buffer).map_err(|e| format!("Erro ao renderizar PDF: {}", e))?;
    
    Ok(general_purpose::STANDARD.encode(buffer))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_localhost::Builder::new(1420).build()) // INJETA SERVIDOR LOCALHTTP
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            cmd_login_nativo,
            cmd_gerar_prescricao_pdf,
            cmd_gerar_pedido_pdf
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar aplicação CEJAM");
}
