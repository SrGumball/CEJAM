import re
import sys
import os

log_path = "/home/alef/.gemini/antigravity/brain/7c3d52f0-6e02-47be-a051-adb98cfaa7b6/.system_generated/logs/overview.txt"

try:
    with open(log_path, "r", encoding="utf-8") as f:
        content = f.read()
except FileNotFoundError:
    print("Log file not found.")
    sys.exit(1)

# Procurar pelas chamadas view_file que mostram as linhas
# A saída do view_file é assim:
# File Path: `file:///home/alef/Downloads/Cejam/frontend/app.js`
# Total Lines: 1884
# Total Bytes: 87175
# Showing lines ... to ...
# The following code has been modified to include a line number before every line...
# <line_number>: <original_line>

# Vamos encontrar as seções que pertencem a app.js
sections = content.split("File Path: `file:///home/alef/Downloads/Cejam/frontend/app.js`")

lines = {}

# Ignorar o primeiro split (antes da primeira menção)
for sec in sections[1:]:
    # A seção contém as linhas. Vamos ler linha por linha.
    for line in sec.split('\n'):
        # Procura por linhas no formato "123: conteudo"
        # As vezes tem um espaço extra
        match = re.match(r"^(\d+):\s(.*)$", line)
        if match:
            line_num = int(match.group(1))
            line_content = match.group(2)
            lines[line_num] = line_content

if not lines:
    print("Nenhuma linha extraída.")
    sys.exit(1)

max_line = max(lines.keys())
print(f"Maior linha encontrada: {max_line}")
print(f"Total de linhas extraídas unicamente: {len(lines)}")

# Escrever de volta
out_path = "/home/alef/Downloads/Cejam/frontend/app.js"
with open(out_path, "w", encoding="utf-8") as out:
    for i in range(1, max_line + 1):
        if i in lines:
            out.write(lines[i] + "\n")
        else:
            out.write("\n")

print(f"Arquivo {out_path} restaurado com sucesso com {max_line} linhas!")
