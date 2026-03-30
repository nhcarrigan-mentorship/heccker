import sys
import os
import json
import csv

def read_file_universal(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    try:
        if ext == '.csv':
            return read_csv(file_path)
        elif ext == '.json':
            return read_json(file_path)
        elif ext in ['.txt', '.md', '.py', '.js', '.ts']:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        else:
            # For now, if no specialized library is found, return basic info
            size = os.path.getsize(file_path)
            return f"[PYTHON_READER] Detected {ext} file ({size} bytes). Enhanced parsing via Python libraries (docx/pdf) coming in next iteration."
    except Exception as e:
        return f"ERROR: {str(e)}"

def read_csv(file_path):
    data = []
    with open(file_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            data.append(row)
    return json.dumps(data, indent=2)

def read_json(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.dumps(json.load(f), indent=2)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python doc_reader.py <file_path>")
        sys.exit(1)
    
    path = sys.argv[1]
    result = read_file_universal(path)
    print(result)
