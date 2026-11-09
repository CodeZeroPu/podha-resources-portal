import os
import json
import requests
import gdown

# --- CONFIGURATION ---
BOT_TOKEN = "9084126620:AAFJDD7pBQTvCzJMJ2zUAKZO596Qn-ce0lE"
CHAT_ID = "@icse_podha_bot" # Or numeric chat ID e.g. -100xxxxxxxxxx

# Paste your Google Drive Folder Share Link here (make sure the folder sharing is set to "Anyone with the link can view")
DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1BKzQ6ZxykDJIdNh0sB4I02w0e6SlYRql?usp=drive_link"

TEMP_DOWNLOAD_DIR = "./temp_drive_files"

def upload_pdf_to_telegram(file_path, caption):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendDocument"
    with open(file_path, "rb") as f:
        files = {"document": f}
        data = {"chat_id": CHAT_ID, "caption": caption}
        response = requests.post(url, data=data, files=files)
    
    result = response.json()
    if result.get("ok"):
        return result["result"]["document"]["file_id"]
    else:
        print(f"Failed to upload {file_path}: {result}")
        return None

def sync_drive_library():
    print("📥 Downloading study materials directly from Google Drive...")
    os.makedirs(TEMP_DOWNLOAD_DIR, exist_ok=True)
    
    # Download folder structure from Google Drive link
    gdown.download_folder(DRIVE_FOLDER_URL, output=TEMP_DOWNLOAD_DIR, quiet=False, use_cookies=False)

    catalog = {}
    
    # Walk through the downloaded folder structure
    for root, dirs, files in os.walk(TEMP_DOWNLOAD_DIR):
        rel_path = os.path.relpath(root, TEMP_DOWNLOAD_DIR)
        if rel_path == ".":
            current_dict = catalog
        else:
            parts = rel_path.split(os.sep)
            curr = catalog
            for part in parts:
                curr = curr.setdefault(part, {})
            current_dict = curr

        pdf_files = [f for f in files if f.lower().endswith(".pdf")]
        if pdf_files:
            current_dict["files"] = []
            for file in pdf_files:
                full_path = os.path.join(root, file)
                print(f"🚀 Uploading to Telegram: {file}...")
                
                file_id = upload_pdf_to_telegram(full_path, caption=file)
                
                if file_id:
                    current_dict["files"].append({
                        "title": os.path.splitext(file)[0].replace("_", " ").title(),
                        "fileId": file_id
                    })

    # Save the generated catalog.json for your website
    with open("catalog.json", "w", encoding="utf-8") as json_file:
        json.dump(catalog, json_file, indent=4, ensure_ascii=False)
    
    print("\n✅ Success! All Drive files synchronized, uploaded to Telegram, and saved to catalog.json.")

if __name__ == "__main__":
    sync_drive_library()