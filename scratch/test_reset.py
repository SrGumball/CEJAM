import json
import urllib.request
import time
from google.oauth2 import service_account
from google.auth.transport.requests import Request

# Load service account credentials
creds = service_account.Credentials.from_service_account_file(
    '/home/alef/Downloads/Cejam/chave-admin.json',
    scopes=['https://www.googleapis.com/auth/cloud-platform']
)
creds.refresh(Request())
token = creds.token

# Try 1: accounts:lookup without project ID
url = "https://identitytoolkit.googleapis.com/v1/accounts:lookup"
data = json.dumps({"email": ["alefdias44@cejam.com"]}).encode('utf-8')
req = urllib.request.Request(url, data=data, headers={
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
})
try:
    with urllib.request.urlopen(req) as response:
        print("URL1 SUCCESS:", response.read().decode())
except Exception as e:
    print("URL1 ERROR:", e)
    if hasattr(e, 'read'): print("URL1 ERROR BODY:", e.read().decode())

# Try 2: accounts:lookup WITH project ID in URL
url2 = "https://identitytoolkit.googleapis.com/v1/projects/cejam-c93c9/accounts:lookup"
req2 = urllib.request.Request(url2, data=data, headers={
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
})
try:
    with urllib.request.urlopen(req2) as response:
        print("URL2 SUCCESS:", response.read().decode())
except Exception as e:
    print("URL2 ERROR:", e)
    if hasattr(e, 'read'): print("URL2 ERROR BODY:", e.read().decode())
