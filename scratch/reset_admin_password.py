import json
import urllib.request
from google.oauth2 import service_account
from google.auth.transport.requests import Request

# 1. Configurações
email = "alefdias44@cejam.com"
nova_senha = "admin2026"
project_id = "cejam-c93c9"
key_path = "/home/alef/Downloads/Cejam/chave-admin.json"

# 2. Obter Token OAuth2
creds = service_account.Credentials.from_service_account_file(
    key_path,
    scopes=['https://www.googleapis.com/auth/identitytoolkit']
)
creds.refresh(Request())
token = creds.token

# 3. Buscar UID pelo E-mail
lookup_url = "https://identitytoolkit.googleapis.com/v1/accounts:lookup"
lookup_data = json.dumps({"email": [email]}).encode('utf-8')
req = urllib.request.Request(lookup_url, data=lookup_data, headers={
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
})

try:
    with urllib.request.urlopen(req) as response:
        res_data = json.loads(response.read().decode())
        uid = res_data['users'][0]['localId']
        print(f"UID encontrado: {uid}")
except Exception as e:
    print(f"Erro ao buscar UID: {e}")
    exit(1)

# 4. Atualizar Senha
update_url = "https://identitytoolkit.googleapis.com/v1/accounts:update"
update_data = json.dumps({
    "localId": uid,
    "password": nova_senha,
    "returnSecureToken": True
}).encode('utf-8')
req_update = urllib.request.Request(update_url, data=update_data, headers={
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
})

try:
    with urllib.request.urlopen(req_update) as response:
        print(f"Sucesso! Senha do admin ({email}) alterada para: {nova_senha}")
except Exception as e:
    print(f"Erro ao atualizar senha: {e}")
    if hasattr(e, 'read'): print(e.read().decode())
