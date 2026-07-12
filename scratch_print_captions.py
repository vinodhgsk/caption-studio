import json

project_json_path = r"C:\Users\vinod\Documents\Caption Studio\test2.vproj\project.json"

with open(project_json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

captions = data.get("captions", {})
for k, v in captions.items():
    if k != "transcript":
        print(f"{k}: {v}")
