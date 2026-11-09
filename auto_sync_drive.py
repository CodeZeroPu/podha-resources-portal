import os
import json
import requests
import gdown

# --- CONFIGURATION ---
BOT_TOKEN = "9084126620:AAFJDD7pBQTvCzJMJ2zUAKZO596Qn-ce0lE"
CHAT_ID = "-1003771095032"
DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1BKzQ6ZxykDJIdNh0sB4I02w0e6SlYRql?usp=drive_link"

TEMP_DIR = "./temp_drive_pdfs"
CATALOG_FILE = "catalog.json"

def upload_pdf_to_telegram(file_path, caption):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendDocument"
    try:
        with open(file_path, "rb") as f:
            files = {"document": f}
            data = {"chat_id": CHAT_ID, "caption": caption}
            response = requests.post(url, data=data, files=files, timeout=60)
        
        result = response.json()
        if result.get("ok"):
            return result["result"]["document"]["file_id"]
        else:
            print(f"   ❌ Telegram Error: {result}")
            return None
    except Exception as e:
        print(f"   ❌ Exception: {e}")
        return None

def run_diagnostic():
    print("==================================================")
    print("🔍 RUNNING DIAGNOSTIC FILE WALK")
    print("==================================================")
    
    if not os.path.exists(TEMP_DIR):
        print(f"❌ Directory {TEMP_DIR} does not exist!")
        return

    total_files_found = 0
    pdf_count = 0
    catalog = {}

    for root, dirs, files in os.walk(TEMP_DIR):
        print(f"\n📁 Scanning Directory: {root}")
        print(f"   Subdirectories: {dirs}")
        print(f"   Files found here: {files}")
        
        for file in files:
            total_files_found += 1
            if file.lower().endswith(".pdf"):
                pdf_count += 1
                full_path = os.path.join(root, file)
                print(f"   ✅ FOUND PDF: {file} at {full_path}")
                
                # Determine relative path structure
                rel_path = os.path.relpath(root, TEMP_DIR)
                if rel_path == ".":
                    current_dict = catalog
                else:
                    parts = rel_path.split(os.sep)
                    curr = catalog
                    for part in parts:
                        curr = curr.setdefault(part, {})
                    current_dict = curr
                
                current_dict.setdefault("files", [])
                
                # Upload and map
                clean_title = os.path.splitext(file)[0].replace("_", " ").title()
                print(f"      📤 Uploading to Telegram: {clean_title}...")
                file_id = upload_pdf_to_telegram(full_path, caption=clean_title)
                
                if file_id:
                    current_dict["files"].append({
                        "title": clean_title,
                        "fileId": file_id
                    })

    print(f"\n📊 Summary: Total files on disk: {total_files_found} | Total PDFs matched: {pdf_count}")

    # Save catalog
    with open(CATALOG_FILE, "w", encoding="utf-8") as json_file:
        json.dump(catalog, json_file, indent=4, ensure_ascii=False)
    print(f"💾 Catalog saved to {CATALOG_FILE}.")

if __name__ == "__main__":
    run_diagnostic()
