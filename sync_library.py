import os
import json
import requests

# --- CONFIGURATION ---
BOT_TOKEN = "9084126620:AAFJDD7pBQTvCzJMJ2zUAKZO596Qn-ce0lE"  # Replace with your actual Telegram bot token
CHAT_ID = "-1003771095032"                    # Your private channel ID

# Path to your local study library folder root
LOCAL_LIBRARY_PATH = "./study_library"  

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
            print(f"Failed to upload {file_path}: {result}")
            return None
    except Exception as e:
        print(f"Exception uploading {file_path}: {e}")
        return None

def build_catalog_and_upload():
    catalog = {}
    
    print("🚀 Scanning local folder structure and uploading PDFs to Telegram...")
    for root, dirs, files in os.walk(LOCAL_LIBRARY_PATH):
        rel_path = os.path.relpath(root, LOCAL_LIBRARY_PATH)
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
                print(f"Uploading: {file} from {rel_path}...")
                
                file_id = upload_pdf_to_telegram(full_path, caption=file)
                
                if file_id:
                    current_dict["files"].append({
                        "title": os.path.splitext(file)[0].replace("_", " ").title(),
                        "fileId": file_id
                    })

    with open("catalog.json", "w", encoding="utf-8") as json_file:
        json.dump(catalog, json_file, indent=4, ensure_ascii=False)
    
    print("\n✅ Success! All files uploaded, mapped, and saved to catalog.json.")

if __name__ == "__main__":
    build_catalog_and_upload()
