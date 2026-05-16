import json
import sys

log_path = "/home/alef/.gemini/antigravity/brain/7c3d52f0-6e02-47be-a051-adb98cfaa7b6/.system_generated/logs/overview.txt"

try:
    with open(log_path, "r", encoding="utf-8") as f:
        lines_json = f.readlines()
except FileNotFoundError:
    print("Log file not found.")
    sys.exit(1)

app_js_lines = {}

for line in lines_json:
    try:
        data = json.loads(line)
        # Verify if it's a model response or tool response containing view_file output
        # Usually tool responses are in 'tool_responses' or 'responses'
        if 'tool_responses' in data:
            for resp in data['tool_responses']:
                if 'output' in resp:
                    output = resp['output']
                    if 'File Path: `file:///home/alef/Downloads/Cejam/frontend/app.js`' in output:
                        # Parse the lines from this output
                        for out_line in output.split('\n'):
                            import re
                            match = re.match(r"^(\d+):\s(.*)$", out_line)
                            if match:
                                line_num = int(match.group(1))
                                line_content = match.group(2)
                                app_js_lines[line_num] = line_content
    except Exception as e:
        pass

if not app_js_lines:
    print("No lines extracted from overview.txt")
    sys.exit(1)

max_line = max(app_js_lines.keys())
print(f"Extracted {len(app_js_lines)} lines! Max line: {max_line}")

# Fill gaps with empty strings just in case
with open("/home/alef/Downloads/Cejam/frontend/app.js.recovered", "w", encoding="utf-8") as out:
    for i in range(1, max_line + 1):
        out.write(app_js_lines.get(i, "") + "\n")

print("Wrote to app.js.recovered")
